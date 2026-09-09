import { afterEach, describe, expect, it, vi } from "vitest";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import { ToolError } from "../../../../src/core/errors.js";

vi.mock("../../../../src/core/runtime-config.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../src/core/runtime-config.js")
    >();
  return {
    ...actual,
    reloadRuntimeConfig: vi.fn(),
  };
});

import { reloadRuntimeConfig } from "../../../../src/core/runtime-config.js";
import { reloadConfigTool } from "../../../../src/tools/config/reload.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  vi.clearAllMocks();
  (global as any).__devtools_config = originalConfig;
});

describe("reload_config", () => {
  it("returns the newly loaded safe configuration in success envelope", async () => {
    vi.mocked(reloadRuntimeConfig).mockResolvedValue({
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
    vi.mocked(reloadRuntimeConfig).mockRejectedValue(
      new Error("config missing"),
    );
    await expect(reloadConfigTool.execute({})).rejects.toThrowError(ToolError);
    await expect(reloadConfigTool.execute({})).rejects.toMatchObject({
      code: "CONFIG_RELOAD_FAILED",
      retryable: true,
    });
  });
});
