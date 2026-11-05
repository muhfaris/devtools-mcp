# MCP Clients

> Complete reference for integrating DevTools MCP with your AI coding assistant.

## Quick start

### 1. Set up environment variables

Create a `.env` file in your project root:

```bash
# Database (required for database tools)
DEV_DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# GitLab (required for GitLab tools)
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx

# Optional: Custom GitLab instance
GITLAB_URL=https://gitlab.yourcompany.com
```

### 2. Add to your MCP client

Choose your client below and follow the specific instructions.

---

## Claude Code

### Project-scoped (recommended)

```bash
claude mcp add devtools --scope project -- npx -y @muhfaris/devtools
```

### User-scoped (all projects)

```bash
claude mcp add devtools --scope user -- npx -y @muhfaris/devtools
```

### With environment variables

`-e`/`--env` must come **before** the `--` separator. After it, the flag is passed to
`npx` as an argument and the variable never reaches the server.

```bash
claude mcp add devtools --scope user \
  -e GITLAB_TOKEN="glpat-xxx" \
  -e DEV_DATABASE_URL="postgresql://user:pass@localhost:5432/mydb" \
  -- npx -y @muhfaris/devtools
```

The shell resolves these once, at `add` time, and Claude stores the result in
`~/.claude.json`. See [Injecting secrets](#injecting-secrets) if you would rather not
leave a token there.

### Verify connection

In Claude Code, type `/mcp`. You should see `devtools` listed with a green dot.

### Remove

```bash
claude mcp remove devtools --project
claude mcp remove devtools --user
```

---

## Cursor

### Global configuration

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "devtools": {
      "command": "npx",
      "args": ["-y", "@muhfaris/devtools"],
      "env": {
        "DEV_DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb",
        "GITLAB_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Project-specific configuration

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "devtools": {
      "command": "npx",
      "args": ["-y", "@muhfaris/devtools"],
      "env": {
        "DEV_DATABASE_URL": "postgresql://project-db:pass@localhost:5432/projectdb",
        "GITLAB_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Using local development version

```json
{
  "mcpServers": {
    "devtools": {
      "command": "npx",
      "args": ["tsx", "/full/path/to/devtools-mcp/src/index.ts"],
      "env": {
        "DEV_DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb"
      }
    }
  }
}
```

---

## CodeCompanion.nvim

### Basic configuration

```lua
require("codecompanion").setup({
  mcp = {
    default_servers = { "devtools" },
    servers = {
      ["devtools"] = {
        cmd = { "npx", "-y", "@muhfaris/devtools" },
        env = {
          DEV_DATABASE_URL = os.getenv("DEV_DATABASE_URL"),
          GITLAB_TOKEN = os.getenv("GITLAB_TOKEN"),
        },
      },
    },
  },
})
```

### Using 1Password CLI

```lua
env = {
  GITLAB_TOKEN = "cmd:op read op://personal/GitLab_Token/credential --no-newline",
  DEV_DATABASE_URL = "cmd:op read op://personal/Dev_DB/url --no-newline",
}
```

> **This `cmd:` is CodeCompanion's, not the server's.** CodeCompanion runs the command and
> passes its stdout as the env var. It is safe here because the snippet lives in your nvim
> config, which only you write. The server has a separate, unrelated `cmd:` for values in
> `.devtools/config.yaml` that is **denied by default** — see
> [Command values](./Configuration.md#command-values-cmd). Configuring one does not
> configure the other, and this nvim snippet will not make a server-side `cmd:` work.

### Local development from source

```lua
["devtools"] = {
  cmd = { "npx", "tsx", "/path/to/devtools-mcp/src/index.ts" },
  env = {
    DEV_DATABASE_URL = os.getenv("DEV_DATABASE_URL"),
    GITLAB_TOKEN = os.getenv("GITLAB_TOKEN"),
  },
}
```

### Tool overrides (visibility)

```lua
["devtools"] = {
  cmd = { "npx", "-y", "@muhfaris/devtools" },
  tool_overrides = {
    -- Hide sensitive tools from the UI
    ["execute_query"] = { visible = false },
    ["gitlab_create_note"] = { description = "Add comment to GitLab MR" },
  },
},
```

---

## Codex CLI

```bash
codex mcp add devtools \
  --env GITLAB_TOKEN="glpat-xxx" \
  --env DEV_DATABASE_URL="postgresql://user:pass@localhost:5432/mydb" \
  -- npx -y @muhfaris/devtools
```

`codex mcp add` has no `cwd` or `env_vars` flag, so add these to `~/.codex/config.toml`
afterwards:

```toml
[mcp_servers.devtools]
command = "npx"
args = ["-y", "@muhfaris/devtools"]
cwd = "/path/to/your/project"
env_vars = ["GITLAB_TOKEN", "DEV_DATABASE_URL"]
```

- `cwd` pins the project root. The server discovers `.devtools/config.yaml` by walking
  up from its working directory, and reads `.env` from exactly that directory, so pinning
  it makes both deterministic.
- `env_vars` forwards a variable from the shell that launched Codex. Prefer it over
  `env`: the token stays in your shell and never enters `config.toml`.

Verify with `/mcp` in the Codex TUI after restart.

---

## Injecting secrets

Three ways, from least to most new surface.

### 1. Wrapper script — recommended for a single secret

Put it on your `PATH`. Nothing secret is written to a client config file, and the value
is resolved fresh on every launch.

```bash
#!/usr/bin/env bash
# ~/.local/bin/devtools-mcp
set -euo pipefail
export GITLAB_TOKEN="$(pass show gitlab/accountb)"
exec npx -y @muhfaris/devtools "$@"
```

```bash
chmod +x ~/.local/bin/devtools-mcp
claude mcp add devtools --scope user -- ~/.local/bin/devtools-mcp
```

```toml
[mcp_servers.devtools]
command = "/home/you/.local/bin/devtools-mcp"
args = []
cwd = "/path/to/your/project"
```

### 2. Client-side env injection

`-e` for Claude Code, `--env` for Codex. Both resolve the value at configuration time
and store the **result**: `~/.claude.json` for Claude, `config.toml` for Codex. Prefer
Codex's `env_vars`, which names the variable and reads it from the launching shell
instead of storing it.

### 3. The server's `cmd:` value, in `.devtools/config.yaml`

One file, and it works for every client:

```yaml
providers:
  gitlab:
    token: cmd:pass show gitlab/accountb
```

Read the gate first. Command values are **denied by default**, and the grant is an
environment variable rather than a config key — because a cloned repository can supply a
`.devtools/config.yaml`, and a config-file grant would let that repository unlock its own
code execution. Put `DEVTOOLS_ALLOW_CMD=1` in the environment the server is launched
with (any of the three places above) to enable it. Full rules:
[Command values](./Configuration.md#command-values-cmd).

A `$(pass show ...)` or backtick substitution in the YAML is **not** this feature and will
not work — see [Troubleshooting](#troubleshooting).

Neither does a `cmd:` that *prompts*. `pass` and `op` ask for a passphrase on a TTY, and
stdin is closed here because it carries the JSON-RPC stream — so the prompt is never
answered and the command blocks until its 5s timeout. Preset the passphrase in gpg-agent,
or use the [wrapper script](#injecting-secrets) above, which fetches the secret itself and
`exec`s the server.

---

## MCP Inspector (debugging)

### Using npx (published package)

```bash
npx @modelcontextprotocol/inspector npx @muhfaris/devtools
```

### Using the TypeScript source

```bash
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

### Using Node (built version)

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

### With environment variables

```bash
export GITLAB_TOKEN=glpat-xxx
export DEV_DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

The Inspector opens a browser at `http://localhost:5173` where you can:

- See all registered tools
- Call tools with custom parameters
- Inspect raw JSON-RPC messages
- Debug errors in real-time

---

## Generic MCP client

If your MCP client follows the standard configuration format (like Claude
Desktop), add this to your `mcpServers` map:

```json
{
  "mcpServers": {
    "devtools": {
      "command": "npx",
      "args": ["-y", "@muhfaris/devtools"],
      "env": {
        "DEV_DATABASE_URL": "${DEV_DATABASE_URL}",
        "GITLAB_TOKEN": "${GITLAB_TOKEN}"
      }
    }
  }
}
```

---

## Environment variables reference

| Variable               | Required for              | Description                            | Example                                      |
| :--------------------- | :------------------------ | :------------------------------------- | :------------------------------------------- |
| `GITLAB_TOKEN`         | GitLab tools              | Personal Access Token with `api` scope | `glpat-xxxxxxxx`                             |
| `GITLAB_URL`           | GitLab tools (optional)   | GitLab instance URL                    | `https://gitlab.com`                         |
| `DEV_DATABASE_URL`     | Database tools            | PostgreSQL/MySQL connection string     | `postgresql://user:pass@localhost:5432/mydb` |
| `STAGING_DATABASE_URL` | Database tools (optional) | Staging database connection            | `postgresql://user:pass@staging:5432/mydb`   |
| `DEVTOOLS_ALLOW_CMD`   | `cmd:` config values      | Enables command values in the config. `1` or `true` | `1`                                          |

---

## Troubleshooting

### Server not found / "command not found"

Ensure `npx` is installed and accessible:

```bash
which npx
```

### Tools not showing in MCP client

1. Check the client's MCP log (Claude Code: `~/.claude/logs/`).
2. Restart the client after adding the server.
3. Test with MCP Inspector first.

### GitLab tools return 401/403

1. Ensure token has `api` scope.
2. Regenerate a new token.
3. Verify token is set correctly in environment.

If the token is written as `$(pass show ...)` or `` `pass show ...` `` in
`.devtools/config.yaml`, that is the bug. Neither is a supported substitution: `${VAR}`
is the only interpolation, so the shell syntax is passed through verbatim as the token
and GitLab rejects it. Use a server-side `cmd:` value, or a
[wrapper script](#injecting-secrets).

### Database connection errors

Use a URI-style DSN matching the configured `database.default_engine`:

| Engine     | DSN format                                      | Example                                             |
| ---------- | ----------------------------------------------- | --------------------------------------------------- |
| PostgreSQL | `postgresql://USER:PASSWORD@HOST:PORT/DATABASE` | `postgresql://devuser:secret@localhost:5432/app_db` |
| MySQL      | `mysql://USER:PASSWORD@HOST:PORT/DATABASE`      | `mysql://devuser:secret@localhost:3306/app_db`      |
| MariaDB    | `mariadb://USER:PASSWORD@HOST:PORT/DATABASE`    | `mariadb://devuser:secret@localhost:3306/app_db`    |

Example `.devtools/config.yaml` configurations:

```yaml
# PostgreSQL
providers:
  database:
    default_engine: postgresql
    connections:
      local:
        dsn: postgresql://devuser:secret@localhost:5432/app_db
```

```yaml
# MySQL
providers:
  database:
    default_engine: mysql
    connections:
      local:
        dsn: mysql://devuser:secret@localhost:3306/app_db
```

```yaml
# MariaDB (uses the MySQL-compatible provider)
providers:
  database:
    default_engine: mariadb
    connections:
      local:
        dsn: mariadb://devuser:secret@localhost:3306/app_db
```

Percent-encode reserved characters in credentials. For example, the password
`p@ss:word` becomes `p%40ss%3Aword` in the DSN. Common optional query parameters
include PostgreSQL `?sslmode=require` and MySQL/MariaDB `?ssl=true` — but on
PostgreSQL `sslmode=require` means *verify against the system CA bundle*, so it
fails against a backend signed by a private CA (Aiven and other managed hosts).
Use the `ssl` block for those instead — see
[TLS and the DSN](./Configuration.md#tls-and-the-dsn).

1. Confirm that the DSN scheme matches `default_engine`.
2. Ensure the database is running and reachable on the configured host and port.
3. Verify the database name, credentials, and permissions.
4. Test connectivity with `psql` for PostgreSQL or `mysql` for MySQL/MariaDB.

Run `providers_info` with `live: true` first: every probe that fails now carries a
`failure` with a `reason`, a driver `code`, and a `hint`, so `SELF_SIGNED_CERT_IN_CHAIN`
(`tls_certificate_untrusted`) is distinguishable from a bad password
(`authentication_failed`) or a host that is not listening (`connection_refused`).

### Schema introspection returns empty

The database user may not have permission to query `information_schema`:

```sql
-- PostgreSQL
GRANT USAGE ON SCHEMA information_schema TO your_user;
GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO your_user;

-- MySQL
GRANT SELECT ON information_schema.* TO 'your_user'@'%';
```

### MCP Inspector shows "Disconnected"

1. Check that your server runs without errors: `npm run dev`
2. Verify the command path is correct.
3. Ensure all dependencies are installed: `npm install`
4. Run the server manually first to check for startup errors.

---

## Security notes

- **Never commit `.env` or tokens** to version control.
- Use environment variables or secret managers (1Password, Vault) for production.
- Write tools are **denied by default** for every provider; enable them with
  `security.allow_write: true` and keep production connections out of `blocked_env`.
- GitLab tokens are never logged or returned in responses.

---

## Next steps

- [Tools](./Tools.md)
- [Configuration](./Configuration.md)
- [Development](./Development.md)
