# Development

> Build, test, and contribute to DevTools MCP.

## Clone & install

```bash
git clone https://github.com/muhfaris/devtools-mcp.git
cd devtools-mcp
npm install
```

## Run in development mode

```bash
# CLI mode
npm run dev -- generate_ulid

# MCP mode (stdio server)
npm run dev
```

## Build for production

```bash
npm run build
node dist/index.js generate_ulid
```

## Run tests

```bash
npm test            # watch mode (vitest)
npm run test:ci     # single run - what CI executes
npx tsc --noEmit    # typecheck
```

## Debug with MCP Inspector

```bash
# Run directly from source (no build needed)
npx @modelcontextprotocol/inspector npx tsx src/index.ts

# Or from built version
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
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

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request,
on Node 20 (the `engines` floor) and Node 22:

- `npm install` — no lockfile is committed, so `npm ci` cannot run
- `npx tsc --noEmit`
- `npm run test:ci` (`vitest run`)

## Publishing to npm

`.github/workflows/publish.yml` publishes when a GitHub release is published. It
typechecks, compares the release tag with the `package.json` version, then runs
`npm publish --provenance`. `prepublishOnly` builds and runs the unit tests, so a
failing tree cannot be published — locally or from CI. The job runs Node 22 and
installs npm 11, because Trusted Publishing needs npm ≥ 11.5.1.

Setup, once: add an npm **automation token** as the `NPM_TOKEN` repository secret.
npm only attaches a Trusted Publisher to a package that already exists, so the first
publish needs the token. Provenance requires a public repository.

After that first publish, configure package settings → Trusted Publisher → GitHub
Actions for this repository and workflow `publish.yml`, then delete the `NPM_TOKEN`
secret. The workflow reads the secret once and picks the OIDC path when it is
absent, so no further edit is needed.

Release flow:

```bash
npm version patch        # bumps package.json and creates the vX.Y.Z tag
git push --follow-tags
# create the GitHub release for that tag; CI publishes it
```

Manual fallback, from a clean tree:

```bash
npm run build
npm pack --dry-run       # does NOT run prepublishOnly; lists what will ship
npm publish
```

`files` limits the tarball to `dist/`, `README.md`, `LICENSE`, plus `package.json`.
`src/`, `tests/`, `docs/`, `.devtools/` and `.github/` never ship.

After publishing, users can run:

```bash
npx @muhfaris/devtools generate_ulid
```

CLI command names are the tool names verbatim, so they are underscored
(`generate_ulid`) and never kebab-cased.
