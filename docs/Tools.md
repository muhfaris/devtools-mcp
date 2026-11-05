# Tools

> Reference for every DevTools MCP tool, its parameters, and CLI usage.

## ID generators

| Tool | Description | CLI example |
| :--- | :--- | :--- |
| `generate_ulid` | Generate ULID(s) | `devtools generate_ulid --count 5` |
| `generate_uuid` | Generate UUID v4(s) | `devtools generate_uuid --count 3` |
| `generate_id` | Generate identifiers in the format configured by `id_generator.default` (`ulid` or `uuid`); `--format` overrides | `devtools generate_id --count 5` |


## Dummy data

| Tool | Description | CLI example |
| :--- | :--- | :--- |
| `fake_person` | Generate realistic dummy person records with locale support | `devtools fake_person --count 5 --locale id` |
| `fake_company` | Generate realistic dummy company records with localized tax IDs | `devtools fake_company --count 5 --locale sg` |
| `public_holidays` | Retrieve real or generate synthetic public holidays for ID, MY, SG, and US | `devtools public_holidays --country_code ID --mode real` |


See [Dummy Data Guide](./Dummy.md) for full locale support (`en`, `id`, `my`, `sg`) and tax ID format specifications.



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
| `cron_parse` | Parse a five-field cron expression, describe it, and show the next runs in local time (`*`, lists, ranges, steps, names, `@daily`) | `devtools cron_parse --expression "0 9 * * *" --count 5` |
| `timezone_convert` | Convert timestamp between timezones | `devtools timezone_convert --to "Asia/Jakarta"` |
| `semver_bump` | Bump semantic version | `devtools semver_bump --version "1.2.3" --bump minor` |
| `slugify` | Convert string to URL-safe slug | `devtools slugify --text "Hello World!"` |
| `diff` | Compare two text strings or files without Git | `devtools diff --file1 a.txt --file2 b.txt` |
| `env_diff` | Compare .env and .env.example for missing/extra keys | `devtools env_diff --envPath .env --examplePath .env.example` |
| `port_check` | Check TCP port status and identify local listening PID / process | `devtools port_check --port 3000` |

> **`cron_parse` reads the expression it was given.** Five fields, in local time — cron has
> no timezone of its own, and every crontab on a machine is written in the machine's, so
> the answer carries both the local stamps and the ISO ones. Names (`jan`-`dec`,
> `sun`-`sat`), lists, ranges, steps, and `@daily`-style shorthands all work, and `7` is
> Sunday as it is in `0`. When both day fields are set, **either** may match —
> `0 0 1 * mon` is the first of the month *or* any Monday, which is cron's rule and the
> one a reader is most likely to assume otherwise. An expression that describes an
> impossible date (`0 0 30 2 *`) is refused with the reason, rather than answered with
> nothing.


## JSON Tools

| Tool | Description | CLI Example |
| :--- | :--- | :--- |
| `json_minify` | Minify/compact JSON | `devtools json_minify --json '{"name":"John"}'` |
| `json_format` | Pretty-print JSON with indentation | `devtools json_format --json '{"name":"John"}' --indent 2` |
| `json_validate` | Validate JSON syntax | `devtools json_validate --json '{"name":"John"}'` |
| `json_to_types` | Generate type definitions from JSON for many languages | `devtools json_to_types --json '{"name":"John"}' --targetLanguage go` |


## GitLab

| Tool | Description |
| :--- | :--- |
| `gitlab_list_mrs` | List merge requests, with filters. One page of `limit` |
| `gitlab_get_mr` | Get MR details, commits, and file diffs, with every line numbered for the old and new side. Commit subjects are returned; bodies need `include_messages: true`. Files whose patch GitLab withheld are marked `diffOmitted` |
| `gitlab_review_mr` | Review an MR with file-by-file suggestions. Files whose patch GitLab withheld are marked, listed in `filesNotReviewed`, and never counted as reviewed |
| `gitlab_get_mr_discussions` | Get discussion threads and comments on an MR. One page of 100 |
| `gitlab_get_file` | Read lines, ranges, or grep a repo file — no clone |
| `gitlab_get_commits` | Commit history for a branch, tag, or path (remote `git log`). One page of `limit`; commit bodies need `include_messages: true` |
| `gitlab_compare_branches` | Compare refs: commits, a per-file change list, and conflict status. Patches are opt-in (`include_diff: true`) |
| `gitlab_search_code` | Search code, symbols, or text across a repo (remote `git grep`). One page |
| `gitlab_create_mr` | Open a merge request from an existing source branch. Does not merge, approve, or assign |
| `gitlab_update_mr` | Change an MR's target branch, title, or description. Only the fields you pass change; it does not merge or close |
| `gitlab_create_note` | Add a comment to an MR (inline diff comments supported) |
| `gitlab_update_note` | Edit an existing MR comment — for when a review comment was wrong |
| `gitlab_delete_note` | Delete an MR comment (needs `confirm: true`) |
| `gitlab_set_config` | Set GitLab token/URL/projectId for the session |

> The GitLab write tools are `gitlab_create_mr`, `gitlab_update_mr`, `gitlab_create_note`, `gitlab_update_note`, and `gitlab_delete_note`. Writes are **denied by default**: enable them with `security.allow_write: true` (or `providers.gitlab.security.allow_write: true`), and keep the resolved project path/ID out of `blocked_env`, which defaults to `[production, prod]`. See [Configuration](./Configuration.md#what-is-actually-enforced).
>
> `show_config` lists any config key that nothing reads under `ignored_keys`. A guard
> that is not wired to anything — a misspelled key, a block that moved — appears there
> instead of being swallowed.

> **Every list tool returns one page.** `perPage` on its own bounds nothing in the
> GitLab client: it follows `Link: next` until the collection is exhausted, which is how
> `gitlab_get_commits` with `limit: 5` once answered with 33,000 lines of history. Each
> of these now asks for one page and says `truncated: true` when the page came back full,
> so a capped answer is never mistaken for a complete one:
>
> | Tool | Page |
> | :--- | :--- |
> | `gitlab_get_commits` | `limit` (default 10, max 100) |
> | `gitlab_list_mrs` | `limit` (default 20, max 100) |
> | `gitlab_search_code` | `per_page` (default 20, max 100), with `page` to go on |
> | `gitlab_get_mr_discussions` | 100 discussions |
> | `gitlab_get_mr` | 100 commits and 100 notes, reported as `truncated` |
>
> `gitlab_compare_branches` answers with the commit list and a per-file change list
> (path, status, additions, deletions — counted locally, since the compare endpoint
> carries no counts) and no patch text. Pass `include_diff: true` for each file's patch,
> capped at 800 characters per file unless `full_diff: true`, over at most `max_files`
> files (default 25, reported as `diffsOmitted`). GitLab also withholds some patches past
> its size limits: a file whose patch did not come back reports `additions`, `deletions`,
> and `patchChars` as `null` with a `diffOmitted` reason (`too_large`, `collapsed`, or
> `limit`) rather than a misleading `0`. `diffOmittedCount` (and `statsComplete`) says how
> many files that was, so a total summed from the list is never read as the full
> comparison.

> `gitlab_review_mr` reads its files from the MR changes endpoint, which withholds some
> patches past its size limits. A file whose patch did not come back is marked
> `reviewed: false` with a `diffOmitted` reason, listed by path in `filesNotReviewed`, and
> kept out of the summary's file count, change totals, and complexity lists — it is never
> reported as clean. Fetch each with `gitlab_get_file` and review it separately.
> `gitlab_get_mr` reads the same endpoint and marks the same files per entry with
> `diffOmitted`, with `diffOmittedCount` and `statsComplete` at the top level.

> **Commit bodies are opt-in everywhere.** `gitlab_get_commits`, `gitlab_get_mr`, and
> `gitlab_compare_branches` always return each commit's `title` (the subject line); the
> full `message` — subject plus body — arrives only with `include_messages: true`. A
> message body is often a release note or a paragraph of explanation, which is the bulk of
> a long log and rarely what the log is being read for.

## Database

| Tool | Description |
| :--- | :--- |
| `get_db_schema` | Introspect schema: tables, columns (with widths), constraints, indexes, relationships |
| `execute_query` | Run a SQL statement: reads anywhere, writes only where the grant, `readonly`, and `blocked_env` all allow |
| `explain_query` | Run EXPLAIN, and ANALYZE when asked, then summarize the plan the server actually returned |
| `database_set_connection` | Add/update a DB connection for the session |

> **MySQL and MariaDB are read as themselves.** Both are served by the same config value
> (`default_engine: mysql` or `mariadb`), but the provider asks the server which one it
> is at connect time, so `get_db_schema` and `explain_query` report the engine that
> answered. That is what makes MariaDB's `ANALYZE FORMAT=JSON` — the plan that carries
> `r_rows` and `r_total_time_ms` — readable as itself instead of as a MySQL plan full of
> `unknown`.
>
> `explain_query` honours `analyze` (default `true`). With `analyze: false` the statement
> is **not** run: PostgreSQL gets `EXPLAIN (VERBOSE, FORMAT JSON)`, MySQL and MariaDB get
> `EXPLAIN FORMAT=JSON`.
>
> With `analyze: true`, the summary reports what the server measured and stays quiet about
> what it did not — no `unknown` is printed where a number belongs. For MariaDB the three
> times are reported as three figures, because collapsing them is how a query gets misread:
> the **execution time** (`query_block.r_total_time_ms`, the statement's own runtime, shown
> with the JSON path it was read from), the sum of the **table reads**
> (`r_table_time_ms`), and the **plan build time** (`query_optimization.r_total_time_ms`),
> which is the optimizer choosing a plan and not the statement running. Note that MariaDB
> emits `query_optimization` _before_ `query_block`, so a reader that walks the whole
> document finds the optimizer's 0.1ms first — reporting a 6952ms query as instant. Also
> reported are per-table `other_time` (`r_other_time_ms`), the **pages read**
> (`r_engine_stats.pages_read_count` / `r_engine_stats.pages_read_time_ms`, which sit
> _inside_ each table node and are summed across the tree), and `loops` (`r_loops`) — the
> probe count, which is what makes a per-table time legible: an `eq_ref` table reads one row
> per loop, so `actual_rows=1` beside a 24-second `table_time` is only explicable once
> `loops=54084` sits next to it. `filtered` is reported as a percentage
> (`r_filtered` when measured, else the `filtered` estimate) and never as `filter=`, which
> is kept for a real `attached_condition` — a percentage printed under a predicate's label
> reads as a condition no row could satisfy. Pages are what show a cold
> cache, so when most of the table time went into reading them the summary says so: a
> reading of the numbers, not a verdict on the query.
>
> MariaDB's plan is a **tree**, and the summary keeps its shape. A `filesort` and a
> `materialized` derived table each get their own line, with the scans they caused indented
> beneath them — reading a materialised result and filling it are different phases, and a
> flat list of tables presents them as two unrelated rows. A `filesort` line reports
> `sort_key`, whether a **priority queue** was used, `sort_mode`, `limit`, `out_rows`, and
> its own time (`r_total_time_ms`).
>
> When a plan spans more than one `query_block`, a table's line names the block it belongs
> to — `t [select#2, materialized into <derived2>]` — because MariaDB will happily call two
> different tables `t`. Every marker on that label is the server's own: `select_id` and
> `operation` are its fields, and `materialized into` names the derived table the scan was
> reached through. No word is inferred from nesting, so a branch is never called "union"
> because it happened to sit under a `union_result`. In a single-block plan the markers are
> omitted — there is nothing to tell apart, and an annotation on every line is one a reader
> learns to skip. `union_result` is not a table anyone scans, so its name is reported on the
> derived table's line (`materialized UNION <union2,3>`) instead of as a phantom scan.

```json
{
  "summary": "MariaDB Execution Plan (ANALYZE, FORMAT=JSON):\n- select_id: 1\n- tables read: 4\n- execution time: 28142.775ms (query_block.r_total_time_ms)\n- time in table reads: 27945.646ms\n- plan build time (optimizer): 0.532ms\n- pages read: 75567, 27025.534ms\n- note: 27025.534ms of the 27945.646ms in table reads went to reading pages — a cold cache or a large scan rather than a slow filter\n- filesort: sort_key=t.created_at desc, t.`id` desc priority queue sort_mode=sort_key,rowid limit=11 out_rows=12 time=0.214ms\n  - <derived2>: materialized UNION <union2,3> access=ALL rows=108734 actual_rows=54084 loops=1 table_time=34.341ms other_time=71.013ms filtered=100%\n    - t [select#2, materialized into <derived2>]: access=ref rows=45576 actual_rows=22428 loops=1 table_time=64.768ms other_time=11.011ms pages_read=202 pages_time=52.501ms key=ticket_ie_11 filter=t.created_by = '01ZZACUS000000000000000007' filtered=100%\n    - ta [select#3 UNION, materialized into <derived2>]: access=ref rows=63158 actual_rows=31812 loops=1 table_time=5193.568ms other_time=41.415ms pages_read=18960 pages_time=4996.843ms key=FK_TICKET_ASSIGNEE_ACCOUNT filter=ta.deleted_at = 0 filtered=100%\n  - t [select#1]: access=eq_ref rows=1 actual_rows=1 loops=54084 table_time=22652.969ms other_time=73.352ms pages_read=56405 pages_time=21976.19ms key=PRIMARY filter=t.deleted_at = 0 and t.`stage` = 'In Progress' filtered=1.71%"
}
```

> `execute_query` is not read-only: a statement that is not a read runs when
> `security.allow_write` grants it **and** the connection is neither `readonly: true`
> nor named in `blocked_env`. `show_config` reports the answer per connection as
> `write_policy`, so the question "can this connection be written to?" has a stated
> answer rather than an inferred one. See
> [Per-connection `readonly`](./Configuration.md#per-connection-readonly).
>
> `explain_query` with `analyze: true` **runs** the statement it explains, so on a
> non-read statement it goes through the same write gate.


## Redis Tools

| Tool | Description | Access | CLI Example |
| :--- | :--- | :---: | :--- |
| `redis_info` | Server stats | read | `devtools redis_info --section memory` |
| `redis_list_keys` | Scan keys with pattern | read | `devtools redis_list_keys --pattern "user:*"` |
| `redis_get_key` | Get value by key | read | `devtools redis_get_key --key "user:1"` |
| `redis_key_info` | TTL, type, memory of keys | read | `devtools redis_key_info --keys "user:1,user:2"` |
| `redis_slowlog` | Slow query log | read | `devtools redis_slowlog --count 10` |
| `redis_set_key` | Set a string value | write | `devtools redis_set_key --key user:1 --value Alice` |
| `redis_delete_key` | Delete keys (needs confirm) | write | `devtools redis_delete_key --keys "user:1" --confirm true` |
| `redis_expire_key` | Set/remove TTL on a key | write | `devtools redis_expire_key --key session:abc --ttl 3600` |

> `redis_set_key`, `redis_delete_key`, and `redis_expire_key` write, so they are **denied by default**: enable them with `security.allow_write: true` (or `providers.redis.security.allow_write: true`), and keep the connection name out of `blocked_env`, which defaults to `[production, prod]`.
>
> A connection marked `readonly: true` refuses these tools outright, whatever `allow_write` says. `blocked_env` and `readonly` are both per-connection controls and answer different questions: the first matches a name, the second states an intent. See [Configuration](./Configuration.md#what-is-actually-enforced).

Redis connections may be **standalone** (`url`) or **sentinel-backed**
(`sentinels` + `master_name`). With Sentinel, the master is re-resolved on every
connect, so failovers are transparent to all of the tools above. See
[Configuration](./Configuration.md#redis-connection-fields) for the field list.


## Config tools

| Tool | Description |
| :--- | :--- |
| `gitlab_set_config` | Set GitLab config for the session |
| `database_set_connection` | Set a DB connection for the session |
| `providers_info` | Show safe database, GitLab, and Redis configuration; use `live: true` to check database and Redis health |
| `show_config` | Show the effective, credential-redacted runtime configuration and reload status. `show_credentials: true` unmasks `local`/`dev`/`development` connections only |
| `reload_config` | Re-read `.devtools/config.yaml`, replace the runtime config, and return the redacted view |
| `config_init` | Create a starter `.devtools/config.yaml` with database/GitLab/Redis connections; refuses to overwrite an existing config. Redis connections are always written standalone — see [limits](./Configuration.md#config_init-output) |

`providers_info` is config-only by default. With `live: true`, it connects to every configured database and Redis connection and reports each one's health; a connection that cannot be reached reports `healthy: false` without failing the response, and carries a `failure` naming the cause: a stable `reason` (`tls_certificate_untrusted`, `authentication_failed`, `connection_refused`, `connection_timeout`, `host_not_found`, `database_not_found`, or `connection_failed`), the driver `code` when it is shaped like a code, and a `hint` with what to change. The driver's own message is never included — it can quote the DSN back — so the reason is classified rather than echoed; see [TLS and the DSN](./Configuration.md#tls-and-the-dsn). GitLab is never contacted. Every connection also carries `checked`, so an absent `healthy` cannot be mistaken for a passing check. Credentials and raw DSNs are masked in every view; the only way to see one is `show_config` with `show_credentials: true` — see [Configuration](./Configuration.md).

## Adding a new tool

1. Create `src/tools/<category>/<name>.ts`.
2. Export a `Tool` object with `name`, `description`, `params`, `execute`.
3. Import and register it in `src/tools/index.ts`.
4. Add tests in `tests/unit/tools/<category>/`.
5. Rebuild and test.

See [Development](./Development.md) for the full workflow.
