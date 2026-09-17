# Configuration

> How DevTools MCP loads, resolves, and reloads its configuration.

Every key documented here was checked against the code that reads it. Keys that
are accepted by the type system but not yet consumed are explicitly marked as
**reserved** — see [Source of truth](#source-of-truth).

## Config file location

Configuration lives in `.devtools/config.yaml` at your project root (or any
parent directory). The loader walks up the directory tree from the current
working directory until it finds the file:

```typescript
while (dir !== "/") {
  const candidate = resolve(dir, ".devtools", "config.yaml")
  if (existsSync(candidate)) return parse(candidate)
  dir = dirname(dir)
}
```

The **first** match wins, and discovery starts at `process.cwd()`, so launching
the server from a subdirectory still finds the project config — no need to pass
the path to each MCP client.

## Full example

```yaml
id_generator:
  default: ulid                       # ulid | uuid — read by generate_id

providers:
  database:
    enabled: true                     # only an explicit false disables
    default_engine: postgresql        # postgresql | mysql | mariadb
    connections:
      dev:
        dsn: ${DEV_DATABASE_URL}
        readonly: false
        pool_size: 10                 # optional
        timeout: 30000                # optional, ms
    security:
      allow_write: false
      blocked_env: [production, prod]

  gitlab:
    enabled: true
    url: https://gitlab.com
    token: ${GITLAB_TOKEN}
    projectId: 12345
    security:
      allow_write: true               # only an explicit false blocks writes
      blocked_env: []                 # matched against the project path or ID

  redis:
    enabled: true
    default_connection: dev
    connections:
      dev:
        url: ${REDIS_URL}
        readonly: true
        timeout: 5000
      cache:
        url: redis://localhost:6379/1
        readonly: true
      sentinel-dev:
        sentinels:
          - host: 127.0.0.1
            port: 26379
          - host: 127.0.0.1
            port: 26380
        master_name: mymaster
        role: master                  # master | slave, default master
        sentinel_username: ${REDIS_SENTINEL_USER}
        sentinel_password: ${REDIS_SENTINEL_PASSWORD}
        password: ${REDIS_PASSWORD}
        db: 0
        readonly: true
        timeout: 5000
    security:
      allow_write: true               # only an explicit false blocks writes
      blocked_env: [production, prod] # matched against the connection name

# Reserved for the planned codegraph tool (PRD 5.5) — not read yet.
codegraph:
  enabled: false
  exclude: []
```

### `id_generator.default`

Preferred identifier format for the `generate_id` tool: `ulid` (default) or
`uuid`. A per-call `format` parameter overrides it. An unrecognised value is a
hard error rather than a silent fallback, so a typo surfaces immediately.

`generate_ulid` and `generate_uuid` are independent tools and are unaffected by
this setting.

### `codegraph`

**Reserved, but not dead code.** `CodegraphConfig` (`enabled`, `exclude`) matches the
`codegraph` tool planned in [PRD §5.5](./PRD.md) — "dependency graph / call graph,
default on, configurable exclude path" — so the type exists to let a config be written
ahead of the tool. Nothing in `src/` reads it yet: setting `codegraph` has no effect
today.

Any other unknown top-level key is ignored silently — parsing is unvalidated, so
typo'd keys fail quietly rather than erroring.

### Redis connection fields

A connection is either **standalone** (`url`) or **sentinel-backed**
(`sentinels` + `master_name`) — one of the two must be present.

| Field | Applies to | Description |
| :--- | :--- | :--- |
| `url` | standalone | `redis://[user:pass@]host[:port][/db]` |
| `sentinels` | sentinel | `{ host, port }` list. `port` defaults to `26379` |
| `master_name` | sentinel | Sentinel master group name |
| `role` | sentinel | `master` (default) or `slave` |
| `sentinel_username` / `sentinel_password` | sentinel | AUTH for the Sentinel nodes themselves |
| `sentinel_tls` | sentinel | Enable TLS when talking to the sentinels |
| `username` / `password` | both | AUTH for the data node (Redis 6+ ACL) |
| `db` | both | Logical database index (default `0`) |
| `readonly` | both | Defaults to `true`; must be `false` for write tools |
| `timeout` | both | Socket/connect timeout in ms (default `5000`) |

Sentinel connections resolve the current master via the Sentinel nodes on every
connect, so failovers are picked up automatically. `role: slave` resolves a
replica; combined with `readonly: false` writes will fail with `READONLY`.

The active connection is `connectionName` → `default_connection` → first key in
`connections`.

## Environment variable resolution

`${ENV_VAR}` placeholders are resolved from `process.env` at load time. The
substitution is **recursive over every string value** in the parsed document, so
it works in scalars, arrays, and nested maps alike. Unresolved placeholders
become empty strings rather than errors.

A `.env` file in the working directory is loaded via dotenv when the config
module is first imported.

```yaml
providers:
  database:
    connections:
      dev:
        dsn: ${DEV_DATABASE_URL}   # resolves to process.env.DEV_DATABASE_URL
```

There is no separate environment-override layer: `${VAR}` interpolation is the
only way environment variables affect configuration.

## Runtime store

After load, the parsed config is kept on the global `__devtools_config` and read
directly by tools (`const config = (global as any).__devtools_config`). Provider
clients are created lazily on first use, so running an unrelated tool (e.g. `id`)
never triggers GitLab, database, or Redis setup.

## Value precedence

Because `providers.*` was introduced after the original top-level keys, every
lookup falls back to the legacy location. The exact expressions in code are:

| Value | Resolution chain | Default |
| :--- | :--- | :--- |
| Database config | `providers.database` ?? `database` | — |
| Database engine | `database.default_engine` | `postgresql` |
| Provider enabled | `providers.<provider>.enabled` | enabled unless `false` |
| DB write gate | `providers.database.security.allow_write` ?? `security.execute_query.allow_write` ?? `false` | `false` |
| GitLab write gate | `providers.gitlab.security.allow_write` | `true` unless `false` |
| Redis write gate | `providers.redis.security.allow_write` | `true` unless `false` |
| DB blocked envs | `providers.database.security.blocked_env` ?? `security.execute_query.blocked_env` ?? `[production, prod]` | `[production, prod]` |
| Redis blocked envs | `providers.redis.security.blocked_env` ?? `security.execute_query.blocked_env` ?? `[production, prod]` | `[production, prod]` |
| GitLab blocked envs | `providers.gitlab.security.blocked_env` | `[]` |
| GitLab config | `providers.gitlab` ?? `gitlab` | — |
| GitLab project | `params.project_id` ?? `providers.gitlab.projectId` ?? `gitlab.projectId` | — |
| Redis config | `providers.redis` ?? `redis` | — |

Two inheritance rules differ on purpose:

- **Restrictive keys inherit.** `blocked_env` falls back to the shared
  `security.execute_query.blocked_env` and then to the built-in default, because a
  fallback can only ever block *more*.
- **Permissive keys never inherit across providers.** `allow_write` for GitLab and
  Redis is not read from `security.execute_query`, because inheriting a grant would
  silently widen write access. The database is the exception: that shared block was
  its own original home. GitLab's `blocked_env` likewise inherits nothing.

Legacy top-level shape (still honoured, now deprecated):

```yaml
database:
  default_engine: postgresql
  connections: { dev: { dsn: ${DEV_DATABASE_URL}, readonly: false } }
security:
  execute_query:
    allow_write: false
    blocked_env: [production, prod]
gitlab:
  url: https://gitlab.com
  token: ${GITLAB_TOKEN}
  projectId: 12345
redis:
  default_connection: dev
  connections: { dev: { url: ${REDIS_URL}, readonly: true } }
```

## Security model

### What is actually enforced

| Gate | Key read | Notes |
| :--- | :--- | :--- |
| Provider kill switch | `providers.<provider>.enabled` | Only an explicit `false` disables |
| Database writes | `providers.database.security.allow_write` (or legacy) | **Grant-style: denied by default.** Any statement not matching `/^\s*SELECT/i` counts as a write |
| Database blocked envs | `providers.database.security.blocked_env` (or legacy) | Case-insensitive substring match against the **connection name** — not the DSN |
| Redis writes | `providers.redis.security.allow_write` **and** `connections.<name>.readonly` | Both gates must pass: `allow_write` allows unless explicitly `false`, and `readonly` must be exactly `false` |
| Redis blocked envs | `providers.redis.security.blocked_env` (or legacy) | Case-insensitive substring match against the connection name |
| GitLab writes | `providers.gitlab.security.allow_write` | Applies to `gitlab_create_note`. **Kill-switch style: allowed unless explicitly `false`** |
| GitLab blocked envs | `providers.gitlab.security.blocked_env` | GitLab has no environment concept, so the list is matched against the resolved **project path or numeric ID**, e.g. `group/production-app` |

### Reserved keys

Only one declared key is still inert:

| Key | Status |
| :--- | :--- |
| `codegraph` | **Not read.** Reserved for future codegraph tooling. |

#### Why `allow_write` does not mean the same thing everywhere

`database.security.allow_write` is a **grant**: absent means deny, so a missing or
misspelled block fails closed. GitLab and Redis use the same key as a **kill
switch**: absent means allow, and only an explicit `false` blocks.

The asymmetry is deliberate. Both providers were already writable before the key
existed (`readonly: false` on a Redis connection, a GitLab token), so denying by
default would have broken every existing configuration. To disable writes set
`allow_write: false`; to allow them, omit the block or set `true`.

Credentials are never logged or returned in tool responses; `show_config` and
`providers_info` report only `token_configured` / `auth_configured` booleans.

## Live reload

The resolved config file path is watched with `fs.watch`. On change the file is
re-parsed, env vars re-resolved, and the runtime store replaced — no server
restart. This happens outside the MCP protocol, so the server logs to stderr:

```
🔄 .devtools/config.yaml reloaded
```

The watcher is armed at server start and re-armed whenever a config is created or
discovered (`config_init`, `reload_config`). It is `unref()`ed, so it never keeps the
process alive — one-shot CLI commands exit normally.

It watches the containing `.devtools/` **directory**, not the file, and filters by
basename. `fs.watch` on a file follows the inode, so a rename-replace save (vim with
`backupcopy=no`, several IDEs) would leave the watcher attached to the old inode and
silently stop live reload for the rest of the session.

### What a reload does and does not rebuild

| Thing | On reload |
| :--- | :--- |
| Runtime store (`__devtools_config`) | Replaced with the file's content |
| Session overrides from `gitlab_set_config` / `database_set_connection` | **Discarded** — they live in the runtime store, so the file wins |
| GitLab client | Rebuilt when `url`, `token` or `projectId` changed, cleared when the config is removed or `enabled: false` |
| Database and Redis connections | Nothing to do — a fresh connection is constructed per call, so none hold stale state |

GitLab is the only provider with a cached client, so it is the only one that needs
rebuilding. `getGitLabClient()` fingerprints the config it was built from, which makes
this work for every path — the watcher, `reload_config`, `config_init`, and a token
supplied at runtime by `gitlab_set_config`.

Caveats:

1. If no `.devtools/config.yaml` exists at startup there is nothing to watch yet. Run
   `config_init` or `reload_config` once and the watcher latches onto the file, after
   which edits reload automatically.
2. If a reload fails, the previous valid configuration stays active and the error is
   recorded as `runtime.reloadError` in `show_config`.
3. The watcher follows the resolved path: if the file moves and a later reload picks up
   the new location, the watcher is re-pointed at it.
4. Directory events for siblings in `.devtools/` are ignored by basename; when a
   platform reports no filename the server reloads conservatively (debounced).

## `config_init` output

The `config_init` tool scaffolds a starter file. It writes:

- `id_generator.default` (from `--idGenerator`, default `ulid`)
- `providers.database` with `enabled`, `default_engine`, `connections`, and a
  `security.allow_write: false` block
- `providers.gitlab` with `enabled`, `url`, `token`, `projectId`
- `providers.redis` with `enabled`, `default_connection`, `connections`

Known limits:

- Redis connections are always written **standalone** — sentinel config,
  `master_name`, sentinel TLS, and `username`/`password` cannot be generated.
- Only the `database` provider gets a `security` block, emitted as
  `allow_write: false` to match that provider's deny-by-default semantics. No
  block is written for GitLab or Redis, whose `allow_write` is a kill switch —
  emitting `false` there would disable writes in a freshly scaffolded config.
- `codegraph` and the legacy top-level keys are never emitted.
- It refuses to run when `.devtools/config.yaml` already exists.

## Source of truth

| Concern | File |
| :--- | :--- |
| Discovery, parsing, `${VAR}` resolution | `src/core/config.ts` |
| Types (`Config`, `ProvidersConfig`, provider configs) | `src/core/types.ts` |
| GitLab client build + freshness fingerprint | `src/providers/gitlab.ts` |
| Runtime store, load state, reload errors | `src/core/runtime-config.ts` |
| Write/blocked-env policy resolution | `src/core/security.ts` |
| Watcher, boot sequence | `src/index.ts` |
| Watcher arming, debounce, re-targeting | `src/core/config-watch.ts` |
| Database write/blocked-env gates | `src/tools/database/query.ts` |
| Redis write/blocked-env gates | `src/providers/redis-helper.ts` |
| GitLab init, enabled gate | `src/providers/gitlab.ts` |
| Redacted config view | `src/tools/config/show.ts` |
| Starter file generation | `src/tools/misc/config-init.ts` |
| Identifier format resolution | `src/tools/id-generators/id.ts` |
