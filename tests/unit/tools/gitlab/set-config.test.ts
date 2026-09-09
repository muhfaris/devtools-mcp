import { afterEach, describe, expect, it } from "vitest";
import { gitlabSetConfigTool } from "../../../../src/tools/gitlab/set-config.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_set_config", () => {
  it("allows setting projectId without resupplying token if token already exists", async () => {
    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.com",
        token: "existing-token",
        projectId: null,
      },
    };

    const res = await parseToolJson(gitlabSetConfigTool, { projectId: 999 });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({
      updated: true,
      updated_fields: ["projectId"],
      token_updated: false,
      initialized: true,
    });
    expect((global as any).__devtools_config.gitlab.projectId).toBe(999);
  });

  it("never echoes token value in response envelope", async () => {
    (global as any).__devtools_config = {};

    const res = await parseToolJson(gitlabSetConfigTool, {
      token: "secret-token-12345",
      projectId: 123,
    });

    expect(res.ok).toBe(true);
    expect(JSON.stringify(res)).not.toContain("secret-token-12345");
    expect(res.data.token_updated).toBe(true);
  });
});
