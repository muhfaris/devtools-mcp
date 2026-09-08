import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parse } from "yaml";
import { Config } from "./types.js";
import { config as dotenvConfig } from "dotenv";

// Load .env file
dotenvConfig();

export const loadConfig = async (): Promise<Config> => {
  let dir = process.cwd();
  while (dir !== "/") {
    const candidate = resolve(dir, "devtools.config.yaml");
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf-8");
      const parsed = parse(content) as Config;

      // Resolve ${ENV_VAR} placeholders
      const resolved = resolveEnvVars(parsed);
      return resolved;
    }
    dir = dirname(dir);
  }
  return {};
};

function resolveEnvVars(obj: any): any {
  if (typeof obj === "string") {
    // Replace ${VAR} with process.env.VAR
    return obj.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const value = process.env[name];
      return value ?? "";
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj && typeof obj === "object") {
    const resolved: any = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveEnvVars(value);
    }
    return resolved;
  }
  return obj;
}
