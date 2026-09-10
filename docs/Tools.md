# Tools

> Reference for every DevTools MCP tool, its parameters, and CLI usage.

## ID generators

| Tool | Description | CLI example |
| :--- | :--- | :--- |
| `generate_ulid` | Generate ULID(s) | `devtools generate_ulid --count 5` |
| `generate_uuid` | Generate UUID v4(s) | `devtools generate_uuid --count 3` |

## Encoding & security

| Tool | Description | CLI example |
| :--- | :--- | :--- |
| `base64_encode` | Encode string to Base64 | `devtools base64_encode --text "Hello"` |
| `base64_decode` | Decode Base64 to string | `devtools base64_decode --encoded "SGVsbG8="` |
| `jwt_decode` | Decode JWT token | `devtools jwt_decode --token "eyJ..."` |
| `hash_generate` | Generate MD5/SHA1/SHA256/SHA512 | `devtools hash_generate --text "hello" --algorithm sha256` |
| `secret_generate` | Generate secure random secret | `devtools secret_generate --length 32 --format base64` |
| `regex_test` | Test regex against a string | `devtools regex_test --pattern '^[a-z]+$' --text "hello"` |

## Misc utilities

| Tool | Description | CLI example |
| :--- | :--- | :--- |
| `cron_parse` | Parse cron expression, show next runs | `devtools cron_parse --expression "0 9 * * *" --count 5` |
| `timezone_convert` | Convert timestamp between timezones | `devtools timezone_convert --to "Asia/Jakarta"` |
| `semver_bump` | Bump semantic version | `devtools semver_bump --version "1.2.3" --bump minor` |
| `slugify` | Convert string to URL-safe slug | `devtools slugify --text "Hello World!"` |


## JSON Tools

| Tool | Description | CLI Example |
| :--- | :--- | :--- |
| `json_minify` | Minify/compact JSON | `devtools json_minify --json '{"name":"John"}'` |
| `json_format` | Pretty-print JSON with indentation | `devtools json_format --json '{"name":"John"}' --indent 2` |
| `json_validate` | Validate JSON syntax | `devtools json_validate --json '{"name":"John"}'` |


## GitLab

| Tool | Description |
| :--- | :--- |
| `gitlab_list_mrs` | List merge requests |
| `gitlab_get_mr` | Get MR details + diff |
| `gitlab_create_note` | Add a comment to an MR |
| `gitlab_review_mr` | Review an MR with suggestions |
| `gitlab_get_discussions` | Get MR discussions |
| `gitlab_set_config` | Set GitLab token/URL/projectId for the session |

## Database

| Tool | Description |
| :--- | :--- |
| `get_db_schema` | Introspect schema (tables, columns, constraints) |
| `execute_query` | Run a read-only SQL query |
| `explain_query` | Run EXPLAIN and summarize performance |
| `database_set_connection` | Add/update a DB connection for the session |


## Redis Tools

| Tool | Description | Read-only | CLI Example |
| :--- | :--- | :---: | :--- |
| `redis_info` | Server stats | ✅ | `devtools redis_info --section memory` |
| `redis_list_keys` | Scan keys with pattern | ✅ | `devtools redis_list_keys --pattern "user:*"` |
| `redis_get_key` | Get value by key | ✅ | `devtools redis_get_key --key "user:1"` |
| `redis_key_info` | TTL, type, memory of keys | ✅ | `devtools redis_key_info --keys "user:1,user:2"` |
| `redis_slowlog` | Slow query log | ✅ | `devtools redis_slowlog --count 10` |
| `redis_set_key` | Set a string value | ✏️ | `devtools redis_set_key --key user:1 --value Alice` |
| `redis_delete_key` | Delete keys (needs confirm) | ✏️ | `devtools redis_delete_key --keys "user:1" --confirm true` |
| `redis_expire_key` | Set/remove TTL on a key | ✏️ | `devtools redis_expire_key --key session:abc --ttl 3600` |

> Write tools require `readonly: false` in the connection config and are blocked in environments matching `security.execute_query.blocked_env`.


## Config tools

| Tool | Description |
| :--- | :--- |
| `gitlab_set_config` | Set GitLab config for the session |
| `database_set_connection` | Set a DB connection for the session |
| `providers_info` | Show safe database, GitLab, and Redis configuration; use `live: true` to check database health |

`providers_info` is config-only by default. With `live: true`, it connects only to configured database connections and reports their health. GitLab is never contacted and reports only `enabled` and `token_configured`; Redis reports safe connection metadata. Credentials and raw DSNs are never returned.

## Adding a new tool

1. Create `src/tools/<category>/<name>.ts`.
2. Export a `Tool` object with `name`, `description`, `params`, `execute`.
3. Import and register it in `src/tools/index.ts`.
4. Add tests in `tests/unit/tools/<category>/`.
5. Rebuild and test.

See [Development](./Development.md) for the full workflow.
