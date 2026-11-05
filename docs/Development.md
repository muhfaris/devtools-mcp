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

npm 12, generally available since July 2026, stops running dependency lifecycle
scripts on install unless they are allowlisted. Two packages in this tree have a
`postinstall` (`esbuild`, `@modelcontextprotocol/inspector`); neither is needed to
typecheck or test on a linux-x64 runner, so no allowlist is committed. The publish
job pins npm 11, which still runs them.

## Publishing to npm

`.github/workflows/publish.yml` publishes when a GitHub release is published. It
typechecks, compares the release tag with the `package.json` version, then runs
`npm publish --provenance`. `prepublishOnly` builds and runs the unit tests, so a
failing tree cannot be published — locally or from CI. The job runs Node 22 and
installs npm 11, because Trusted Publishing needs npm ≥ 11.5.1.

Setup, once: add a granular npm token as the `NPM_SECRET` repository secret
(`NPM_TOKEN` is accepted as an alias). It must have **Bypass two-factor
authentication** enabled and read-and-write access to all packages. An account
protected by 2FA rejects any other token with:

```
403 Two-factor authentication or granular access token with bypass 2fa enabled
is required to publish packages
```

Provenance requires a public repository.

> **The token is a stopgap.** npm has begun retiring it: since August 2026 a
> 2FA-bypass token can no longer manage packages, and from around January 2027 it
> can only read private packages and stage a publish. Move the release to Trusted
> Publishing as soon as the first publish lands; `npm stage publish` plus a human
> 2FA approval is the fallback when a review gate is wanted.

After the first publish, switch to Trusted Publishing: package settings →
Trusted Publisher → GitHub Actions, repository and workflow `publish.yml`. A new
configuration must complete a publish within two days, and one created after
3 Sep 2026 permits staged publishing only unless **npm publish** is also ticked —
tick it. Then delete the `NPM_SECRET` secret: the workflow reads the secret once
and takes the OIDC path when it is absent, so no further edit is needed.

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
