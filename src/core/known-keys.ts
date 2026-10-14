/**
 * The config keys this server actually reads.
 *
 * A key that no code path reads is a guard the writer believes is armed. Inventing that
 * belief is worse than refusing the write, because nothing ever fails: `readonly: true`
 * lived in databases for months while every write went through. So the parser records
 * what it does not recognise, and the surface that answers "what am I running?" reports
 * it.
 *
 * This table is the single source of truth for that check, so adding a key to
 * `src/core/types.ts` means adding it here — a key in one and not the other is reported
 * as ignored, which is a loud failure rather than a silent one.
 */

export type IgnoredKey = {
  /** Dotted path, as written in the file: `providers.database.connections.dev.readonlyd`. */
  key: string;
  /** Where the key belongs, when it moved somewhere else rather than being dropped. */
  hint?: string;
};

type KnownNode = null | { [key: string]: KnownNode };

/** The shared shape of a `security` block, at the top level and per provider. */
const SECURITY: KnownNode = { allow_write: null, blocked_env: null };

const KNOWN: KnownNode = {
  id_generator: { default: null },
  security: SECURITY,
  codegraph: { enabled: null, exclude: null },
  providers: {
    database: {
      enabled: null,
      security: SECURITY,
      default_engine: null,
      connections: {
        "*": {
          dsn: null,
          pool_size: null,
          timeout: null,
          connect_timeout: null,
          readonly: null,
          ssl: {
            ca: null,
            cert: null,
            key: null,
            rejectUnauthorized: null,
          },
        },
      },
    },
    redis: {
      enabled: null,
      security: SECURITY,
      default_connection: null,
      connections: {
        "*": {
          url: null,
          sentinels: { "*": { host: null, port: null } },
          master_name: null,
          role: null,
          sentinel_username: null,
          sentinel_password: null,
          sentinel_tls: null,
          username: null,
          password: null,
          db: null,
          timeout: null,
          readonly: null,
        },
      },
    },
    gitlab: {
      enabled: null,
      security: SECURITY,
      url: null,
      token: null,
      projectId: null,
    },
  },
};

/**
 * Keys that were read once and are not any more. Naming the replacement is the whole
 * point: "unknown key" leaves the reader editing the file by trial and error.
 */
const HINTS: Record<string, string> = {
  database:
    "Providers live under `providers:`. Move this block to `providers.database`.",
  redis:
    "Providers live under `providers:`. Move this block to `providers.redis`.",
  gitlab:
    "Providers live under `providers:`. Move this block to `providers.gitlab`.",
  execute_query:
    "The top-level `execute_query` block is gone. The write grant is `security.allow_write` (top level or `providers.database.security`).",
  enabled:
    "A connection is not switched off individually; a provider is, with `providers.<provider>.enabled`.",
  // Path-qualified because the replacement depends on where the key was written.
  "providers.gitlab.host":
    "The GitLab instance address is `url` (e.g. `url: https://gitlab.example.com`).",
};

/** Keys nested under something whose name is not fixed (connections, sentinels). */
const isWildcard = (node: KnownNode): boolean => node !== null && "*" in node;

export const findIgnoredKeys = (config: unknown): IgnoredKey[] => {
  const found: IgnoredKey[] = [];

  const collect = (schema: KnownNode, value: unknown, prefix: string): void => {
    if (schema === null) return;
    // Arrays and scalars sit where the table says a block is; nothing beneath them to
    // check, and calling that an ignored key would report a malformed value, not a
    // stray one.
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return;

    const wildcard = isWildcard(schema) ? schema["*"] : undefined;

    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const path = prefix ? `${prefix}.${key}` : key;
      const childSchema = wildcard ?? schema[key];
      if (childSchema === undefined) {
        const hint = HINTS[key] ?? HINTS[path];
        found.push(hint ? { key: path, hint } : { key: path });
        continue;
      }
      collect(childSchema, child, path);
    }
  };

  collect(KNOWN, config, "");
  return found;
};
