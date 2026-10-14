import { describe, expect, it } from "vitest";
import {
  classifyStatement,
  stripSqlNoise,
} from "../../../../src/tools/database/statement.js";

describe("stripSqlNoise", () => {
  it("removes line and block comments", () => {
    expect(stripSqlNoise("SELECT 1 -- update users\nFROM t")).not.toContain(
      "update",
    );
    expect(stripSqlNoise("SELECT /* delete from users */ 1")).not.toContain(
      "delete",
    );
  });

  it("keeps a literal from welding into the word before it", () => {
    // Dropping the literal outright would leave `SELECTUPDATE`, one token that matches
    // no verb and would be read as neither.
    expect(stripSqlNoise("SELECT'UPDATE'")).toMatch(/^SELECT\s+$/);
  });

  it("does not end a literal at an escaped quote", () => {
    expect(stripSqlNoise("SELECT 'it\\'s -- not a comment' AS x")).toContain(
      "AS x",
    );
  });

  it("does not end a literal at a doubled quote", () => {
    expect(stripSqlNoise("SELECT 'a''b -- c' AS x")).toContain("AS x");
  });
});

describe("classifyStatement", () => {
  it("reads a plain select", () => {
    expect(classifyStatement("SELECT * FROM ticket")).toBe("read");
    expect(classifyStatement("  \n\t select 1")).toBe("read");
  });

  it("reads the reporting verbs", () => {
    for (const sql of [
      "SHOW TABLES",
      "DESCRIBE ticket",
      "DESC ticket",
      "EXPLAIN SELECT 1",
      "VALUES (1)",
      "PRAGMA table_info(t)",
    ]) {
      expect(classifyStatement(sql), sql).toBe("read");
    }
  });

  it("writes for the obvious verbs", () => {
    for (const sql of [
      "UPDATE ticket SET deleted_at = deleted_at WHERE 1 = 0",
      "DELETE FROM ticket",
      "INSERT INTO ticket (id) VALUES (1)",
      "TRUNCATE ticket",
      "DROP TABLE ticket",
      "SET SESSION TRANSACTION READ ONLY",
      "CALL refresh_tickets()",
    ]) {
      expect(classifyStatement(sql), sql).toBe("write");
    }
  });

  it("writes for a write hidden behind a CTE", () => {
    // The regression this replaces: the old test asked whether the statement started with
    // SELECT, and `WITH` answered no to a question nobody had asked.
    expect(
      classifyStatement(
        "WITH stale AS (SELECT id FROM ticket WHERE deleted_at IS NULL) UPDATE ticket SET deleted_at = now() WHERE id IN (SELECT id FROM stale)",
      ),
    ).toBe("write");
  });

  it("reads a select behind a CTE", () => {
    expect(
      classifyStatement(
        "WITH stale AS (SELECT id FROM ticket) SELECT * FROM stale",
      ),
    ).toBe("read");
  });

  it("writes for a second statement after a read", () => {
    // A driver that accepts multiple statements would run the second one.
    expect(classifyStatement("SELECT 1; DROP TABLE ticket")).toBe("write");
  });

  it("ignores a verb that only appears inside a sub-query", () => {
    expect(
      classifyStatement(
        "SELECT * FROM (SELECT 1) x WHERE x.a IN (SELECT b FROM t)",
      ),
    ).toBe("read");
  });

  it("does not mistake an identifier for a verb", () => {
    expect(classifyStatement("SELECT * FROM update_log")).toBe("read");
    expect(classifyStatement("SELECT deleted_at FROM ticket")).toBe("read");
  });

  it("does not read a verb out of a comment or a literal", () => {
    expect(classifyStatement("SELECT 1 -- DROP TABLE ticket")).toBe("read");
    expect(classifyStatement("SELECT 'DROP TABLE ticket' AS sql")).toBe("read");
  });

  it("treats an unrecognised opening verb as a write", () => {
    // Fail closed: a statement nobody can show to be a read is not a read.
    expect(classifyStatement("GRANT ALL ON ticket TO x")).toBe("write");
    expect(classifyStatement("VACUUM")).toBe("write");
    expect(classifyStatement("")).toBe("write");
    expect(classifyStatement("   ")).toBe("write");
  });
});
