import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

/**
 * The provider is replaced wholesale: these tests are about reading a plan, and a fake
 * that returned one would still have to be told what MariaDB, MySQL, and PostgreSQL each
 * answer — which is exactly the fixture.
 */
const state = vi.hoisted(() => ({
  engine: "mariadb",
  explainResult: undefined as unknown,
  calls: [] as { query: string; analyze: boolean }[],
}));

vi.mock("../../../../src/providers/index.js", () => ({
  createProvider: () => ({
    connect: async () => {},
    disconnect: async () => {},
    explainQuery: async (query: string, analyze: boolean) => {
      state.calls.push({ query, analyze });
      return state.explainResult;
    },
    getEngine: () => state.engine,
    introspect: async () => ({ tables: [], relationships: [] }),
    executeQuery: async () => [],
    healthCheck: async () => true,
  }),
}));

import { explainQueryTool } from "../../../../src/tools/database/explain.js";

const originalConfig = (global as any).__devtools_config;

/** One cell, one JSON document — the shape both MySQL and MariaDB answer with. */
const jsonCell = (column: string, document: unknown) => [
  { [column]: JSON.stringify(document) },
];

const config = (extra: Record<string, unknown> = {}) => ({
  providers: {
    database: {
      default_engine: "mariadb",
      connections: { dev: { dsn: "mariadb://localhost/app" }, ...extra },
    },
  },
});

/**
 * A captured `ANALYZE FORMAT=JSON` document, read from disk rather than transcribed.
 *
 * Read, not retyped, on purpose. A previous round asserted against a fixture that put
 * `pages_read_count` directly on the table node, where the server does not put it — the test
 * passed and the tool stayed broken. The first attempt at this file's own fixture then lost
 * `r_loops` and `filtered` the same way. A document copied through a person drifts;
 * `tests/fixtures/mariadb/` holds the bytes the server actually returned.
 */
const captured = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/mariadb/${name}`, import.meta.url),
      "utf8",
    ),
  );

beforeEach(() => {
  state.calls.length = 0;
  state.engine = "mariadb";
  state.explainResult = undefined;
  (global as any).__devtools_config = config();
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("explain_query", () => {
  it("passes the analyze flag to the provider", async () => {
    state.explainResult = { query_block: { select_id: 1 } };

    await parseToolJson(explainQueryTool, { query: "SELECT 1" });
    await parseToolJson(explainQueryTool, {
      query: "SELECT 1",
      analyze: false,
    });

    // The flag used to be documented and then dropped on the floor: the provider always
    // ran ANALYZE, which executes the statement.
    expect(state.calls).toEqual([
      { query: "SELECT 1", analyze: true },
      { query: "SELECT 1", analyze: false },
    ]);
  });

  it("summarizes a MariaDB ANALYZE plan with the actuals it carries", async () => {
    state.engine = "mariadb";
    // The shape the reviewer's plan had: the total on the block, the read time on the
    // table, and the page counters that say where the read time went.
    state.explainResult = jsonCell("ANALYZE", {
      query_block: {
        select_id: 1,
        r_loops: 1,
        r_total_time_ms: 5178,
        nested_loop: [
          {
            table: {
              table_name: "ticket",
              access_type: "ref",
              key: "idx_ticket_customer",
              rows: 120,
              r_rows: 3,
              r_table_time_ms: 5164,
              r_other_time_ms: 14,
              pages_read_count: 3120,
              pages_read_time_ms: 5100,
              attached_condition: "(ticket.deleted_at is null)",
            },
          },
        ],
      },
    });

    const result = await parseToolJson(explainQueryTool, { query: "SELECT 1" });

    expect(result.engine).toBe("mariadb");
    expect(result.analyzed).toBe(true);
    expect(result.format).toBe("json");
    expect(result.summary).toContain(
      "MariaDB Execution Plan (ANALYZE, FORMAT=JSON)",
    );
    expect(result.summary).toContain("select_id: 1");
    // The finding this replaces: the table's time was read from the block's own
    // `r_total_time_ms`, which no table node carries, so the line said `time=unknownms`
    // and the total — a sum of those missings — said `0.000ms` next to a five-second plan.
    expect(result.summary).toContain(
      "- execution time: 5178ms (query_block.r_total_time_ms)",
    );
    expect(result.summary).toContain("- time in table reads: 5164ms");
    expect(result.summary).toContain("- pages read: 3120, 5100ms");
    expect(result.summary).toContain(
      "- ticket: access=ref rows=120 actual_rows=3 table_time=5164ms other_time=14ms pages_read=3120 pages_time=5100ms key=idx_ticket_customer filter=(ticket.deleted_at is null)",
    );
    expect(result.summary).not.toMatch(/unknownms|0\.000ms/);
    expect(result.summary).toContain(
      "- note: 5100ms of the 5164ms in table reads went to reading pages",
    );
  });

  it("reports the block total and the table reads separately", async () => {
    // Two numbers, not one: the block total includes everything outside the scans, and the
    // sum of the scans does not. Collapsing them would make a reader distrust whichever
    // came first.
    state.explainResult = jsonCell("ANALYZE", {
      query_block: {
        select_id: 1,
        r_total_time_ms: 90,
        nested_loop: [
          {
            table: {
              table_name: "ticket",
              access_type: "ALL",
              r_rows: 10,
              r_table_time_ms: 20,
              r_other_time_ms: 3,
            },
          },
          {
            table: {
              table_name: "customer",
              access_type: "eq_ref",
              r_rows: 10,
              r_table_time_ms: 5,
            },
          },
        ],
      },
    });

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).toContain(
      "- execution time: 90ms (query_block.r_total_time_ms)",
    );
    expect(summary).toContain("- time in table reads: 25ms");
    // A warm cache: most of the time was somewhere other than reading pages, so there is
    // nothing to point at and nothing is pointed at.
    expect(summary).not.toContain("went to reading pages");
    expect(summary).not.toContain("pages read");
  });

  it("finds the block total wherever the server put it", async () => {
    // MariaDB reports the total on the block a set of tables belongs to, which is the
    // query_block in one version and the nested_loop below it in another.
    state.explainResult = jsonCell("ANALYZE", {
      query_block: {
        select_id: 1,
        nested_loop: [
          {
            r_total_time_ms: 250,
            table: {
              table_name: "ticket",
              access_type: "ALL",
              r_rows: 10,
              r_table_time_ms: 240,
            },
          },
        ],
      },
    });

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).toContain(
      "- execution time: 250ms (query_block.nested_loop.r_total_time_ms)",
    );
    expect(summary).toContain("- time in table reads: 240ms");
  });

  it("does not pass one table's time off as the query's total", async () => {
    // No block-level total in the document at all: the table's `r_total_time_ms` is that
    // table's time, and printing it as the plan's total would be a different, wrong claim.
    state.explainResult = jsonCell("ANALYZE", {
      query_block: {
        select_id: 1,
        table: {
          table_name: "ticket",
          access_type: "ALL",
          r_rows: 10,
          r_total_time_ms: 5164,
        },
      },
    });

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).not.toContain("- execution time");
    expect(summary).toContain("table_time=5164ms");
  });

  it("does not report the optimizer's time as the query's total", async () => {
    // The real document, whole. `query_optimization` comes first and `query_block`
    // second, and the document-wide search met the optimizer's field first — printing
    // 0.105ms as the total of a query that ran for 6952ms, a summary that reads as
    // "fast" about a query whose own table reads say otherwise.
    state.explainResult = jsonCell(
      "ANALYZE",
      captured("analyze-ticket-assignee.json"),
    );

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).toContain(
      "- execution time: 6952.112ms (query_block.r_total_time_ms)",
    );
    expect(summary).toContain("- time in table reads: 6943.121ms");
    // Stated on its own line, and labelled, so it cannot be read as execution time.
    expect(summary).toContain("- plan build time (optimizer): 0.105ms");
    expect(summary).not.toContain("- execution time: 0.105ms");
    // The whole per-table line, so the ordering and every field on it are locked against
    // the real document rather than against a subset match that a new field would slip
    // past — which is how the last round's fix passed its tests while staying broken.
    expect(summary).toContain(
      "- ticket_assignee: access=ref rows=63158 actual_rows=31812 loops=1 table_time=6943.121ms other_time=8.988ms pages_read=18972 pages_time=6707.562ms key=FK_TICKET_ASSIGNEE_ACCOUNT filter=ticket_assignee.deleted_at = 0 filtered=100%",
    );
  });

  it("reads the engine stats nested in each table node", async () => {
    // `r_engine_stats` sits *inside* the table node rather than beside `r_table_time_ms`,
    // and every table carries its own. Reading only the node's own fields found no pages
    // at all, so a plan that spent 96% of its time on disk said nothing about disk.
    state.explainResult = jsonCell("ANALYZE", {
      query_optimization: { r_total_time_ms: 0.1 },
      query_block: {
        select_id: 1,
        r_total_time_ms: 30,
        nested_loop: [
          {
            table: {
              table_name: "ticket_assignee",
              access_type: "ref",
              r_rows: 31812,
              r_table_time_ms: 20,
              r_engine_stats: {
                pages_accessed: 95571,
                pages_read_count: 18972,
                pages_read_time_ms: 19,
              },
            },
          },
          {
            table: {
              table_name: "ticket",
              access_type: "eq_ref",
              r_rows: 2,
              r_table_time_ms: 4,
              r_engine_stats: { pages_read_count: 3, pages_read_time_ms: 3 },
            },
          },
        ],
      },
    });

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    // Summed across the tree, and reported per table where each figure came from.
    expect(summary).toContain("- pages read: 18975, 22ms");
    expect(summary).toContain("pages_read=18972 pages_time=19ms");
    expect(summary).toContain("pages_read=3 pages_time=3ms");
    expect(summary).toContain(
      "- note: 22ms of the 24ms in table reads went to reading pages",
    );
  });

  it("reports the probe count beside the rows", async () => {
    // `eq_ref` reads one row per loop, so `actual_rows=1` next to a 24-second table time
    // reads as a table that took 24 seconds to produce a single row. The probe count is
    // the half that explains it: that time is 54084 separate reads of one row.
    state.explainResult = jsonCell("ANALYZE", {
      query_block: {
        select_id: 1,
        r_total_time_ms: 23930,
        nested_loop: [
          {
            table: {
              table_name: "t",
              access_type: "eq_ref",
              r_loops: 54084,
              r_rows: 1,
              r_table_time_ms: 23920,
            },
          },
        ],
      },
    });

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).toContain(
      "- t: access=eq_ref actual_rows=1 loops=54084 table_time=23920ms",
    );
  });

  it("does not print a percentage as a filter condition", async () => {
    // A table carrying no `attached_condition` but a `filtered` of 100 used to print
    // `filter=100`: a percentage wearing the label of a predicate, which reads as a
    // condition no row can satisfy. The number is still reported — as a percentage.
    state.explainResult = jsonCell("ANALYZE", {
      query_block: {
        select_id: 1,
        r_total_time_ms: 10,
        nested_loop: [
          {
            table: {
              table_name: "<derived2>",
              access_type: "ALL",
              r_rows: 54084,
              r_table_time_ms: 9,
              filtered: 100,
              r_filtered: 100,
            },
          },
        ],
      },
    });

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).not.toContain("filter=100");
    expect(summary).toContain("filtered=100%");
  });

  it("prefers the measured filter share to the estimate", async () => {
    state.explainResult = jsonCell("ANALYZE", {
      query_block: {
        select_id: 1,
        r_total_time_ms: 10,
        nested_loop: [
          {
            table: {
              table_name: "t",
              access_type: "ref",
              r_rows: 10,
              r_table_time_ms: 5,
              filtered: 100,
              r_filtered: 12.34,
            },
          },
        ],
      },
    });

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).toContain("filtered=12.34%");
    expect(summary).not.toContain("filtered=100%");
  });

  it("reads a filesort, a materialised union, and two tables both named t", async () => {
    // The whole document, from the server. It holds the three shapes a flat walk gets wrong
    // at once: a `filesort` whose tables sit under `temporary_table` rather than under the
    // block, a `materialized` derived table whose branches are `query_specifications`, and
    // two tables both named `t` in different `query_block`s.
    state.explainResult = jsonCell(
      "ANALYZE",
      captured("analyze-union-filesort.json"),
    );

    const summary = (
      await parseToolJson(explainQueryTool, { query: "SELECT 1" })
    ).summary;

    expect(summary).toContain(
      "- execution time: 28142.775ms (query_block.r_total_time_ms)",
    );
    expect(summary).toContain("- plan build time (optimizer): 0.532ms");

    // The plan itself: every line, in order, at the depth it was read at. A parent's nest
    // is what separates building the materialised result from reading it back.
    expect(summary).toContain(
      [
        "- filesort: sort_key=t.created_at desc, t.`id` desc priority queue sort_mode=sort_key,rowid limit=11 out_rows=12 time=0.214ms",
        "  - <derived2>: materialized UNION <union2,3> access=ALL rows=108734 actual_rows=54084 loops=1 table_time=34.341ms other_time=71.013ms filtered=100%",
        "    - t [select#2, materialized into <derived2>]: access=ref rows=45576 actual_rows=22428 loops=1 table_time=64.768ms other_time=11.011ms pages_read=202 pages_time=52.501ms key=ticket_ie_11 filter=t.created_by = '01ZZACUS000000000000000007' filtered=100%",
        "    - ta [select#3 UNION, materialized into <derived2>]: access=ref rows=63158 actual_rows=31812 loops=1 table_time=5193.568ms other_time=41.415ms pages_read=18960 pages_time=4996.843ms key=FK_TICKET_ASSIGNEE_ACCOUNT filter=ta.deleted_at = 0 filtered=100%",
        "  - t [select#1]: access=eq_ref rows=1 actual_rows=1 loops=54084 table_time=22652.969ms other_time=73.352ms pages_read=56405 pages_time=21976.19ms key=PRIMARY filter=t.deleted_at = 0 and t.`stage` = 'In Progress' filtered=1.71%",
      ].join("\n"),
    );

    // `UNION` is printed because the block declared `"operation": "UNION"`, and the second
    // `select#2` branch carries no operation — its block has none, so none is claimed.
    expect(summary).not.toContain("select#2 UNION");

    // Four scans, and `<union2,3>` is not one of them: it names the set the union produced,
    // and reading its `table_name` as a table invented a scan no statement performs.
    expect(summary).toContain("- tables read: 4");
    expect(summary).not.toContain("<union2,3>:");

    // The estimate is `1.708453517`, which is a float rather than a measurement to nine
    // places.
    expect(summary).not.toContain("1.708453517");
  });

  it("says so when the plan carries estimates only", async () => {
    state.explainResult = jsonCell("EXPLAIN", {
      query_block: {
        select_id: 1,
        table: { table_name: "ticket", access_type: "ALL", rows: 100 },
      },
    });

    const result = await parseToolJson(explainQueryTool, { query: "SELECT 1" });

    expect(result.summary).toContain(
      "note: this plan carries no actual rows, so it is estimates only",
    );
  });

  it("quotes MySQL's EXPLAIN ANALYZE tree", async () => {
    state.engine = "mysql";
    state.explainResult = [
      {
        EXPLAIN:
          "-> Filter: (ticket.id > 1)  (cost=0.85 rows=2) (actual time=0.05..0.06 rows=3 loops=1)\n    -> Table scan on ticket",
      },
    ];

    const result = await parseToolJson(explainQueryTool, { query: "SELECT 1" });

    expect(result.engine).toBe("mysql");
    expect(result.format).toBe("tree");
    expect(result.summary).toContain(
      "MySQL Execution Plan (EXPLAIN ANALYZE, tree)",
    );
    expect(result.summary).toContain("-> Table scan on ticket");
  });

  it("labels the plan with the server that answered, not the one the config named", async () => {
    // `default_engine: mariadb` reaches a MySQL server often enough — one config value
    // covers both — and a MySQL tree read as MariaDB prints nothing useful at all.
    state.engine = "mysql";
    state.explainResult = [{ EXPLAIN: "-> Table scan on ticket" }];

    const result = await parseToolJson(explainQueryTool, { query: "SELECT 1" });

    expect(result.engine).toBe("mysql");
    expect(result.summary).not.toContain("MariaDB");
  });

  it("summarizes a PostgreSQL ANALYZE plan", async () => {
    state.engine = "postgresql";
    state.explainResult = [
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Relation Name": "ticket",
          "Total Cost": 12.5,
          "Plan Rows": 3,
          "Plan Width": 8,
          "Actual Rows": 3,
          "Actual Total Time": 0.42,
          "Actual Loops": 1,
        },
      },
    ];

    const result = await parseToolJson(explainQueryTool, { query: "SELECT 1" });

    expect(result.summary).toContain("PostgreSQL Execution Plan (ANALYZE)");
    expect(result.summary).toContain("- Actual Rows: 3");
    expect(result.summary).toContain("- Actual Time: 0.42ms");
    expect(result.summary).toContain("- Relation: ticket");
  });

  it("does not claim actuals it was not asked to collect", async () => {
    state.engine = "postgresql";
    state.explainResult = [
      { Plan: { "Node Type": "Seq Scan", "Plan Rows": 3 } },
    ];

    const result = await parseToolJson(explainQueryTool, {
      query: "SELECT 1",
      analyze: false,
    });

    expect(result.summary).toContain("PostgreSQL Execution Plan (EXPLAIN)");
    expect(result.summary).not.toContain("Actual Rows");
  });

  it("refuses to run a write it was asked to analyze", async () => {
    (global as any).__devtools_config = config();

    await expect(
      explainQueryTool.execute({
        query: "UPDATE ticket SET deleted_at = now()",
      }),
    ).rejects.toMatchObject({ code: "DATABASE_WRITE_DISABLED" });
    expect(state.calls).toEqual([]);
  });

  it("reads a write's plan without running it when analyze is false", async () => {
    (global as any).__devtools_config = config();
    state.explainResult = jsonCell("EXPLAIN", {
      query_block: { select_id: 1, table: { table_name: "ticket", rows: 100 } },
    });

    const result = await parseToolJson(explainQueryTool, {
      query: "UPDATE ticket SET deleted_at = now()",
      analyze: false,
    });

    expect(state.calls).toEqual([
      { query: "UPDATE ticket SET deleted_at = now()", analyze: false },
    ]);
    expect(result.analyzed).toBe(false);
  });

  it("refuses a write on a connection marked readonly", async () => {
    (global as any).__devtools_config = {
      security: { allow_write: true, blocked_env: [] },
      providers: {
        database: {
          default_engine: "mariadb",
          connections: {
            dev: { dsn: "mariadb://localhost/app", readonly: true },
          },
        },
      },
    };

    await expect(
      explainQueryTool.execute({ query: "DELETE FROM ticket" }),
    ).rejects.toMatchObject({ code: "DATABASE_CONNECTION_READONLY" });
    expect(state.calls).toEqual([]);
  });
});
