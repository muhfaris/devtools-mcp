# 🧰 DevTools MCP

> **Developer companion** for AI coding assistants — generate IDs, encode, decode, parse, and introspect your stack without leaving your editor.

[![npm version](https://img.shields.io/npm/v/@muhfaris/devtools.svg)](https://www.npmjs.com/package/@muhfaris/devtools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is DevTools MCP?

**DevTools MCP** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that brings developer utilities directly into your AI coding assistant (Claude Code, Cursor, CodeCompanion.nvim, etc.) and your terminal.

Everything is available as **MCP tools** (callable by your AI agent) and **CLI commands** (runnable from your terminal).

## Requirements

Node.js **20.19 or newer** — `npx` runs it with no install step and no build.

## Quick start

### CLI

```bash
npx @muhfaris/devtools generate_ulid --count 3
npx @muhfaris/devtools --help
```

CLI command names are identical to the tool names (`generate_ulid`, not
`generate-ulid`).

### MCP (for your AI assistant)

```bash
# Claude Code, project-scoped
claude mcp add devtools --project -- npx -y @muhfaris/devtools
```

Then ask: *"Generate a ULID using devtools"*.

Cursor, CodeCompanion.nvim, Codex CLI, and MCP Inspector setups live in
[MCP Clients](https://github.com/muhfaris/devtools-mcp/blob/main/docs/MCP-Clients.md).

## What's included

**68 tools**, each exposed twice — as an MCP tool to your agent and as a CLI
command to your shell.

| Area | Tools |
| :--- | :--- |
| IDs | `generate_ulid`, `generate_uuid`, `generate_id` |
| Encoding & security | `base64_encode`, `base64_decode`, `jwt_decode`, `hash_generate`, `secret_generate`, `regex_test` |
| Dummy data | `fake_person`, `fake_company`, `public_holidays` — locales `en`, `id`, `my`, `sg` |
| JSON | `json_format`, `json_minify`, `json_validate`, `json_to_types` |
| GitLab | `gitlab_list_mrs`, `gitlab_get_mr`, `gitlab_review_mr`, `gitlab_get_mr_discussions`, `gitlab_get_file`, `gitlab_get_commits`, `gitlab_compare_branches`, `gitlab_search_code`, `gitlab_create_mr`, `gitlab_update_mr`, `gitlab_create_note`, `gitlab_update_note`, `gitlab_delete_note` |
| GitHub | `github_list_prs`, `github_get_pr`, `github_review_pr`, `github_get_pr_discussions`, `github_get_file`, `github_get_commits`, `github_compare_branches`, `github_search_code`, `github_create_pr`, `github_update_pr`, `github_create_comment`, `github_update_comment`, `github_delete_comment` |
| Database | `get_db_schema`, `execute_query`, `explain_query`, `database_set_connection` |
| Redis | `redis_info`, `redis_list_keys`, `redis_get_key`, `redis_key_info`, `redis_slowlog`, `redis_set_key`, `redis_delete_key`, `redis_expire_key` |
| Config | `show_config`, `providers_info`, `config_init`, `reload_config`, `gitlab_set_config`, `github_set_config` |
| Misc | `cron_parse`, `timezone_convert`, `semver_bump`, `slugify`, `diff`, `env_diff`, `port_check` |

Full parameters and CLI examples: [Tools](https://github.com/muhfaris/devtools-mcp/blob/main/docs/Tools.md).

## Writes are denied by default

Tools that mutate — `execute_query`, `redis_set_key`, `redis_delete_key`,
`redis_expire_key`, `gitlab_create_mr`, `gitlab_update_mr`, `gitlab_create_note`,
`gitlab_update_note`, `gitlab_delete_note`, `github_create_pr`,
`github_update_pr`, `github_create_comment`, `github_update_comment`,
`github_delete_comment` — refuse to run until you grant them.

- `allow_write` is an explicit **grant**: `false` by default, resolvable per
  provider (`providers.<name>.security.allow_write`), falling back to
  `security.allow_write`.
- `blocked_env` defaults to `[production, prod]` and substring-matches the
  connection or project name, so a production target stays blocked even when
  writes are enabled.
- `readonly: true` on a connection is a **hard deny that outranks the grant**: no
  value of `allow_write` lets a write through there. It is enforced twice — the tool
  refuses the statement, and the session is opened read-only (`SET SESSION ... READ
  ONLY`), so the server refuses whatever the tool did not recognise. `show_config`
  reports the outcome per connection as `write_policy`.

A config key nothing reads is reported rather than ignored: `show_config` lists it
under `ignored_keys`, and the load warns about it on stderr.

Command values follow the same rule. A config value prefixed `cmd:` runs that command and
takes its stdout, and is denied until `DEVTOOLS_ALLOW_CMD=1` is in the environment the
server is launched with. That grant is an environment variable rather than a config key
on purpose: a cloned repository can supply a `.devtools/config.yaml`, and it must not be
able to author its own code execution.

Nothing else needs configuring: with no `.devtools/config.yaml` the pure tools
work and the rest fail with a clear message. `config_init` scaffolds one.

See [Configuration](https://github.com/muhfaris/devtools-mcp/blob/main/docs/Configuration.md#what-is-actually-enforced).

## Documentation

The `docs/` directory is the source of truth. Each topic lives in one place:

| Doc | Covers |
| :--- | :--- |
| [Architecture](https://github.com/muhfaris/devtools-mcp/blob/main/docs/Architecture.md) | Design, components, execution flow, security model |
| [Configuration](https://github.com/muhfaris/devtools-mcp/blob/main/docs/Configuration.md) | `.devtools/config.yaml`, env resolution, live reload |
| [MCP Clients](https://github.com/muhfaris/devtools-mcp/blob/main/docs/MCP-Clients.md) | Setup for Claude Code, Cursor, CodeCompanion, Codex, Inspector |
| [Tools](https://github.com/muhfaris/devtools-mcp/blob/main/docs/Tools.md) | Full tool reference with params and CLI examples |
| [Dummy Data](https://github.com/muhfaris/devtools-mcp/blob/main/docs/Dummy.md) | Locale-aware fake data generation (person, company, tax IDs) |
| [Development](https://github.com/muhfaris/devtools-mcp/blob/main/docs/Development.md) | Build, test, add a tool, publish |
| [PRD](https://github.com/muhfaris/devtools-mcp/blob/main/docs/PRD.md) | Product vision, scope, roadmap |

## License

MIT © [Faris](https://github.com/muhfaris)

