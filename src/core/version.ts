import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Single source of truth for the version advertised by the CLI and the MCP
 * server. Read from package.json at runtime instead of duplicated as a literal:
 * both call sites had already drifted to a stale value while package.json
 * moved on.
 *
 * Works unbuilt (`tsx src/index.ts`) and built (`dist/index.js`) because both
 * live two directories below the package root.
 */
export const VERSION: string = require("../../package.json").version;
