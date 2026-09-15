import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level declarations, so the shared
// spies must be created with vi.hoisted.
const { connect, redisConstructor } = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  redisConstructor: vi.fn(),
}));

vi.mock("ioredis", () => ({
  default: redisConstructor,
  Redis: redisConstructor,
}));

import { RedisProvider } from "../../../src/providers/redis.js";

const BASE_OPTIONS = {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  connectTimeout: 5000,
};

describe("RedisProvider.connect", () => {
  beforeEach(() => {
    connect.mockClear();
    redisConstructor.mockClear();
    redisConstructor.mockImplementation(() => ({ connect }));
  });

  it("creates and connects a lazy Redis client from a url", async () => {
    const provider = new RedisProvider();

    await provider.connect({
      url: "redis://localhost:6379",
      timeout: 2500,
    });

    expect(redisConstructor).toHaveBeenCalledWith("redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 2500,
    });
    expect(connect).toHaveBeenCalledOnce();
  });

  it("omits db and auth options when they are not configured", async () => {
    const provider = new RedisProvider();

    await provider.connect({ url: "redis://localhost:6379" });

    const options = redisConstructor.mock.calls[0][1];
    expect(options).toStrictEqual(BASE_OPTIONS);
  });

  it("forwards db, username and password to the client", async () => {
    const provider = new RedisProvider();

    await provider.connect({
      url: "redis://localhost:6379",
      db: 3,
      username: "app",
      password: "s3cret",
    });

    expect(redisConstructor).toHaveBeenCalledWith("redis://localhost:6379", {
      ...BASE_OPTIONS,
      db: 3,
      username: "app",
      password: "s3cret",
    });
  });

  it("connects through sentinels using an options object", async () => {
    const provider = new RedisProvider();

    await provider.connect({
      sentinels: [
        { host: "10.0.0.1", port: 26379 },
        { host: "10.0.0.2" },
      ],
      master_name: "mymaster",
      sentinel_username: "sentinel-user",
      sentinel_password: "sentinel-pass",
      sentinel_tls: true,
      db: 1,
      password: "data-pass",
    });

    expect(redisConstructor).toHaveBeenCalledTimes(1);
    // Sentinel connections pass a single options object (no URL argument);
    // that is what makes ioredis pick the SentinelConnector.
    expect(redisConstructor.mock.calls[0]).toHaveLength(1);
    const options = redisConstructor.mock.calls[0][0];
    expect(options).toMatchObject({
      ...BASE_OPTIONS,
      db: 1,
      password: "data-pass",
      sentinels: [
        { host: "10.0.0.1", port: 26379 },
        { host: "10.0.0.2", port: 26379 },
      ],
      name: "mymaster",
      role: "master",
      sentinelUsername: "sentinel-user",
      sentinelPassword: "sentinel-pass",
      enableTLSForSentinelMode: true,
    });
    expect(typeof options.sentinelRetryStrategy).toBe("function");
    expect(connect).toHaveBeenCalledOnce();
  });

  it("honours an explicit slave role", async () => {
    const provider = new RedisProvider();

    await provider.connect({
      sentinels: [{ host: "10.0.0.1" }],
      master_name: "mymaster",
      role: "slave",
    });

    expect(redisConstructor.mock.calls[0][0]).toMatchObject({
      name: "mymaster",
      role: "slave",
    });
  });

  it("bounds sentinel resolution so a bad address cannot hang the call", async () => {
    const provider = new RedisProvider();

    await provider.connect({
      sentinels: [{ host: "10.0.0.1" }],
      master_name: "mymaster",
    });

    const options = redisConstructor.mock.calls[0][0];
    // A single pass over the sentinel list is allowed, then ioredis must give
    // up (a non-number makes it throw instead of retrying forever).
    expect(typeof options.sentinelRetryStrategy(1)).toBe("number");
    expect(options.sentinelRetryStrategy(3)).toBeNull();
    expect(options.sentinelRetryStrategy(99)).toBeNull();
  });

  it("throws when neither url nor sentinels are configured", async () => {
    const provider = new RedisProvider();

    await expect(provider.connect({ readonly: true })).rejects.toThrow(
      /either `url` or a non-empty `sentinels` list/,
    );
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it("throws when sentinels are configured without master_name", async () => {
    const provider = new RedisProvider();

    await expect(
      provider.connect({ sentinels: [{ host: "10.0.0.1" }] }),
    ).rejects.toThrow(/requires `master_name`/);
    expect(redisConstructor).not.toHaveBeenCalled();
  });
});
