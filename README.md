# 🧰 DevTools MCP

> **Developer companion** for AI coding assistants — generate IDs, encode, decode, parse, and introspect your stack without leaving your editor.

[![npm version](https://img.shields.io/npm/v/@muhfaris/devtools.svg)](https://www.npmjs.com/package/@muhfaris/devtools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is DevTools MCP?

**DevTools MCP** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that brings developer utilities directly into your AI coding assistant (Claude Code, Cursor, CodeCompanion.nvim, etc.) and your terminal.

Everything is available as **MCP tools** (callable by your AI agent) and **CLI commands** (runnable from your terminal).

## Quick start

```bash
# CLI
npx @muhfaris/devtools generate-ulid --count 3

# Add to Claude Code (project-scoped)
claude mcp add devtools --project -- npx @muhfaris/devtools
```

Then in your assistant, type: *"Generate a ULID using devtools"*.

## Documentation

The `docs/` directory is the source of truth. Each topic lives in one place:

| Doc | Covers |
| :--- | :--- |
| [Architecture](./docs/Architecture.md) | Design, components, execution flow, security model |
| [Configuration](./docs/Configuration.md) | `.devtools/config.yaml`, env resolution, live reload |
| [MCP Clients](./docs/MCP-Clients.md) | Setup for Claude Code, Cursor, CodeCompanion, Codex, Inspector |
| [Tools](./docs/Tools.md) | Full tool reference with params and CLI examples |
| [Development](./docs/Development.md) | Build, test, add a tool, publish |
| [PRD](./docs/PRD.md) | Product vision, scope, roadmap |

## License

MIT © [Faris](https://github.com/muhfaris)

