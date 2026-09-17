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

# Write policy. One meaning for every provider: a grant, denied by default.
security:
  allow_write: false                  # true enables the write tools
  blocked_env: [production, prod]     # connection name, or GitLab project path

providers:
  database:
    enabled: true                     # only an explicit false disables
    default_engine: postgresql        # postgresql | mysql | mariadb
    connections:
      dev:
        dsn: ${DEV_DATABASE_URL}
        pool_size: 10                 # optional
        timeout: 30000                # optional, ms
    security:                         # optional override, wins over the shared block
      allow_write: true
      blocked_env: [production, prod, staging]

  gitlab:
    enabled: true
    url: https://gitlab.com
    token: ${GITLAB_TOKEN}
    projectId: 12345
    security:
      allow_write: true               # grant for gitlab_create_note
      blocked_env: [production]       # matched against the project path or ID

  redis:
    enabled: true
    default_connection: dev
    connections:
      dev:
        url: ${REDIS_URL}
        timeout: 5000
      cache:
        url: redis://localhost:6379/1
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
        timeout: 5000
    security:
      allow_write: false              # narrow redis while the others stay writable
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
| `timeout` | both | Socket/connect timeout in ms (default `5000`) |

Sentinel connections resolve the current master via the Sentinel nodes on every
connect, so failovers are picked up automatically. `role: slave` resolves a
replica; writing through it fails with `READONLY`.

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
| Write gate (any provider) | `providers.<provider>.security.allow_write` ?? `security.allow_write` ?? `security.execute_query.allow_write` ?? `false` | `false` |
| Blocked identifiers (any provider) | `providers.<provider>.security.blocked_env` ?? `security.blocked_env` ?? `security.execute_query.blocked_env` ?? `[production, prod]` | `[production, prod]` |
| GitLab config | `providers.gitlab` ?? `gitlab` | — |
| GitLab project | `params.project_id` ?? `providers.gitlab.projectId` ?? `gitlab.projectId` | — |
| Redis config | `providers.redis` ?? `redis` | — |

Both security keys resolve through **one chain, for every provider**:

- The provider-scoped block wins when present, so a policy can be set once at the
  top level and narrowed for a single provider where it differs.
- `blocked_env` is *restrictive*, so every level is consulted: a fallback can only
  ever block more, never less.
- `allow_write` is a *grant*, so it is denied when nothing sets it. A missing or
  misspelled block fails closed.
- `security.execute_query.*` is the deprecated spelling of `security.*`. It is still
  honoured for one release and never overrides the newer keys.

Legacy top-level shape (still honoured, now deprecated):

```yaml
database:
  default_engine: postgresql
  connections: { dev: { dsn: ${DEV_DATABASE_URL} } }
security:
  allow_write: true
  blocked_env: [production, prod]
gitlab:
  url: https://gitlab.com
  token: ${GITLAB_TOKEN}
  projectId: 12345
redis:
  default_connection: dev
  connections: { dev: { url: ${REDIS_URL} } }
```

## Security model

### What is actually enforced

| Gate | Key read | Notes |
| :--- | :--- | :--- |
| Provider kill switch | `providers.<provider>.enabled` | Only an explicit `false` disables |
| Database writes | `providers.database.security.allow_write` → `security.allow_write` | **Grant: denied by default.** Any statement not matching `/^\s*SELECT/i` counts as a write |
| Redis writes | `providers.redis.security.allow_write` → `security.allow_write` | **Grant: denied by default.** Applies to `redis_set_key`, `redis_delete_key`, `redis_expire_key` |
| GitLab writes | `providers.gitlab.security.allow_write` → `security.allow_write` | **Grant: denied by default.** Applies to `gitlab_create_note` |
| Database / Redis blocked identifiers | `providers.<provider>.security.blocked_env` → `security.blocked_env` | Case-insensitive substring match against the **connection name** — not the DSN |
| GitLab blocked identifiers | `providers.gitlab.security.blocked_env` → `security.blocked_env` | GitLab has no environment concept, so the list is matched against the resolved **project path or numeric ID**, e.g. `group/production-app` |

There is no per-connection flag. A connection is protected by naming it in its
provider's `blocked_env`; that is the only per-connection control.

Because `blocked_env` is a substring match, a GitLab project path that merely
contains `prod` is blocked by the built-in default. Set a provider-scoped list when
a project name happens to contain a blocked word.

### Reserved keys

Only one declared key is still inert:

| Key | Status |
| :--- | :--- |
| `codegraph` | **Not read.** Reserved for future codegraph tooling. |

### Migrating from 0.1.x

`allow_write` used to be a **kill switch** for GitLab and Redis (absent meant
allowed) and a **grant** for the database. It is now a grant everywhere, and
`readonly` is gone. Both changes are breaking.

| Old | New |
| :--- | :--- |
| `providers.{gitlab,redis}.security.allow_write: false` (opt-out) | `security.allow_write: true` (opt-in). GitLab and Redis writes are **blocked** until a config grants them |
| `providers.database.security.allow_write: true` | unchanged |
| `security.execute_query.{allow_write,blocked_env}` | `security.{allow_write,blocked_env}` — the old path still works for one release |
| `redis.connections.<name>.readonly: false` (allowed writes) | `security.allow_write: true`, and keep the connection out of `blocked_env` |
| `redis.connections.<name>.readonly: true` (blocked writes) | add the connection name to `blocked_env` |
| `database.connections.<name>.readonly` | ignored before, removed now — it never gated anything |
| `providers.gitlab.security.blocked_env: []` | GitLab now inherits the shared list, so path matching applies unless you override it |

Because a newly added connection is writable as soon as its provider is granted,
the grant plus `blocked_env` are the whole protection — there is no per-connection
fail-safe any more.

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

- an `id_generator.default` (from `--idGenerator`, default `ulid`)
- a top-level `security` block with `allow_write: false` and
  `blocked_env: [production, prod]`
- `providers.gitlab` with `enabled`, `url`, `token`, `projectId`
- `providers.redis` with `enabled`, `default_connection`, `connections`

Known limits:

- Redis connections are always written **standalone** — sentinel config,
  `master_name`, sentinel TLS, and `username`/`password` cannot be generated.
- The write policy is written **once**, at the top level. No provider-scoped
  `security` block is emitted, because the shared one already applies to all three
  providers — narrow it with a provider block when one needs different rules.
- The scaffolded file therefore denies every write tool. Set `allow_write: true`
  in the shared block, or in one provider's block, to enable them.
- No connection carries a `readonly` flag: that key is gone.
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
