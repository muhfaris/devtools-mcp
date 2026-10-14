/**
 * Whether a SQL statement may write.
 *
 * The question used to be asked with `/^\s*SELECT/i`, which is not a question about the
 * statement but about its first word: `WITH x AS (...) UPDATE ticket SET ...` starts with
 * `WITH`, was read as a read, and skipped the write gate entirely. The gate has to fail
 * closed, so anything that cannot be shown to be a read is treated as a write.
 */

/** Verbs that change data or structure. `SET` and `CALL` count: both reach outside the query. */
const WRITE_VERBS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "upsert",
  "replace",
  "truncate",
  "drop",
  "alter",
  "create",
  "rename",
  "grant",
  "revoke",
  "call",
  "do",
  "set",
  "copy",
  "load",
  "vacuum",
  "analyze",
  "optimize",
  "repair",
  "lock",
  "unlock",
  "attach",
  "detach",
  "refresh",
  "reindex",
  "comment",
  "listen",
  "notify",
]);

/** Leading verbs that cannot write on their own. */
const READ_VERBS = new Set([
  "select",
  "show",
  "describe",
  "desc",
  "explain",
  "values",
  "table",
  "use",
  "with",
  "pragma",
  "help",
]);

/**
 * Remove comments and string literals, so their words cannot be mistaken for the
 * statement's own. A literal is replaced by a space rather than dropped: `SELECT'UPDATE'`
 * must not weld into `SELECTUPDATE`.
 */
export const stripSqlNoise = (sql: string): string => {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (rest.startsWith("--") || rest.startsWith("#")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      out += " ";
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (rest.startsWith("'") || rest.startsWith('"') || rest.startsWith("`")) {
      const quote = sql[i];
      i++;
      while (i < sql.length) {
        // A doubled quote is an escaped quote, not the end of the literal.
        if (sql[i] === quote && sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          i++;
          break;
        }
        // Backslash escapes are a MySQL extension; honouring them costs nothing and
        // stops a `\'` from ending the literal early.
        i += sql[i] === "\\" ? 2 : 1;
      }
      out += " ";
      continue;
    }

    out += sql[i];
    i++;
  }

  return out;
};

/**
 * The words of a statement that sit outside every pair of parentheses.
 *
 * Depth matters because a write inside a CTE body is a sub-query's business, while the
 * verb after the CTE list is the statement's own: `WITH x AS (SELECT ...) DELETE FROM ...`
 * is a delete.
 */
const topLevelWords = (sql: string): string[] => {
  const words: string[] = [];
  let depth = 0;

  for (const token of sql.match(/[A-Za-z_][A-Za-z_0-9$]*|\(|\)/g) || []) {
    if (token === "(") {
      depth++;
      continue;
    }
    if (token === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) words.push(token.toLowerCase());
  }

  return words;
};

export type StatementKind = "read" | "write";

/**
 * `read` only when the statement opens with a read verb *and* no depth-zero write verb
 * appears anywhere in it — which also catches `SELECT 1; DROP TABLE users`, since a
 * driver that accepts multiple statements would run the second one.
 */
export const classifyStatement = (sql: string): StatementKind => {
  const words = topLevelWords(stripSqlNoise(sql));
  if (words.length === 0) return "write";
  if (words.some((word) => WRITE_VERBS.has(word))) return "write";
  return READ_VERBS.has(words[0]) ? "read" : "write";
};
