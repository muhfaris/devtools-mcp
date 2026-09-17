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
claude mcp add devtools --project -- npx @muhfaris/devtools
```

### User-scoped (all projects)

```bash
claude mcp add devtools --user -- npx @muhfaris/devtools
```

### With environment variables

```bash
claude mcp add devtools --project -- \
  --env DEV_DATABASE_URL="postgresql://user:pass@localhost:5432/mydb" \
  --env GITLAB_TOKEN="glpat-xxx" \
  npx @muhfaris/devtools
```

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
      "command": "bun",
      "args": ["/full/path/to/devtools-mcp/src/index.ts"],
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

### Local development with Bun

```lua
["devtools"] = {
  cmd = { "bun", "/path/to/devtools-mcp/src/index.ts" },
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

`~/.codex/config.toml`:

```toml
[mcp_servers.devtools]
command = "devtools-mcp"
args = []
env = { DEV_DATABASE_URL = "postgres://user:pass@localhost:5432/mydb" }
```

Verify with `/mcp` in the Codex TUI after restart.

---

## MCP Inspector (debugging)

### Using npx (published package)

```bash
npx @modelcontextprotocol/inspector npx @muhfaris/devtools
```

### Using Bun (local source)

```bash
bunx @modelcontextprotocol/inspector bun src/index.ts
```

### Using Node (built version)

```bash
bun run build
bunx @modelcontextprotocol/inspector node dist/index.js
```

### With environment variables

```bash
export GITLAB_TOKEN=glpat-xxx
export DEV_DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
bunx @modelcontextprotocol/inspector bun src/index.ts
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
include PostgreSQL `?sslmode=require` and MySQL/MariaDB `?ssl=true`.

1. Confirm that the DSN scheme matches `default_engine`.
2. Ensure the database is running and reachable on the configured host and port.
3. Verify the database name, credentials, and permissions.
4. Test connectivity with `psql` for PostgreSQL or `mysql` for MySQL/MariaDB.

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

1. Check that your server runs without errors: `bun dev`
2. Verify the command path is correct.
3. Ensure all dependencies are installed: `bun install`
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
