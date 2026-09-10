import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("../../../src/core/config.js", () => ({
  getConfigPath: vi.fn(),
  reloadConfig: vi.fn(),
}));

import { existsSync } from "fs";
import { getConfigPath, reloadConfig } from "../../../src/core/config.js";
import {
  applyRuntimeConfig,
  getConfigRuntimeState,
  reloadRuntimeConfig,
  resetConfigRuntimeState,
} from "../../../src/core/runtime-config.js";

const mockGetConfigPath = getConfigPath as unknown as ReturnType<typeof vi.fn>;
const mockReloadConfig = reloadConfig as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  resetConfigRuntimeState();
  vi.clearAllMocks();
  (global as any).__devtools_config = originalConfig;
});

describe("runtime configuration", () => {
  it("replaces runtime configuration on reload", async () => {
    const diskConfig = {
      providers: {
        gitlab: { url: "https://gitlab.com", token: "token", projectId: 1 },
      },
    };
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    mockReloadConfig.mockResolvedValue(diskConfig);

    await reloadRuntimeConfig();

    expect((global as any).__devtools_config).toBe(diskConfig);
    expect(getConfigRuntimeState()).toMatchObject({
      status: "loaded",
      reloadError: null,
    });
    expect(getConfigRuntimeState().lastReloadedAt).not.toBeNull();
  });

  it("preserves the last valid configuration when reload fails", async () => {
    const validConfig = {
      providers: {
        database: { default_engine: "postgresql", connections: {} },
      },
    } as const;
    applyRuntimeConfig(validConfig as any);
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    mockReloadConfig.mockRejectedValue(new Error("invalid YAML"));

    await expect(reloadRuntimeConfig()).rejects.toThrow("invalid YAML");

    expect((global as any).__devtools_config).toBe(validConfig);
    expect(getConfigRuntimeState()).toMatchObject({
      status: "reload_failed",
      reloadError: "invalid YAML",
    });
  });

  it("rejects reload when no loaded config path exists", async () => {
    mockGetConfigPath.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);
    await expect(reloadRuntimeConfig()).rejects.toThrow("No loaded");
  });
});
