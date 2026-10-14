import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parse } from "yaml";
import { Config } from "./types.js";
import { config as dotenvConfig } from "dotenv";

// Load .env file. `quiet` keeps dotenv@17's startup banner off stdout: the CLI's
// output must stay parseable, and an MCP stdio server may only emit JSON-RPC there.
dotenvConfig({ quiet: true });

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

/** Prefix marking a config value as a command to run. Case-sensitive. */
export const CMD_PREFIX = "cmd:";

/**
 * Bounded so a helper waiting on a pinentry prompt (`pass`, `op`) can never stall
 * startup or a live reload indefinitely.
 */
export const CMD_TIMEOUT_MS = 5000;

/** One `cmd:` value found during the last load, and whether it produced a value. */
export type CmdKeyRecord = { key: string; resolved: boolean };

let cmdKeys: CmdKeyRecord[] = [];

/**
 * Whether `cmd:` values may run.
 *
 * A **grant, denied by default** — and the grant lives in the environment rather than
 * the config file. `.devtools/config.yaml` is discovered by walking up from the cwd, so
 * a cloned repository can supply one; a config-file flag would let that repository
 * unlock its own code execution. The environment is one thing a repository cannot write,
 * so it is the only place the grant is trusted from.
 */
export const isCmdAllowed = (): boolean => {
  const flag = process.env.DEVTOOLS_ALLOW_CMD?.trim().toLowerCase();
  return flag === "1" || flag === "true";
};

/** The `cmd:` keys seen during the last load. Exposed for `show_config` and tests. */
export const getCmdKeys = (): CmdKeyRecord[] => [...cmdKeys];

/** Replace ${VAR} with process.env.VAR. An unknown name becomes an empty string. */
const expandEnvVars = (input: string): string =>
  input.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");

/**
 * Run a `cmd:` value and return its stdout.
 *
 * `stdio[0]` is `"ignore"` on purpose: in MCP stdio mode stdin carries the JSON-RPC
 * stream, and a helper that consumed it would corrupt the session.
 */
/**
 * Record a `cmd:` that did not run, name the key, and carry on with an empty value.
 *
 * Never a throw. Resolution walks the whole document before anything chooses a provider,
 * so a failure here cannot know which tools it would have affected — a config built
 * around the database must not die because a GitLab secret could not be fetched. The key
 * is reported unresolved by `show_config`, and the provider that wanted it fails where it
 * is used, naming its own config key.
 */
const skipCmd = (keyPath: string, reason: string): string => {
  cmdKeys.push({ key: keyPath, resolved: false });
  console.warn(`⚠️ ${keyPath} uses \`cmd:\` but ${reason}`);
  return "";
};

/**
 * Run a `cmd:` value and return its stdout, or `""` if it fails.
 *
 * `stdio[0]` is `"ignore"` on purpose: in MCP stdio mode stdin carries the JSON-RPC
 * stream, and a helper that consumed it would corrupt the session. The cost is that a
 * helper needing an interactive prompt — `pass` through gpg-agent's pinentry — can never
 * be answered, so the timeout below turns its hang into a warning, not a fix.
 */
const runCmd = (raw: string, keyPath: string): string => {
  const command = expandEnvVars(raw.slice(CMD_PREFIX.length));

  try {
    const stdout = execSync(command, {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: CMD_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    cmdKeys.push({ key: keyPath, resolved: true });
    // Only a single trailing newline is the shell's, not the value's. `trim()` would
    // also strip leading whitespace, which a secret may legitimately contain.
    return stdout.replace(/\r?\n$/, "");
  } catch (error: any) {
    const timedOut = error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT";
    // The command's stdout and stderr are never echoed: stdout holds the secret this
    // exists to fetch, and stderr can repeat it (curl echoing a header on failure).
    return skipCmd(
      keyPath,
      timedOut
        ? `it timed out after ${CMD_TIMEOUT_MS}ms, so it resolved to "". Run it manually to see why; ` +
            `its output is not logged because it may contain a secret.`
        : `it exited with status ${error?.status ?? "unknown"}, so it resolved to "". Run it manually to see why; ` +
            `its output is not logged because it may contain a secret.`,
    );
  }
};

function readAndParse(candidate: string): Config {
  const content = readFileSync(candidate, "utf-8");
  const parsed = parse(content) as Config;
  cmdKeys = [];
  return resolveValues(parsed, "");
}

/**
 * Resolve every string in the document: `cmd:` values run, `${VAR}` placeholders expand.
 * `keyPath` is carried so a failure can name the offending key rather than the document.
 *
 * `commandsEnabled` goes false inside a provider block declaring `enabled: false`: there
 * is no reason to shell out for a provider the caller switched off, and a helper that
 * hangs would otherwise stall a startup that was never going to use it.
 */
export const resolveValues = (
  value: any,
  keyPath: string,
  commandsEnabled = true,
): any => {
  if (typeof value === "string") {
    // The `cmd:` decision is taken on the raw string, never on the expanded one, so an
    // environment variable that happens to expand into `cmd:...` cannot smuggle in a
    // command. Env vars still expand *inside* the command body, in `runCmd`.
    if (!value.startsWith(CMD_PREFIX)) return expandEnvVars(value);
    if (!commandsEnabled) {
      return skipCmd(keyPath, "its provider sets enabled: false, so it was not run.");
    }
    if (!isCmdAllowed()) {
      return skipCmd(
        keyPath,
        "command values are disabled. " +
          "Set DEVTOOLS_ALLOW_CMD=1 in the environment the server is launched with to enable them.",
      );
    }
    return runCmd(value, keyPath);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      resolveValues(item, `${keyPath}[${index}]`, commandsEnabled),
    );
  }
  if (value && typeof value === "object") {
    const resolved: any = {};
    for (const [key, item] of Object.entries(value)) {
      // `providers.<name>` is where a provider declares itself off, and everything beneath
      // it follows that decision.
      const childCommandsEnabled =
        keyPath === "providers" &&
        item !== null &&
        typeof item === "object" &&
        (item as any).enabled === false
          ? false
          : commandsEnabled;

      resolved[key] = resolveValues(
        item,
        keyPath ? `${keyPath}.${key}` : key,
        childCommandsEnabled,
      );
    }
    return resolved;
  }
  return value;
};
