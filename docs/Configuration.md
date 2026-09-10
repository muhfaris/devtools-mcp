# Configuration

> How DevTools MCP loads, resolves, and reloads its configuration.

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

This means the config is auto-detected per project — no need to pass it
manually to each MCP client. Just place one file at the project root.

## Example

```yaml
id_generator:
  default: ulid

providers:
  database:
    enabled: true
    default_engine: postgresql
    connections:
      dev:
        dsn: ${DEV_DATABASE_URL}
        readonly: false
    security:
      allow_write: false
      blocked_env: [production, prod]

  gitlab:
    enabled: true
    url: https://gitlab.com
    token: ${GITLAB_TOKEN}
    projectId: 12345
    security:
      blocked_env: [production, prod] # protects create_note, etc.

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
    security:
      allow_write: false
      blocked_env: [production, prod]
```

Each provider is gated by its own `enabled` flag. Providers are initialized
lazily — only when a tool that needs them is first invoked — so running an
unrelated tool (e.g. `id`) never triggers GitLab, database, or Redis setup.

## Environment variable resolution

`${ENV_VAR}` placeholders in the config are resolved from `process.env` at
load time. A `.env` file in the working directory is also loaded via dotenv.

```yaml
providers:
  database:
    connections:
      dev:
        dsn: ${DEV_DATABASE_URL}   # resolves to process.env.DEV_DATABASE_URL
```

## Load order (priority: high → low)

1. **Per-invocation params** — highest priority
2. **Environment variables** — override config
3. **`.devtools/config.yaml`** — project config
4. **Hardcoded defaults** — sensible fallback

## Live reload

The config file is watched with `fs.watch`. On change (debounced ~200ms) it
is re-parsed, env vars re-resolved, and providers re-initialized — without
restarting the MCP server. GitLab is re-initialized if its config changed, or
torn down if removed.

## Security config

| Key | Default | Purpose |
| :--- | :--- | :--- |
| `providers.database.security.allow_write` | `false` | Allow write queries |
| `providers.database.security.blocked_env` | `[]` | Environments where writes are blocked |

Credentials are never logged or returned in tool responses.
