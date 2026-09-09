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
bun dev generate-ulid

# MCP mode (stdio server)
bun dev
```

## Build for production

```bash
bun run build
bun dist/index.js generate-ulid
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

```bash
npm login
npm publish --access public
```

After publishing, users can run:

```bash
npx @muhfaris/devtools generate-ulid
```
