# 🧰 DevTools MCP

> **Developer companion** for AI coding assistants — generate IDs, encode, decode, parse, and introspect your stack without leaving your editor.

[![npm version](https://img.shields.io/npm/v/@muhfaris/devtools.svg)](https://www.npmjs.com/package/@muhfaris/devtools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-34%20passing-brightgreen)]()

---

## ✨ What is DevTools MCP?

**DevTools MCP** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that brings a rich set of developer utilities directly into your AI coding assistant (Claude Code, Cursor, etc.) and your terminal.

**Stop context-switching** to browser tabs for:
- Generating ULIDs, UUIDs
- Encoding/decoding Base64, JWT
- Generating hashes (MD5, SHA1, SHA256, SHA512)
- Testing regular expressions
- Generating secure secrets (passwords, API keys)
- Parsing cron expressions
- Converting timezones
- Bumping semantic versions
- Slugifying strings

Everything is available as:
- **MCP tools** – callable by your AI agent (`/mcp` in Claude Code)
- **CLI commands** – runnable directly from your terminal (`npx @muhfaris/devtools generate-ulid`)

---
## AI Interaction Flow
### MCP Server Connection
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant Config as Config Loader

    User->>AI: "Connect to devtools MCP"
    AI->>MCP: Initialize MCP connection
    MCP->>Config: Load devtools.config.yaml
    Config-->>MCP: Config with DB + GitLab (or empty)
    MCP-->>AI: "Connected with X tools"
    AI-->>User: "DevTools MCP is ready"
```
If Config Missing:
```
AI: "DevTools MCP is connected. I notice GitLab and Database are not configured yet.
     You can configure them when needed."
```
### AI Tool Discovery
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server

    User->>AI: "What tools do you have?"
    AI->>MCP: tools/list
    MCP-->>AI: Returns all 20+ tools
    AI-->>User: "I have tools for:<br/>- ID generation (ULID, UUID)<br/>- Encoding (Base64, JWT, Hash)<br/>- GitLab (list MRs, review, comment)<br/>- Database (schema, query, explain)<br/>- Misc (cron, timezone, semver, slugify)"
```
### Gitlab Tool Flow
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant GitLab as GitLab API

    User->>AI: "List merge requests assigned to me"
    AI->>MCP: Call gitlab_list_mrs
    Note over MCP: { assignee: "faris" }
    MCP->>MCP: Load config (token exists)
    MCP->>GitLab: GET /merge_requests?assignee=faris
    GitLab-->>MCP: [MR1, MR2, MR3]
    MCP-->>AI: Formatted MR list
    AI-->>User: "You have 3 MRs assigned to you:<br/>1. #123: Fix login bug (updated 2h ago)<br/>2. #124: Add user dashboard (pending review)<br/>3. #125: Refactor API (needs changes)"
```

### Gitlab Tool Flow (no token)
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant Config as Config Store

    User->>AI: "List merge requests"
    AI->>MCP: Call gitlab_list_mrs
    MCP->>MCP: Load config
    MCP-->>MCP: ❌ token missing
    MCP-->>AI: MissingConfigError { configKey: "gitlab.token", message: "GitLab token missing. Please provide it.", setupTool: "gitlab_set_config", setupParams: { token: "" } }

    Note over AI: AI reads the error and identifies the setupTool

    AI-->>User: "GitLab token is missing. Please provide your GitLab personal access token."

    User->>AI: "glpat-xxxxxxxxxxxx"

    AI->>MCP: Call gitlab_set_config { token: "glpat-xxxxxxxxxxxx" }
    MCP->>Config: Store token in session
    Config-->>MCP: ✅ Token stored
    MCP->>MCP: Re-initialize GitLab client
    MCP-->>AI: "✅ GitLab configured successfully"

    Note over AI: AI automatically retries the original tool

    AI->>MCP: Call gitlab_list_mrs (with token now set)
    MCP->>GitLab: GET /merge_requests
    GitLab-->>MCP: [MR1, MR2, MR3]
    MCP-->>AI: MR list
    AI-->>User: "Here are your merge requests: ..."
```
### Database Tool Flow (no config)
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant Config as Config Store
    participant DB as Database

    User->>AI: "What's the schema of the users table?"
    AI->>MCP: Call get_db_schema { table: "users" }
    MCP->>MCP: Load config
    MCP-->>MCP: ❌ no connections
    MCP-->>AI: MissingConfigError { configKey: "database.connections", message: "No database connections configured.", setupTool: "database_set_connection", setupParams: { name: "dev", dsn: "", engine: "postgresql" } }

    AI-->>User: "I need database connection details. Please provide a database URL."

    User->>AI: "postgresql://user:pass@localhost:5432/mydb"

    AI->>MCP: Call database_set_connection { name: "dev", dsn: "postgresql://user:pass@localhost:5432/mydb" }
    MCP->>Config: Store connection in session
    Config-->>MCP: ✅ Connection stored
    MCP-->>AI: "✅ Database connection 'dev' added successfully"

    AI->>MCP: Call get_db_schema { table: "users" } (retry)
    MCP->>DB: Connect to database
    MCP->>DB: Query information_schema
    DB-->>MCP: Table schema
    MCP-->>AI: "users table: id (integer, PK), name (text), email (text, unique)"
    AI-->>User: "The users table has three columns: id, name, and email."
```
### Review MR with Code Analysis
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant GitLab as GitLab API

    User->>AI: "Review MR #123 and suggest improvements"
    AI->>MCP: Call gitlab_review_mr { mr_id: 123 }
    MCP->>GitLab: GET /merge_requests/123/changes
    GitLab-->>MCP: Diff + changes
    MCP->>MCP: Analyze code (detect language, complexity)
    MCP->>MCP: Generate suggestions
    MCP-->>AI: Review summary + suggestions
    AI-->>User: "I've reviewed MR #123:<br/>- 5 files changed (3 TypeScript, 2 CSS)<br/>- High complexity in src/api/users.ts<br/>- Suggestions:<br/>  1. Remove console.log statements<br/>  2. Add error handling for API calls<br/>  3. Consider using environment variables for config<br/>- Overall: Good changes, but needs cleanup before merging."
```

### Add Comment to MR
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant GitLab as GitLab API

    User->>AI: "Add a comment about the console.log in users.ts line 42"
    AI->>MCP: Call gitlab_create_note { mr_id: 123, body: "Please remove console.log before merging", path: "src/api/users.ts", line: 42 }
    MCP->>GitLab: POST /merge_requests/123/notes
    GitLab-->>MCP: { id: 456, ... }
    MCP-->>AI: "✅ Comment added to MR #123"
    AI-->>User: "Comment added to line 42 in users.ts."
```

### Multi-Tool
```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant GitLab
    participant DB

    User->>AI: "Check all open MRs, find ones that modify the users table, and add a comment asking for schema updates"

    AI->>MCP: Call gitlab_list_mrs { state: "opened" }
    MCP->>GitLab: GET /merge_requests?state=opened
    GitLab-->>MCP: [MR1, MR2, MR3, MR4]

    loop For each MR
        AI->>MCP: Call gitlab_get_mr { mr_id: X, include_diff: true }
        MCP->>GitLab: GET /merge_requests/X/changes
        GitLab-->>MCP: Diff
        MCP-->>AI: Files changed in MR X
    end

    Note over AI: AI identifies MR3 modifies "src/models/User.ts"

    AI->>MCP: Call gitlab_create_note { mr_id: 3, body: "This MR modifies the user model. Please ensure database schema is updated accordingly." }
    MCP->>GitLab: POST /merge_requests/3/notes
    GitLab-->>MCP: ✅ Comment added

    AI-->>User: "I found 4 open MRs. MR #3 modifies the users table, so I added a comment asking about schema updates."
```
---

## 🚀 Quick Start

### Install globally (for CLI use)
```bash
npm install -g @muhfaris/devtools
devtools generate-ulid
```

### Or use instantly with `npx` (no install)
```bash
npx @muhfaris/devtools generate-ulid --count 3
```

### Add to Claude Code (project-scoped)
```bash
claude mcp add devtools --project -- npx @muhfaris/devtools
```
Then in Claude Code, type:  
> *"Generate a ULID using devtools"*

### Add to Cursor
Add this to your `~/.cursor/mcp.json` or project `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "devtools": {
      "command": "npx",
      "args": ["@muhfaris/devtools"]
    }
  }
}
```

---

## 🛠️ Tools

### Phase 1: ID Generators

| Tool | Description | CLI Example |
| :--- | :--- | :--- |
| `generate_ulid` | Generate ULID(s) | `devtools generate_ulid --count 5` |
| `generate_uuid` | Generate UUID v4(s) | `devtools generate_uuid --count 3` |

### Phase 2: Encoding & Security

| Tool | Description | CLI Example |
| :--- | :--- | :--- |
| `base64_encode` | Encode string to Base64 | `devtools base64_encode --text "Hello"` |
| `base64_decode` | Decode Base64 to string | `devtools base64_decode --encoded "SGVsbG8="` |
| `jwt_decode` | Decode JWT token | `devtools jwt_decode --token "eyJ..."` |
| `hash_generate` | Generate MD5/SHA1/SHA256/SHA512 | `devtools hash_generate --text "hello" --algorithm sha256` |
| `secret_generate` | Generate secure random secret | `devtools secret_generate --length 32 --format base64` |
| `regex_test` | Test regex against a string | `devtools regex_test --pattern '^[a-z]+$' --text "hello"` |

### Phase 2: Misc Utilities

| Tool | Description | CLI Example |
| :--- | :--- | :--- |
| `cron_parse` | Parse cron expression, show next runs | `devtools cron_parse --expression "0 9 * * *" --count 5` |
| `timezone_convert` | Convert timestamp between timezones | `devtools timezone_convert --to "Asia/Jakarta"` |
| `semver_bump` | Bump semantic version | `devtools semver_bump --version "1.2.3" --bump minor` |
| `slugify` | Convert string to URL-safe slug | `devtools slugify --text "Hello World!"` |

---

## ⚙️ Configuration

Create a `devtools.config.yaml` in your project root (or any parent directory) to set defaults:

```yaml
id_generator:
  default: ulid          # default ID type when not specified

database:                 # Phase 4+ (coming soon)
  default_engine: postgresql
  connections:
    dev:
      dsn: ${DEV_DATABASE_URL}
      readonly: false

security:
  execute_query:
    allow_write: false
    blocked_env: [production]
```

---

## 🧪 Development

### Clone & install
```bash
git clone https://github.com/muhfaris/devtools-mcp.git
cd devtools-mcp
bun install
```

### Run in development mode
```bash
# CLI mode
bun dev generate-ulid

# MCP mode (stdio server)
bun dev
```

### Build for production
```bash
bun run build
bun dist/index.js generate-ulid
```

### Run tests
```bash
bun test
bun test --coverage    # with coverage
```

### Debug with MCP Inspector
```bash
# Run directly from source (no build needed)
bunx @modelcontextprotocol/inspector bun src/index.ts

# Or from built version
bun run build
bunx @modelcontextprotocol/inspector bun dist/index.js
```
The Inspector opens a browser UI at `http://localhost:5173` where you can:
- See all registered tools
- Call tools with custom parameters
- Inspect raw JSON‑RPC messages

### Adding a new tool
1. Create a new file under `src/tools/<category>/`.
2. Export a `Tool` object with `name`, `description`, `params`, and `execute`.
3. Import and register it in `src/tools/index.ts`.
4. Add tests in `tests/unit/tools/<category>/`.
5. Rebuild and test.

Example tool:
```typescript
// src/tools/misc/example.ts
import { Tool } from "../../core/types.js";

export const exampleTool: Tool = {
  name: "example_tool",
  description: "Does something useful",
  params: {
    input: { type: "string", description: "Input value" },
    count: { type: "number", optional: true, description: "How many", default: 1 }
  },
  execute: async (params) => {
    // ... your logic
    return { content: [{ type: "text", text: "result" }] };
  }
};
```

---

## 📦 Publishing to npm

```bash
npm login
npm publish --access public
```

After publishing, users can run:
```bash
npx @muhfaris/devtools generate-ulid
```

---

## 🗺️ Roadmap

| Phase | Tools | Status |
| :--- | :--- | :--- |
| **Phase 1** (v0.1) | ULID, UUID generators | ✅ Done |
| **Phase 2** (v0.2) | Base64, JWT, Hash, Regex, Secret, Cron, Timezone, Semver, Slugify | ✅ Done |
| **Phase 3** (v0.3) | Git helpers (commit, PR description, branch name) | 📋 Planned |
| **Phase 4** (v0.4) | Database introspection (schema, query, explain) | 📋 Planned |
| **Phase 5** (v0.5) | Dummy data generation (schema-aware) | 📋 Planned |
| **Phase 6** (v0.6) | Code intelligence (AST, OpenAPI generation) | 📋 Planned |

---

## 📄 License

MIT © [Faris](https://github.com/muhfaris)

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or PR for:
- Bug fixes
- New tools (see the roadmap)
- Documentation improvements
