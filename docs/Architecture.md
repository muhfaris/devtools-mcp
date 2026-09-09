# Architecture

> Understanding the design, components, and flow of the DevTools MCP server.

## Overview

**DevTools MCP** is a Model Context Protocol (MCP) server that provides a
collection of developer utilities as tools callable by AI assistants.

### What problem does it solve?

1. **Context switching** — developers leave their editor for browser tools
   (UUID generators, JWT debuggers, cron parsers, etc.)
2. **AI hallucination** — AI agents guess database schemas, ID formats, and
   conventions instead of knowing the truth
3. **Fragmented tools** — no single interface for common development tasks
4. **Manual code review** — AI can analyze code but lacks Git platform integration

### Key differentiators

| Feature | DevTools MCP | Other MCP servers |
| :--- | :--- | :--- |
| Database introspection | Real schema awareness | Static or none |
| GitLab integration | Full MR lifecycle | Limited or none |
| Interactive config | AI asks for missing credentials | Hardcoded config only |
| Plugin architecture | Add tools without touching core | Often monolithic |
| Dual mode | MCP + CLI | Usually one or the other |

## Core principles

1. **Plugin-based architecture** — each tool is an independent module
2. **Provider abstraction** — database engines and external services behind interfaces
3. **Stateless but cache-aware** — tools stateless, optional caching for introspection
4. **Security first** — read-only defaults, production blocking, never log credentials
5. **Interactive configuration** — missing credentials trigger structured errors AI can resolve

## Architecture diagram

```mermaid
graph TB
    subgraph "External World"
        AI[AI Assistant<br/>Claude/Cursor/CodeCompanion]
        User[Developer]
        Terminal[Terminal]
    end

    subgraph "DevTools MCP Server"
        direction TB

        subgraph "Entry Points"
            CLI[CLI Mode<br/>Commander]
            MCP[MCP Mode<br/>Stdio Transport]
        end

        subgraph "Core Layer"
            Registry[Tool Registry<br/>Plugin Manager]
            Config[Config Loader<br/>YAML + ENV]
            Cache[Schema Cache<br/>TTL 60s]
        end

        subgraph "Tool Layer"
            ID[ID Generators<br/>ULID, UUID]
            Encoding[Encoding Tools<br/>Base64, JWT, Hash]
            Misc[Misc Tools<br/>Cron, Timezone, Semver]
            GitLab[GitLab Tools<br/>List MRs, Review, Comment]
            DB[Database Tools<br/>Schema, Query, Explain]
            ConfigTools[Config Tools<br/>gitlab_set_config,<br/>database_set_connection]
        end

        subgraph "Provider Layer"
            Postgres[PostgreSQL Provider]
            MySQL[MySQL Provider]
            GitLabProvider[GitLab Client<br/>@gitbeaker/rest]
        end
    end

    subgraph "External Systems"
        Database[(PostgreSQL<br/>MySQL)]
        GitLab[(GitLab API)]
    end

    User -->|"bun dev generate_ulid"| CLI
    User -->|"Configure .env"| Config
    AI -->|"MCP Protocol"| MCP

    CLI --> Registry
    MCP --> Registry

    Registry --> ID
    Registry --> Encoding
    Registry --> Misc
    Registry --> GitLab
    Registry --> DB
    Registry --> ConfigTools

    Config --> Registry
    Config --> GitLabProvider
    Config --> Postgres
    Config --> MySQL

    Cache <--> DB
    DB <--> Postgres
    DB <--> MySQL

    GitLab <--> GitLabProvider
    GitLabProvider <--> GitLab
```

## Component breakdown

### Entry points (`src/index.ts`)

Single entry point that detects runtime mode:

```typescript
if (isCliMode) {
  program.command(tool.name).action(...)
} else {
  await startMcpServer(registry)
}
```

### Core layer

#### Tool registry (`src/core/registry.ts`)

The heart of the plugin system:

```typescript
class ToolRegistry {
  private tools = new Map<string, Tool>()
  register(tool: Tool)          // Add a tool
  get(name: string)             // Retrieve a tool
  list(): Tool[]                // List all tools
  async execute(name, params)   // Run a tool
}
```

#### Config loader (`src/core/config.ts`)

Loads configuration from `.devtools/config.yaml` (auto-discovered up the
directory tree), resolves `${ENV_VAR}` placeholders, and watches the file for
live reload. See [Configuration](./Configuration.md).

### Tool layer

Each tool is a self-contained module implementing the `Tool` interface:

```typescript
interface Tool {
  name: string
  description: string
  params?: Record<string, ToolParamSchema>
  execute: (params: ToolParams) => Promise<ToolResult>
}
```

### Provider layer

Abstracts external systems behind interfaces:

```typescript
interface DBProvider {
  connect(config: ConnectionConfig): Promise<void>
  introspect(tableName?: string): Promise<SchemaInfo>
  executeQuery(query: string, params?: any[]): Promise<any[]>
  explainQuery(query: string): Promise<any>
  healthCheck(): Promise<boolean>
}
```

Supported providers: PostgreSQL, MySQL/MariaDB, GitLab.

### MCP server (`src/mcp/server.ts`)

Handles the MCP protocol, auto-converts tool params to Zod schemas, and
returns errors gracefully (`isError: true`).

## Execution flow

### CLI mode

```mermaid
sequenceDiagram
    participant User
    participant CLI as Commander
    participant Registry
    participant Tool
    participant Config

    User->>CLI: bun dev generate_ulid --count 3
    CLI->>CLI: Parse command
    CLI->>Registry: get("generate_ulid")
    Registry-->>CLI: Tool object
    CLI->>Tool: execute({ count: 3 })
    Tool->>Config: Get default config
    Tool-->>CLI: Result { content: [...] }
    CLI-->>User: Output to stdout
```

### MCP mode

```mermaid
sequenceDiagram
    participant AI as Claude Code
    participant MCP as MCP Server
    participant Registry
    participant Tool
    participant External

    AI->>MCP: {"method": "tools/call", ...}
    MCP->>MCP: Parse JSON-RPC
    MCP->>Registry: get("gitlab_review_mr")
    Registry-->>MCP: Tool object
    MCP->>Tool: execute({ mr_id: 123 })
    Tool->>External: GitLab API
    External-->>Tool: MR data
    Tool-->>MCP: ToolResult
    MCP-->>AI: {"result": {...}}
    AI-->>User: "I reviewed MR #123..."
```

### Interactive config flow (missing credentials)

```mermaid
sequenceDiagram
    participant User
    participant AI as Claude Code
    participant MCP as MCP Server
    participant Tool
    participant Config

    User->>AI: "List my GitLab MRs"
    AI->>MCP: Call gitlab_list_mrs
    MCP->>Tool: execute()
    Tool->>Config: Load gitlab.token
    Config-->>Tool: undefined ❌
    Tool-->>MCP: MissingConfigError { setupTool: "gitlab_set_config" }
    MCP-->>AI: Error with structured data
    AI-->>User: "I need your GitLab token"
    User->>AI: "glpat-xxx"
    AI->>MCP: Call gitlab_set_config({ token: "glpat-xxx" })
    MCP->>Config: Store token in memory
    MCP-->>AI: "✅ GitLab configured"
    AI->>MCP: Call gitlab_list_mrs (retry)
    MCP-->>Tool: Success ✅
    Tool-->>AI: MR list
    AI-->>User: "Here are your MRs..."
```

## Plugin system

1. **Registration** — each tool calls `registry.register()` on startup
2. **Discovery** — the registry exposes `list()` for MCP and CLI
3. **Execution** — tools invoked by name via `registry.execute()`

## Provider abstraction

- **Decoupling** — tools don't care if they talk to PostgreSQL or MySQL
- **Testability** — mock providers for unit tests
- **Extensibility** — new databases added without refactoring

## Security model

### Database

| Feature | Implementation |
| :--- | :--- |
| Read-only by default | `execute_query` blocks writes unless `allow_write: true` |
| Production blocking | Prevents writes on `production`, `prod`, `staging` |
| No credential leaks | DSN values never logged |
| Connection limits | `pool_size` limits concurrent connections |

### GitLab

| Feature | Implementation |
| :--- | :--- |
| Token security | Tokens from env vars, never hardcoded |
| No token echo | Tokens never appear in responses |
| Rate limiting | Respects GitLab API limits |

### Configuration

| Feature | Implementation |
| :--- | :--- |
| `.env` ignored | Never commit secrets to version control |
| Environment variables | Preferred for credentials |
| Interactive config | Session-only (not persisted) |

## Error handling & interactive config

When a tool can't run due to missing configuration, it throws a
`MissingConfigError`:

```typescript
throw new MissingConfigError(
  "gitlab.token",        // Which config key is missing
  "GitLab token missing", // Human-readable message
  "gitlab_set_config",   // Tool to call to fix it
  { token: "" }          // Parameters for the setup tool
)
```

The AI reads the error, extracts `setupTool`/`setupParams`, asks the user for
credentials, calls the setup tool, then retries the original tool.

## Testing strategy

### Unit tests (`tests/unit/`)

| Test file | Covers |
| :--- | :--- |
| `core/registry.test.ts` | Tool registration, lookup, execution |
| `tools/id-generators/*.test.ts` | ULID, UUID generation |
| `tools/encoding/*.test.ts` | Base64, JWT, hash, secret, regex |
| `tools/misc/*.test.ts` | Cron, timezone, semver, slugify |
| `tools/gitlab/*.test.ts` | GitLab tools (mocked) |
| `tools/database/*.test.ts` | Database tools (mocked) |

### Mock strategy

- **Database** — mock the provider interface
- **GitLab** — mock `@gitbeaker/rest` client
- **File system** — mock `fs` where needed

## Glossary

| Term | Definition |
| :--- | :--- |
| **MCP** | Model Context Protocol — a standard for AI tools |
| **Tool** | A function an AI can call (e.g., `generate_ulid`) |
| **Provider** | An abstraction for external systems (database, GitLab) |
| **Registry** | The central store of all registered tools |
| **Stdio** | Standard input/output — how MCP communicates |
| **JSON-RPC** | The protocol format used by MCP |
| **Zod** | A TypeScript schema validation library |
| **Introspection** | Querying database metadata (schemas, tables, columns) |
| **`MissingConfigError`** | Structured error for interactive config |

## Further reading

- [Configuration](./Configuration.md)
- [MCP clients](./MCP-Clients.md)
- [Tools](./Tools.md)
- [Development](./Development.md)
- [Product requirements](./PRD.md)

