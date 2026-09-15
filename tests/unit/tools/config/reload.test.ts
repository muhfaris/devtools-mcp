import { afterEach, describe, expect, it, vi } from "vitest";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import { ToolError } from "../../../../src/core/errors.js";

vi.mock("../../../../src/core/runtime-config.js", () => ({
  reloadRuntimeConfig: vi.fn(),
  getConfigRuntimeState: vi.fn(() => ({})),
  getConfigPath: vi.fn(() => "/path/to/config.yaml"),
}));

import { reloadRuntimeConfig } from "../../../../src/core/runtime-config.js";
import { reloadConfigTool } from "../../../../src/tools/config/reload.js";

const mockReload = reloadRuntimeConfig as unknown as ReturnType<typeof vi.fn>;

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  vi.clearAllMocks();
  (global as any).__devtools_config = originalConfig;
});

describe("reload_config", () => {
  it("returns the newly loaded safe configuration in success envelope", async () => {
    mockReload.mockResolvedValue({
      database: {
        default_engine: "mysql",
        connections: {
          staging: {
            dsn: "mysql://user:secret@db.example.com/app",
            readonly: true,
          },
        },
      },
    });

    const result = await parseToolJson(reloadConfigTool, {});

    expect(result.ok).toBe(true);
    expect(result.data.reloaded).toBe(true);
    expect(result.data.database.default_engine).toBe("mysql");
    expect(result.data.database.connections.staging.dsn).not.toContain("secret");
  });

  it("propagates reload failures as ToolError", async () => {
    mockReload.mockRejectedValue(new Error("config missing"));
    await expect(reloadConfigTool.execute({})).rejects.toThrowError(ToolError);
    await expect(reloadConfigTool.execute({})).rejects.toMatchObject({
      code: "CONFIG_RELOAD_FAILED",
      retryable: true,
    });
  });
});
