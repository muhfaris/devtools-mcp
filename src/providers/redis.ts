import Redis from "ioredis";
import type { RedisConnectionConfig } from "../core/types.js";

export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
  size: number;
}

export interface RedisKeyValue {
  key: string;
  type: string;
  value: any;
  truncated?: boolean;
}

export class RedisProvider {
  private client: Redis | null = null;
  private config: RedisConnectionConfig | null = null;

  async connect(config: RedisConnectionConfig): Promise<void> {
    this.config = config;
    this.client = new Redis(config.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: config.timeout || 5000,
    });
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
    }
  }

  private getClient(): Redis {
    if (!this.client) throw new Error("Redis not connected");
    return this.client;
  }

  getEngine(): string {
    return "redis";
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) return false;
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }

  /**
   * Get server info, optionally filtered by section
   * Sections: server, clients, memory, persistence, stats, replication, cpu, keyspace
   */
  async info(section?: string): Promise<Record<string, string>> {
    const raw = section
      ? await this.getClient().info(section)
      : await this.getClient().info();
    return parseRedisInfo(raw);
  }

  /**
   * List keys using SCAN (never KEYS — safe for production)
   */
  async listKeys(pattern: string, limit: number = 100): Promise<string[]> {
    const client = this.getClient();
    const keys: string[] = [];
    let cursor = "0";
    const maxIterations = 100; // safety cap
    let iterations = 0;

    do {
      const [nextCursor, batch] = await client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
      iterations++;
      if (keys.length >= limit || iterations >= maxIterations) break;
    } while (cursor !== "0");

    return keys.slice(0, limit);
  }

  async getKeyInfo(key: string): Promise<RedisKeyInfo> {
    const client = this.getClient();
    const type = await client.type(key);
    const ttl = await client.ttl(key);

    let size = 0;
    try {
      const memory = await client.call("MEMORY", "USAGE", key);
      size = Number(memory) || 0;
    } catch {
      // MEMORY USAGE may be unavailable on older Redis
    }

    return { key, type, ttl, size };
  }

  async getKeyValue(key: string, limit: number = 100): Promise<RedisKeyValue> {
    const client = this.getClient();
    const type = await client.type(key);

    let value: any = null;
    let truncated = false;

    switch (type) {
      case "string": {
        const str = await client.get(key);
        if (str && str.length > 10000) {
          value = str.substring(0, 10000) + "... [truncated]";
          truncated = true;
        } else {
          value = str;
        }
        break;
      }
      case "list": {
        const len = await client.llen(key);
        value = await client.lrange(key, 0, limit - 1);
        truncated = len > limit;
        break;
      }
      case "set": {
        const size = await client.scard(key);
        value = await client.smembers(key);
        if (value.length > limit) {
          value = value.slice(0, limit);
          truncated = true;
        }
        break;
      }
      case "zset": {
        value = await client.zrange(key, 0, limit - 1, "WITHSCORES");
        truncated = (await client.zcard(key)) > limit;
        break;
      }
      case "hash": {
        value = await client.hgetall(key);
        const entries = Object.entries(value);
        if (entries.length > limit) {
          value = Object.fromEntries(entries.slice(0, limit));
          truncated = true;
        }
        break;
      }
      case "stream": {
        value = await client.xrange(key, "-", "+", "COUNT", limit);
        break;
      }
      case "none":
        value = null;
        break;
      default:
        value = `[Unsupported type: ${type}]`;
    }

    return { key, type, value, truncated };
  }

  async dbSize(): Promise<number> {
    return this.getClient().dbsize();
  }

  async slowlog(count: number = 10): Promise<any[]> {
    const client = this.getClient();
    try {
      const raw = await client.call("SLOWLOG", "GET", count);
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  /**
   * Set a string value with optional TTL and NX/XX flags
   */
  async setKey(
    key: string,
    value: string,
    options: { ttl?: number; mode?: "NX" | "XX" } = {},
  ): Promise<{ ok: boolean; reason?: string }> {
    const client = this.getClient();
    const args: any[] = [key, value];

    if (options.ttl && options.ttl > 0) {
      args.push("EX", options.ttl);
    }
    if (options.mode) {
      args.push(options.mode);
    }

    const result = await client.set(...(args as [string, string, ...any[]]));
    if (result === "OK") return { ok: true };
    return {
      ok: false,
      reason: `Condition not met (${options.mode || "unknown"})`,
    };
  }

  /**
   * Delete one or more keys. Returns count of keys actually deleted.
   */
  async deleteKeys(
    keys: string[],
  ): Promise<{ deleted: number; existing: string[] }> {
    const client = this.getClient();

    // First check which keys exist (for reporting)
    const existing = await Promise.all(
      keys.map(async (k) => ((await client.exists(k)) === 1 ? k : null)),
    ).then((arr) => arr.filter((k): k is string => k !== null));

    if (existing.length === 0) {
      return { deleted: 0, existing: [] };
    }

    const deleted = await client.del(...existing);
    return { deleted, existing };
  }

  /**
   * Set TTL on a key. Use ttl <= 0 to remove expiry (PERSIST).
   */
  async expireKey(
    key: string,
    ttl: number,
  ): Promise<{ ok: boolean; applied: boolean }> {
    const client = this.getClient();

    // Check key exists
    const exists = await client.exists(key);
    if (exists === 0) return { ok: false, applied: false };

    if (ttl <= 0) {
      const removed = await client.persist(key);
      return { ok: true, applied: removed === 1 };
    }

    const result = await client.expire(key, ttl);
    return { ok: true, applied: result === 1 };
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const client = this.getClient();
    return (await client.exists(key)) === 1;
  }
}

function parseRedisInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    result[trimmed.substring(0, idx)] = trimmed.substring(idx + 1);
  }
  return result;
}
