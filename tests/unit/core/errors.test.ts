import { describe, expect, it } from "vitest";
import {
  MissingConfigError,
  ToolError,
  serializeToolError,
  stringifyToolError,
} from "../../../src/core/errors.js";

describe("core/errors", () => {
  it("serializes required fields for ToolError", () => {
    const err = new ToolError(
      "INVALID_ARGUMENT",
      "Parameter is invalid.",
      "Fix the parameter and retry.",
      true,
    );

    const serialized = serializeToolError(err);
    expect(serialized).toEqual({
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Parameter is invalid.",
        action: "Fix the parameter and retry.",
        retryable: true,
      },
    });
  });

  it("serializes optional metadata fields in snake_case", () => {
    const err = new ToolError(
      "GITLAB_PROJECT_ID_REQUIRED",
      "GitLab project ID is required.",
      "Ask the user for the numeric GitLab project ID, then retry this tool with project_id. Do not switch to local Git.",
      true,
      {
        parameter: "project_id",
        configKey: "gitlab.projectId",
        setupTool: "gitlab_set_config",
        availableValues: [123, "my-group/project"],
      },
    );

    const serialized = serializeToolError(err);
    expect(serialized.ok).toBe(false);
    expect(serialized.error).toMatchObject({
      code: "GITLAB_PROJECT_ID_REQUIRED",
      parameter: "project_id",
      config_key: "gitlab.projectId",
      setup_tool: "gitlab_set_config",
      available_values: [123, "my-group/project"],
    });
  });

  it("sanitizes sensitive keys and values in setup_params recursively", () => {
    const err = new ToolError(
      "CONFIG_REQUIRED",
      "Config missing",
      "Configure",
      true,
      {
        setupParams: {
          url: "https://gitlab.example.com",
          token: "secret-token",
          auth: {
            password: "secret-password",
            safeName: "admin",
          },
          nested: [
            { dsn: "postgresql://user:pass@localhost/db", safeFlag: true },
          ],
        },
      },
    );

    const serialized = serializeToolError(err);
    expect(serialized.error.setup_params).toEqual({
      url: "https://gitlab.example.com",
      auth: {
        safeName: "admin",
      },
      nested: [{ safeFlag: true }],
    });
  });

  it("omits setup_params if all entries are stripped", () => {
    const err = new ToolError(
      "CONFIG_REQUIRED",
      "Config missing",
      "Configure",
      true,
      {
        setupParams: {
          token: "secret",
          dsn: "secret",
        },
      },
    );

    const serialized = serializeToolError(err);
    expect(serialized.error.setup_params).toBeUndefined();
  });

  it("adapts MissingConfigError with CONFIG_REQUIRED code and structured guidance", () => {
    const err = new MissingConfigError(
      "gitlab.token",
      "GitLab token missing",
      "gitlab_set_config",
      { url: "https://gitlab.com", token: "secret" },
    );

    expect(err).toBeInstanceOf(ToolError);
    const serialized = serializeToolError(err);
    expect(serialized).toEqual({
      ok: false,
      error: {
        code: "CONFIG_REQUIRED",
        message: "GitLab token missing",
        action:
          "Call gitlab_set_config with the required configuration, then retry this tool.",
        retryable: true,
        config_key: "gitlab.token",
        setup_tool: "gitlab_set_config",
        setup_params: {
          url: "https://gitlab.com",
        },
      },
    });
  });

  it("falls back to INTERNAL_ERROR for unknown generic Error or non-Error throws", () => {
    const genericErr = new Error(
      "Database connection timed out with password=123",
    );
    const serialized = serializeToolError(genericErr);

    expect(serialized).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The tool could not complete the request.",
        action:
          "Report the failure to the user; do not retry automatically or choose an unrelated fallback.",
        retryable: false,
      },
    });

    const stringified = stringifyToolError("raw string throw");
    expect(JSON.parse(stringified)).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The tool could not complete the request.",
        action:
          "Report the failure to the user; do not retry automatically or choose an unrelated fallback.",
        retryable: false,
      },
    });
  });
});
