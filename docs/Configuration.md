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
        timeout: 30000                # optional, ms — idle timeout
        connect_timeout: 10000        # optional, ms — how long to wait to connect
      prod:
        dsn: ${PROD_DATABASE_URL}     # no TLS parameters in the DSN
        ssl:
          ca: /etc/ssl/aiven-ca.pem   # path, read at connect time
    security:                         # optional override, wins over the shared block
      allow_write: true
      blocked_env: [production, prod, staging]

  gitlab:
    enabled: true
    url: https://gitlab.com
    token: ${GITLAB_TOKEN}
    projectId: 12345
    security:
      allow_write: true               # grant for the GitLab note tools (create/update/delete)
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

### Database connection fields

| Field | Description |
| :--- | :--- |
| `dsn` | `postgresql://`, `postgres://`, `mysql://`, or `mariadb://`. Percent-encode reserved characters in credentials |
| `pool_size` | Maximum pooled connections (default `10`) |
| `timeout` | **Idle** timeout in ms for a pooled connection (default `30000`) |
| `connect_timeout` | How long to wait for a connection to be *established*, in ms (default `10000`). Without it a host that accepts TCP and then stalls would hold the tool call open indefinitely |
| `ssl` | TLS settings, applied on top of the DSN — see [TLS and the DSN](#tls-and-the-dsn) |

#### `ssl`

| Field | Description |
| :--- | :--- |
| `ca` | Path to one or more PEM CA certificates to trust |
| `cert` / `key` | Paths to a client certificate and its private key |
| `rejectUnauthorized` | Verify the server certificate chain (default `true`). `false` encrypts without authenticating the server |

`ca`, `cert`, and `key` are **paths, read at connect time** — never certificate
contents in the config file, whose size and lifetime belong elsewhere. `show_config`
reports the paths; the contents are never returned.

#### TLS and the DSN

A DSN says *how to reach* a server; `ssl` says *whether to trust it*. When a
connection declares an `ssl` block, any TLS parameter in its DSN (`sslmode`,
`sslrootcert`, `ssl=true`, `uselibpqcompat`) is removed before the connection is
opened: `pg` merges the connection string *over* its options object, so a leftover
DSN parameter would silently win and discard the block.

`sslmode` cannot authenticate a **private CA** — the case for any managed backend
that signs with its own project CA (Aiven, among others). On `pg` 8.x, `require`,
`prefer`, and `verify-ca` are treated as aliases for `verify-full` (with a
deprecation warning), so `sslmode=require` does **not** mean "encrypt, do not
verify": Node verifies against the system CA bundle, does not find the private
root, and fails with `SELF_SIGNED_CERT_IN_CHAIN` before authentication is even
attempted. Two ways out, in order of preference:

```yaml
      prod:
        dsn: ${PROD_DATABASE_URL}      # no TLS parameters in the DSN
        ssl:
          ca: /etc/ssl/aiven-ca.pem    # the project CA, from the provider's console
```

```yaml
      prod:
        dsn: ${PROD_DATABASE_URL}
        ssl:
          rejectUnauthorized: false    # encrypted, but the server is not authenticated
```

The first authenticates the server and is what a settled setup should use. The
second keeps the traffic encrypted but accepts whatever certificate the endpoint
presents, so it belongs to a local stopgap. `sslmode=no-verify`, or
`uselibpqcompat=true&sslmode=require`, express the same trade-off at the DSN level.

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
only way environment variables affect configuration. A value can also be produced by a
command instead — see below.

### Command values (`cmd:`)

A value **exactly** prefixed with `cmd:` is replaced by the stdout of that command, run
through a shell. The same recursive walk as `${VAR}`, so it works in scalars, arrays, and
nested maps alike.

```yaml
providers:
  gitlab:
    token: cmd:pass show gitlab/accountb
```

| Rule | Behaviour |
| :--- | :--- |
| Prefix | `startsWith("cmd:")` on the **raw** string, case-sensitive. `dsn: prefix-cmd:foo` is left alone |
| Second order | `${VAR}` is expanded *after* the prefix test, so a variable that merely expands into `cmd:...` is never executed |
| Body | `${VAR}` **is** expanded inside the command: `cmd:pass show gitlab/${ACCOUNT}` |
| Working directory | `process.cwd()` |
| stdin | closed. In MCP stdio mode stdin carries the JSON-RPC stream, and a helper that consumed it would corrupt the session |
| Result | stdout with **one** trailing newline removed — not `trim()`, which would also eat leading whitespace a secret may contain |
| Timeout | 5s |
| Failure | resolves to `""` and warns on stderr, naming the key (`providers.gitlab.token`) and the exit status or the timeout. Never fatal, never a throw — see [When a command fails](#when-a-command-fails). The command's stdout and stderr are never included: stdout holds the secret, and stderr can repeat it |
| Disabled provider | a `cmd:` under `providers.<name>.enabled: false` is not run at all |
| Gate | `DEVTOOLS_ALLOW_CMD` — see below |

#### The gate

Running a command from a config file is a different order of risk from the rest of this
file. Discovery walks up from the working directory, so **a cloned repository can supply
a `.devtools/config.yaml`** — and every other key in it is data, where this one is code.

The gate is `DEVTOOLS_ALLOW_CMD`, read from the environment:

```bash
DEVTOOLS_ALLOW_CMD=1
```

- `1` or `true`, case-insensitive, enables `cmd:`. Anything else — including unset —
  disables it.
- **It is deliberately not a config key.** A `security.allow_cmd: true` flag would be
  self-granting: a repository that ships a `cmd:` could ship the flag that unlocks it, so
  it would prevent accidents while looking like it prevented attacks. The environment is
  the one thing a repository cannot write.
- With the gate closed, a `cmd:` value resolves to `""` and a warning naming the key goes
  to stderr. The load itself still succeeds — a config you merely cloned must not take
  every unrelated tool down with it.
- With the gate open, the command runs. If it fails, see
  [When a command fails](#when-a-command-fails) below.
- A `cmd:` under a provider block that declares `enabled: false` is not run at all. The
  block still resolves and still shows; only the command is skipped.

#### When a command fails

A failed or timed-out command resolves to `""`, warns on stderr naming the key, and the
load continues. It is never fatal, and that is deliberate: resolution walks the whole
document before anything decides which provider the caller wants, so a failure at that
point cannot know which tools it would have affected — and does not get to choose for
them. A GitLab secret that cannot be fetched must not stop a config built around the
database from starting.

The damage is scoped at the point of use instead. The provider that wanted the value ends
up with an empty one: an unusable GitLab token surfaces as `GITLAB_TOKEN_REQUIRED`, naming
`gitlab_set_config`, which can repair it live without a restart. `show_config` marks every
such key `resolved: false`, and a reload re-runs the command, so a fixed helper recovers on
the next config edit.

One consequence is worth stating plainly: under an MCP client, a helper that *prompts*
cannot work. `pass` decrypts through gpg-agent, and gpg-agent asks pinentry on a TTY — but
stdin is closed (see the table above), so the prompt can never be answered and the helper
blocks until the timeout. `pass` therefore needs a preset passphrase
(`gpg-preset-passphrase`); otherwise the
[wrapper script](./MCP-Clients.md#injecting-secrets) — which fetches the secret and `exec`s
the server, with no `cmd:` involved — is the way to use it.

`show_config` reports which keys resolved this way — paths only, never values — so a
`cmd:` inherited from someone else's repository is visible:

```json
"command_values": {
  "enabled": false,
  "values": [{ "key": "providers.gitlab.token", "resolved": false }]
}
```

For a single secret, a wrapper script that exports the value before `exec`-ing the server
is still the lower-risk option: no new config surface, and no gate to remember. See
[MCP Clients](./MCP-Clients.md).

## Runtime store

After load, the parsed config is kept on the global `__devtools_config` and read
directly by tools (`const config = (global as any).__devtools_config`). Provider
clients are created lazily on first use, so running an unrelated tool (e.g. `id`)
never triggers GitLab, database, or Redis setup.

## Value precedence

Every provider is read from `providers.<provider>`. The only fallback left is within
the security keys themselves, where a provider-scoped block overrides the shared one.
The exact expressions in code are:

| Value | Resolution chain | Default |
| :--- | :--- | :--- |
| Database / GitLab / Redis config | `providers.<provider>` — no top-level fallback | — |
| Database engine | `providers.database.default_engine` | `postgresql` |
| Provider enabled | `providers.<provider>.enabled` | enabled unless `false` |
| Write gate (any provider) | `providers.<provider>.security.allow_write` ?? `security.allow_write` ?? `false` | `false` |
| Blocked identifiers (any provider) | `providers.<provider>.security.blocked_env` ?? `security.blocked_env` ?? `[production, prod]` | `[production, prod]` |
| GitLab project | `params.project_id` ?? `providers.gitlab.projectId` | — |

Both security keys resolve through **one chain, for every provider**:

- The provider-scoped block wins when present, so a policy can be set once at the
  top level and narrowed for a single provider where it differs.
- `blocked_env` is *restrictive*, so every level is consulted: a fallback can only
  ever block more, never less.
- `allow_write` is a *grant*, so it is denied when nothing sets it. A missing or
  misspelled block fails closed.
- `security.execute_query.*` was the older home of these keys. It is **gone** — not
  deprecated, not aliased. Move the block up to `security.*`.

A top-level `database`, `gitlab`, or `redis` block is **ignored**. It is not a legacy
spelling: the only place a provider is read from is `providers.<provider>`, so a
misplaced block leaves that provider unconfigured rather than half-working.

## Security model

### What is actually enforced

| Gate | Key read | Notes |
| :--- | :--- | :--- |
| Provider kill switch | `providers.<provider>.enabled` | Only an explicit `false` disables |
| Command values (`cmd:`) | `DEVTOOLS_ALLOW_CMD` — **environment**, not config | **Grant: denied by default.** It cannot be granted from a config file, because a cloned repository must not be able to author its own code execution. With the gate closed nothing runs and the value becomes `""` |
| Database writes | `providers.database.security.allow_write` → `security.allow_write` | **Grant: denied by default.** Any statement not matching `/^\s*SELECT/i` counts as a write |
| Redis writes | `providers.redis.security.allow_write` → `security.allow_write` | **Grant: denied by default.** Applies to `redis_set_key`, `redis_delete_key`, `redis_expire_key` |
| GitLab writes | `providers.gitlab.security.allow_write` → `security.allow_write` | **Grant: denied by default.** Applies to `gitlab_create_note`, `gitlab_update_note`, `gitlab_delete_note` |
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

Credentials are never logged or returned in tool responses. `show_config` masks
usernames, passwords, and sensitive query parameters in every DSN and Redis URL, and
`providers_info` reports only `token_configured` / `auth_configured` booleans.

The one way to see a credential is `show_config` with `show_credentials: true`. That
unmasks connections named `local`, `dev`, or `development` only — every other connection
stays sanitized. It is off by default because the value becomes part of the model's
context and the session transcript.

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
- `codegraph` is never emitted, and no legacy top-level keys exist to emit.
- It refuses to run when `.devtools/config.yaml` already exists.

## Source of truth

| Concern | File |
| :--- | :--- |
| Discovery, parsing, `${VAR}` and `cmd:` resolution | `src/core/config.ts` |
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
