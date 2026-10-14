import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { applyRuntimeConfig } from "../../core/runtime-config.js";
import { startConfigWatcher } from "../../core/config-watch.js";
import { loadConfig } from "../../core/config.js";

const referenceTemplate = `# DevTools MCP - Configuration
# ============================================================
# Providers are initialized lazily: only when a tool that needs
# them is first invoked. Each provider is gated by \`enabled\`.
# \${ENV_VAR} placeholders resolve from process.env / .env at load.
# ============================================================

id_generator:
  default: ulid

# Write policy. Denied by default: allow_write is a grant, so only true enables the
# write tools (execute_query, redis set/delete/expire, gitlab_create_note).
# blocked_env is matched against the connection name, or the GitLab project path.
# A providers.<provider>.security block overrides these for one provider.
# A connection carrying 'readonly: true' refuses writes whatever allow_write says.
security:
  allow_write: false
  blocked_env: [production, prod]
`;

const minimalTemplate = `id_generator:
  default: ulid
`;

const yamlJoin = (lines: (string | undefined)[], indent = 2): string =>
  lines
    .filter((line) => line !== undefined && line !== "")
    .map((line) => " ".repeat(indent) + line!)
    .join("\n");

const q = (str: string): string =>
  /:\s|\s|^[\-?]|^\s|\s$|#|\[|\]|\{|\}|,|&|\*|!|\||>|'|"|%|@|`/.test(str)
    ? JSON.stringify(str)
    : str;

const listConnections = (
  entries: { name: string; [key: string]: any }[] | undefined,
  type: "database" | "redis",
): string | undefined => {
  if (!entries?.length) return undefined;
  const blocks = entries.map((entry) => {
    const name = entry.name;
    const fields: string[] = [`${name}:`];
    if (type === "database") {
      fields.push(`  dsn: ${q(entry.dsn ?? "")}`);
      if (entry.pool_size) fields.push(`  pool_size: ${entry.pool_size}`);
      if (entry.timeout) fields.push(`  timeout: ${entry.timeout}`);
      // Emitted only when asked for: a scaffolded file should not appear to guard a
      // connection that is in fact writable under a later grant.
      if (entry.readonly === true) fields.push("  readonly: true");
    } else {
      fields.push(`  url: ${q(entry.url ?? "")}`);
      if (entry.db !== undefined) fields.push(`  db: ${entry.db}`);
      if (entry.timeout) fields.push(`  timeout: ${entry.timeout}`);
    }
    return fields.join("\n");
  });
  return blocks.join("\n");
};

export const configInitTool: Tool = {
  name: "config_init",
  description:
    "Create a starter .devtools/config.yaml with the requested provider connections (database, gitlab, redis); refuses to overwrite an existing config",
  params: {
    database: {
      type: "array",
      optional: true,
      description:
        "Array of database connections: [{ name, dsn, pool_size?, timeout?, readonly? }]. The provider has one engine, so `engine` on the first entry becomes providers.database.default_engine and applies to every connection.",
    },
    gitlab: {
      type: "object",
      optional: true,
      description:
        "GitLab config: { url?, token?, projectId?, tokenEnv? } where tokenEnv names a ${VAR} placeholder",
    },
    redis: {
      type: "array",
      optional: true,
      description: "Array of Redis connections: [{ name, url, db?, timeout? }]",
    },
    idGenerator: {
      type: "string",
      optional: true,
      description: '"ulid" | "uuid" (default: ulid)',
      default: "ulid",
    },
    templatePath: {
      type: "string",
      optional: true,
      description:
        "Optional absolute path to a reference config template to render",
    },
  },
  execute: async (params) => {
    const cwd = process.cwd();
    const configDir = join(cwd, ".devtools");
    const configPath = join(configDir, "config.yaml");
    if (existsSync(configPath)) {
      throw new ToolError(
        "CONFIG_EXISTS",
        `A configuration already exists at ${configPath}.`,
        "Confirm with the user whether to overwrite it; if so, remove or back it up and retry config_init.",
        true,
        { cause: `${configPath} already exists` },
      );
    }

    mkdirSync(configDir, { recursive: true });

    const db = params.database;
    const gitlab = params.gitlab;
    const redis = params.redis;
    const idGenerator = (params.idGenerator as string) ?? "ulid";
    const template = params.templatePath
      ? existsSync(params.templatePath)
        ? readFileSync(params.templatePath, "utf-8")
        : null
      : null;

    const gitlabToken = gitlab?.tokenEnv
      ? `\${${gitlab.tokenEnv}}`
      : (gitlab?.token ?? undefined);

    const providerBlocks: string[] = [];

    if (db?.length) {
      providerBlocks.push(`  database:
    enabled: true
    default_engine: ${db[0].engine ?? "postgresql"}
    connections:
${yamlJoin(listConnections(db, "database")?.split("\n") ?? [], 4)}`);
    }
    if (gitlab) {
      providerBlocks.push(
        [
          "  gitlab:",
          "    enabled: true",
          `    url: ${q(gitlab.url ?? "https://gitlab.com")}`,
          gitlabToken ? `    token: ${q(gitlabToken)}` : undefined,
          gitlab.projectId
            ? `    projectId: ${q(String(gitlab.projectId))}`
            : undefined,
        ]
          .filter((line) => line !== undefined)
          .join("\n"),
      );
    }
    if (redis?.length) {
      // No provider-scoped `security` block: the shared one above sets the policy
      // for every provider, so a per-provider copy would only be noise.
      providerBlocks.push(`  redis:
    enabled: true
    default_connection: ${redis[0].name}
    connections:
${yamlJoin(listConnections(redis, "redis")?.split("\n") ?? [], 4)}`);
    }

    let content: string;
    if (providerBlocks.length) {
      content = `${template ?? referenceTemplate}\n\nproviders:\n${providerBlocks.join(
        "\n",
      )}`;
    } else {
      content = template ?? referenceTemplate;
    }

    if (!content.includes("id_generator:")) {
      content = `id_generator:\n  default: ${idGenerator}\n\n` + content;
    } else {
      content = content.replace(
        /default: ulid|default: uuid/,
        `default: ${idGenerator}`,
      );
    }

    writeFileSync(configPath, content.trimEnd() + "\n", "utf-8");

    const providers = [
      ...(db?.length
        ? [{ provider: "database", connections: db.map((c) => c.name) }]
        : []),
      ...(gitlab ? [{ provider: "gitlab", connections: [] }] : []),
      ...(redis?.length
        ? [{ provider: "redis", connections: redis.map((c) => c.name) }]
        : []),
    ];

    const loaded = await loadConfig();
    applyRuntimeConfig(loaded, true);

    // The scaffolded file did not exist at boot, so point the watcher at it now.
    startConfigWatcher();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            data: {
              created: true,
              path: configPath,
              providers,
              runtime_loaded: true,
            },
          }),
        },
      ],
    };
  },
};
