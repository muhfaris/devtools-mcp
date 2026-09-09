import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parse } from "yaml";
import { Config } from "./types.js";
import { config as dotenvConfig } from "dotenv";

// Load .env file
dotenvConfig();

let configPath: string | null = null;

export const getConfigPath = (): string | null => configPath;

export const loadConfig = async (): Promise<Config> => {
  let dir = process.cwd();
  while (dir !== "/") {
    const candidate = resolve(dir, ".devtools", "config.yaml");
    if (existsSync(candidate)) {
      configPath = candidate;
      return readAndParse(candidate);
    }
    dir = dirname(dir);
  }
  configPath = null;
  return {};
};

export const reloadConfig = async (): Promise<Config> => {
  if (configPath && existsSync(configPath)) {
    return readAndParse(configPath);
  }
  // File removed: re-run discovery in case it moved, else reset.
  configPath = null;
  return loadConfig();
};

function readAndParse(candidate: string): Config {
  const content = readFileSync(candidate, "utf-8");
  const parsed = parse(content) as Config;
  return resolveEnvVars(parsed);
}

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
