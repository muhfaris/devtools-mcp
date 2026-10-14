# Development

> Build, test, and contribute to DevTools MCP.

## Clone & install

```bash
git clone https://github.com/muhfaris/devtools-mcp.git
cd devtools-mcp
bun install
```

## Run in development mode

```bash
# CLI mode
bun dev generate_ulid

# MCP mode (stdio server)
bun dev
```

## Build for production

```bash
bun run build
bun dist/index.js generate_ulid
```

## Run tests

```bash
bun test
bun test --coverage    # with coverage
```

## Debug with MCP Inspector

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
- Inspect raw JSON-RPC messages

## Adding a new tool

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

## Publishing to npm

Publishing requires Node **20.19+** (see `engines`). `prepublishOnly` runs
`bun run build`, so a publish always ships a fresh `dist/`.

```bash
# 1. Build. `npm pack --dry-run` does NOT trigger prepublishOnly, so build first
#    or you will be inspecting a stale dist/.
bun run build

# 2. Inspect the tarball - the authoritative list of what ships.
#    Expected: dist/, .devtools/, README.md, LICENSE
#    Excluded: src/, tests/, docs/, .codecompanion/, tsconfig.json, vitest.config.ts
npm pack --dry-run

# 3. Publish. `publishConfig.access` is already public, so no --access flag.
npm login
npm publish

# 4. Tag the released commit.
git tag v0.1.0
git push --tags
```

After publishing, users can run:

```bash
npx @muhfaris/devtools generate_ulid
```

CLI command names are the tool names verbatim, so they are underscored
(`generate_ulid`) and never kebab-cased.
