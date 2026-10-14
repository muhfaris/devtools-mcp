# GitLab inline comments through `gitlab_create_note`

Date: 2026-09-11

## Conclusion

Inline comments on a specific merge-request file and line are supported by GitLab and are intended to be supported by this MCP tool. The reported calls expose two separate issues: callers serialize unused optional numeric fields as `0`, and the current tool passes snake_case position keys to GitBeaker even though GitBeaker v43.8.0 expects camelCase position options.

## Correct tool inputs

For one line, send `path` and `line`; omit `start_line` and `end_line` entirely:

```json
{
  "path": "src/app.ts",
  "line": 18,
  "side": "right"
}
```

For a range, send `path`, `start_line`, and `end_line`; omit `line` entirely:

```json
{
  "path": "src/app.ts",
  "start_line": 17,
  "end_line": 23,
  "side": "right"
}
```

`right` addresses lines in the new file and `left` addresses lines in the old file. The requested path and lines must occur in the MR diff, not merely in the complete repository file.

## Evidence

1. GitLab's Discussions API supports diff threads through `POST /projects/:id/merge_requests/:merge_request_iid/discussions`. A text position requires `base_sha`, `head_sha`, `start_sha`, `position_type`, `old_path`, and `new_path`; a new-file line uses `new_line`, while a removed line uses `old_line`. Multi-line comments use `position[line_range]`, whose start and end require `line_code` and `type`.
   - Primary source: GitLab Discussions API, “Create a new thread in the merge request diff” and “Parameters for multiline comments”: https://docs.gitlab.com/api/discussions/#create-a-new-thread-in-the-merge-request-diff

2. The tool schema defines `line`, `start_line`, and `end_line` as optional numbers, but the MCP schema builder only marks them optional; it does not itself add zero values. Therefore the zeros in the logged arguments were supplied by the MCP client/model integration.
   - Project source: `src/tools/gitlab/create-note.ts`
   - Project source: `src/mcp/server.ts`

3. Current validation treats numeric zero specially only for `line` when a complete range exists. Thus `line: 1, start_line: 0, end_line: 0` is rejected as mixed single/range input. A call with `line: 0, start_line: 1, end_line: 1` enters the range path. Omitting unused fields is the reliable current calling convention.
   - Project source: `src/tools/gitlab/create-note.ts`, `validateInlinePosition`

4. GitBeaker v43.8.0 declares discussion position input as `Camelize<DiscussionNotePositionSchema>`, meaning option keys should be `baseSha`, `headSha`, `startSha`, `positionType`, `newPath`, `oldPath`, `newLine`, `oldLine`, and `lineRange`; range entries use `lineCode`, `newLine`, and `oldLine`.
   - Installed first-party library declarations: `node_modules/@gitbeaker/core/dist/index.d.ts`, `DiscussionNotePositionOptions` and `MergeRequestDiscussionNotePositionOptions`
   - Upstream project: https://github.com/jdalrymple/gitbeaker

5. GitBeaker's `ResourceDiscussions.create` decamelizes the position object and flattens it into GitLab form keys. Passing snake_case into this API is decamelized again by `xcase`; this is the likely cause of GitLab receiving an incomplete position and reporting blank/invalid `line_code`.
   - Installed first-party library implementation: `node_modules/@gitbeaker/core/dist/index.js`, `reformatObjectOptions` and `ResourceDiscussions.create`

6. Existing tests mock `MergeRequestDiscussions.create` and return the input position directly. They verify the pre-serialization object but do not test the actual GitBeaker multipart field names, so they do not detect this integration mismatch.
   - Project tests: `tests/unit/tools/gitlab/create-note.test.ts`

## Recommended fix

- Normalize zero-valued optional line fields to “absent” at the tool boundary, because some MCP clients emit `0` for omitted numeric arguments.
- Build GitBeaker position options in camelCase, including nested range keys.
- Add an integration-style serialization test that captures the multipart keys produced by GitBeaker and verifies GitLab-compatible names such as `position[base_sha]`, `position[new_line]`, and `position[line_range][start][line_code]`.
- Retain diff validation: GitLab only accepts positions belonging to the selected MR diff/version.



## Update 2026-09-25 — ranges that end on an unchanged line

A range whose end is a context line was rejected by GitLab with `line_code can't be
blank`, while an all-added range posted. The defect is the position entry, not
`createLineCode`: a context line exists on **both** sides of the diff, and an entry
addressed by one number alone does not resolve, so GitLab derives no `line_code`. A
changed line resolves from its single number plus `type`.

`buildRangeLine` in `src/tools/gitlab/create-note.ts` now emits, per range end:

| Line | Entry |
| :--- | :--- |
| Added (right) | `{ line_code, new_line, old_line: undefined, type: "new" }` |
| Removed (left) | `{ line_code, new_line: undefined, old_line, type: "old" }` |
| Unchanged | `{ line_code, old_line, new_line }` — both numbers, no `type` |

The changed-line shapes are unchanged, so only the previously failing case moves. The
range root line carries its counterpart the same way. Confirmation against a live MR is
still outstanding.

`line_code` stays `sha1(path)_old_new`, with an empty component for a side the line does
not exist on — that part was already correct.
