import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn().mockResolvedValue(undefined);
const redisConstructor = vi.fn().mockImplementation(() => ({ connect }));

vi.mock("ioredis", () => ({
  default: redisConstructor,
  Redis: redisConstructor,
}));

import { RedisProvider } from "../../../src/providers/redis.js";

describe("RedisProvider.connect", () => {
  beforeEach(() => {
    connect.mockClear();
    redisConstructor.mockClear();
  });

  it("creates and connects a lazy Redis client", async () => {
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
});
