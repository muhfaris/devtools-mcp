import * as fs from "node:fs/promises";
import * as path from "node:path";
import dotenv from "dotenv";
import { Tool } from "../../core/types.js";

interface EnvKeyInfo {
  key: string;
  hasValue: boolean;
  value?: string;
}

function parseEnv(content: string, includeValues: boolean = false): Map<string, EnvKeyInfo> {
  const parsed = dotenv.parse(content);
  const map = new Map<string, EnvKeyInfo>();

  for (const [key, value] of Object.entries(parsed)) {
    const trimmed = value.trim();
    map.set(key, {
      key,
      hasValue: trimmed.length > 0,
      value: includeValues ? value : undefined,
    });
  }

  return map;
}

export const envDiffTool: Tool = {
  name: "env_diff",
  description:
    "Compare .env and .env.example files or raw text to detect missing, extra, and unpopulated environment variables without leaking secrets.",
  params: {
    envPath: {
      type: "string",
      optional: true,
      description: "Path to the actual .env file (default: '.env')",
    },
    examplePath: {
      type: "string",
      optional: true,
      description: "Path to the reference .env.example file (default: '.env.example')",
    },
    envText: {
      type: "string",
      optional: true,
      description: "Raw content of the actual .env file (overrides envPath)",
    },
    exampleText: {
      type: "string",
      optional: true,
      description: "Raw content of the reference .env.example file (overrides examplePath)",
    },
    includeValues: {
      type: "boolean",
      optional: true,
      description: "Whether to include raw variable values in the output (default: false for security)",
      default: false,
    },
  },
  execute: async (params) => {
    const includeValues = Boolean(params.includeValues);
    let envContent = "";
    let exampleContent = "";
    let envSource = params.envPath || ".env";
    let exampleSource = params.examplePath || ".env.example";

    // Load actual .env
    if (params.envText !== undefined) {
      envContent = String(params.envText);
      envSource = "raw:envText";
    } else {
      const resolvedEnv = path.resolve(envSource);
      try {
        envContent = await fs.readFile(resolvedEnv, "utf-8");
      } catch (err: any) {
        throw new Error(`Failed to read env file (${envSource}): ${err.message}`);
      }
    }

    // Load reference .env.example
    if (params.exampleText !== undefined) {
      exampleContent = String(params.exampleText);
      exampleSource = "raw:exampleText";
    } else {
      const resolvedExample = path.resolve(exampleSource);
      try {
        exampleContent = await fs.readFile(resolvedExample, "utf-8");
      } catch (err: any) {
        throw new Error(`Failed to read example file (${exampleSource}): ${err.message}`);
      }
    }

    const envMap = parseEnv(envContent, includeValues);
    const exampleMap = parseEnv(exampleContent, includeValues);

    const missingKeys: string[] = [];
    const extraKeys: string[] = [];
    const emptyKeys: string[] = [];
    const matchingKeys: string[] = [];

    // Check for missing keys (in example but not in env)
    for (const key of exampleMap.keys()) {
      if (!envMap.has(key)) {
        missingKeys.push(key);
      }
    }

    // Check for extra and empty keys
    for (const [key, info] of envMap.entries()) {
      if (!exampleMap.has(key)) {
        extraKeys.push(key);
      } else {
        matchingKeys.push(key);
      }

      if (!info.hasValue) {
        emptyKeys.push(key);
      }
    }

    const isSynced = missingKeys.length === 0 && emptyKeys.length === 0;

    const result = {
      synced: isSynced,
      sources: {
        env: envSource,
        example: exampleSource,
      },
      summary: {
        totalExampleKeys: exampleMap.size,
        totalEnvKeys: envMap.size,
        matchingCount: matchingKeys.length,
        missingCount: missingKeys.length,
        extraCount: extraKeys.length,
        emptyCount: emptyKeys.length,
      },
      missing: missingKeys,
      extra: extraKeys,
      empty: emptyKeys,
      matching: matchingKeys,
      ...(includeValues
        ? {
            values: {
              env: Object.fromEntries(
                Array.from(envMap.entries()).map(([k, v]) => [k, v.value]),
              ),
              example: Object.fromEntries(
                Array.from(exampleMap.entries()).map(([k, v]) => [k, v.value]),
              ),
            },
          }
        : {}),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
