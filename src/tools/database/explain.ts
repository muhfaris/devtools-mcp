import { Tool } from "../../core/types.js";
import { createProvider } from "../../providers/index.js";
import { getProviderConfig } from "../../core/provider-config.js";
import {
  isProviderEnabled,
  resolveConnectionWrite,
} from "../../core/security.js";
import {
  databaseRequestError,
  databaseWriteRefused,
  requireDatabaseConnection,
  requireQuery,
} from "./errors.js";
import { classifyStatement } from "./statement.js";

export const explainQueryTool: Tool = {
  name: "explain_query",
  description:
    "Run EXPLAIN on a query and summarize the plan. With analyze: true (the default) the statement is executed for real timings — MariaDB's r_rows/r_total_time_ms, PostgreSQL's actual rows and time, or MySQL's EXPLAIN ANALYZE tree — and a non-read statement is therefore sent through the same write gate as execute_query.",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection",
    },
    query: {
      type: "string",
      description: "SQL query to explain (SELECT, INSERT, UPDATE, DELETE)",
    },
    analyze: {
      type: "boolean",
      optional: true,
      description:
        "Run ANALYZE for actual execution stats (default: true). The statement really runs, so a non-read one needs the write grant",
      default: true,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    if (!isProviderEnabled(config, "database")) {
      throw new Error(
        "Database provider is disabled in configuration. Enable providers.database.enabled in .devtools/config.yaml.",
      );
    }
    const { connectionName, connection: connConfig } =
      requireDatabaseConnection(config, params.connection);

    const query = requireQuery(params.query);

    // `EXPLAIN ANALYZE` *runs* the statement, so on a write it is a write — the one place
    // where reading a plan and changing data are the same operation. It goes through the
    // write gate for that reason, and not merely to keep the gate's story tidy.
    const analyze = params.analyze !== false;
    if (analyze && classifyStatement(query) === "write") {
      const policy = resolveConnectionWrite(
        config,
        "database",
        connectionName,
        connConfig.readonly,
      );
      if (!policy.can_write) throw databaseWriteRefused(policy, connectionName);
    }

    const provider = createProvider(
      getProviderConfig(config, "database")?.default_engine ?? "postgresql",
    );

    try {
      await provider.connect(connConfig);
      const explainResult = await provider.explainQuery(query, analyze);
      // Which server answered, not which one the config named. Reading a MariaDB plan as
      // MySQL printed `unknown` for every field, because the two disagree about what a
      // plan is.
      const engine = provider.getEngine();
      await provider.disconnect();

      const formatted = summarize(engine, explainResult, analyze);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { connection: connectionName, query, ...formatted },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      await provider.disconnect().catch(() => {});
      throw databaseRequestError("explain the query", error);
    }
  },
};

type PlanFormat = "json" | "tree";

type PlanTable = {
  table: string;
  access_type?: string;
  rows?: unknown;
  actual_rows?: unknown;
  /**
   * How many times the server descended into this table — MariaDB's `r_loops`.
   *
   * An `eq_ref` table reads one row per loop, so `actual_rows=1` beside a 24-second
   * `table_time` reads as a table that took 24 seconds to produce a single row. The
   * number that explains it is the probe count: that time is 54084 separate reads.
   */
  loops?: number;
  /**
   * Time spent in this table, in ms.
   *
   * MariaDB reports it as `r_table_time_ms` on the table node while the *block* it sits
   * in carries `r_total_time_ms` — reading the block's field here left every table with
   * no time at all, and the reader was shown `time=unknownms` next to a plan that plainly
   * said how long it took.
   */
  table_time_ms?: number;
  /** The part of that time that was not the read: filtering, sorting, joining. */
  other_time_ms?: number;
  /**
   * Pages the storage engine had to read, and how long that took.
   *
   * MariaDB keeps these in `r_engine_stats` *inside* the table node, not beside
   * `r_table_time_ms`; both spellings are read.
   */
  pages_read_count?: number;
  pages_read_time_ms?: number;
  key?: unknown;
  /** The condition applied to rows from this table, when the server sent one. */
  filter?: unknown;
  /**
   * The share of rows that survived the filter, as a percentage — `r_filtered` for the
   * measured one under ANALYZE, falling back to the `filtered` estimate.
   *
   * This was folded into `filter`, so a table carrying no condition at all printed
   * `filter=100`: a percentage wearing the label of a predicate. A number and a
   * condition are different kinds of thing and are now printed as different things.
   */
  filtered?: number;
};

/** A number, or `undefined` — the plan may carry a string, or nothing at all. */
const asNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const engineLabel = (engine: string): string =>
  engine === "postgresql"
    ? "PostgreSQL"
    : engine === "mariadb"
      ? "MariaDB"
      : "MySQL";

/**
 * The JSON document MySQL and MariaDB hand back for `FORMAT=JSON` sits inside a single
 * cell whose column name differs between the two, so it is recognised by shape rather
 * than by name: one row, one string, and the string is an object.
 */
const unwrapExplainJson = (result: any): any => {
  const rows = Array.isArray(result) ? result : [result];
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object")
    return result;

  const values = Object.values(rows[0]);
  if (values.length !== 1 || typeof values[0] !== "string") return result;

  const text = (values[0] as string).trim();
  if (!text.startsWith("{")) return result;
  try {
    return JSON.parse(text);
  } catch {
    return result;
  }
};

/** One rendered line of the plan, and how far it is indented. */
type PlanLine = {
  depth: number;
  /** The node's own name: a table, a `<derivedN>`, or `filesort`. */
  label: string;
  /** `key=value` fragments, in the order they are printed. */
  parts: string[];
  /**
   * The table this line reads, when it reads one.
   *
   * The totals are summed over these and only these. A `filesort` line reports a sort
   * rather than a scan, and counting it would put a second figure into "time in table
   * reads" for time the block total already accounts for.
   */
  table?: PlanTable;
};

/** What the enclosing blocks have said about where a table sits. */
type WalkContext = {
  /** `select_id` of the nearest enclosing `query_block`. */
  selectId?: unknown;
  /** The `operation` that block declared — `UNION`, when the server said so. */
  operation?: unknown;
  /** The `<derivedN>` this scan was reached through, inside a `materialized`. */
  materializedInto?: string;
};

type WalkOptions = {
  /** Whether the statement was run: the actuals are shown only when it was. */
  analyze: boolean;
  /** Whether a table's line names its block — worth doing only when there is more than one. */
  annotate: boolean;
};

/**
 * Every `select_id` the document declares.
 *
 * Read before the walk rather than during it, because whether a label names its block is a
 * property of the plan as a whole. A one-block plan has nothing to disambiguate, and
 * `t [select#1]` on every line is noise a reader learns to skip — the annotation has to
 * stay rare enough to still mean something when two tables really do share a name.
 */
const declaredSelectIds = (
  node: unknown,
  found = new Set<unknown>(),
  seen = new Set<unknown>(),
): Set<unknown> => {
  if (!node || typeof node !== "object" || seen.has(node)) return found;
  seen.add(node);
  const record = node as Record<string, any>;
  if (record.select_id !== undefined) found.add(record.select_id);
  for (const value of Object.values(record))
    declaredSelectIds(value, found, seen);
  return found;
};

/**
 * `t [select#2, materialized into <derived2>]` — every marker taken from the document.
 *
 * Nothing here is inferred from nesting. `select_id` and `operation` are the server's own
 * fields, and `materialized into` is the name of the table the scan was reached through —
 * a reader is told `select#3 UNION` because MariaDB said `"operation": "UNION"`, and is
 * never told "union" because a table happened to sit under a `union_result`.
 */
const tableLabel = (
  name: string,
  context: WalkContext,
  annotate: boolean,
): string => {
  if (!annotate) return name;
  const marks = [
    context.selectId === undefined
      ? undefined
      : `select#${context.selectId}${
          typeof context.operation === "string" ? ` ${context.operation}` : ""
        }`,
    context.materializedInto === undefined
      ? undefined
      : `materialized into ${context.materializedInto}`,
  ].filter((mark): mark is string => mark !== undefined);
  return marks.length === 0 ? name : `${name} [${marks.join(", ")}]`;
};

/** The measured facts about a table, in the order they are printed. */
const tableParts = (table: PlanTable, analyze: boolean): string[] => [
  `access=${table.access_type ?? "unknown"}`,
  ...(table.rows === undefined ? [] : [`rows=${table.rows}`]),
  ...(analyze && table.actual_rows !== undefined
    ? [`actual_rows=${table.actual_rows}`]
    : []),
  ...(analyze && table.loops !== undefined ? [`loops=${table.loops}`] : []),
  ...(analyze && table.table_time_ms !== undefined
    ? [`table_time=${ms(table.table_time_ms)}`]
    : []),
  ...(analyze && table.other_time_ms !== undefined
    ? [`other_time=${ms(table.other_time_ms)}`]
    : []),
  ...(analyze && table.pages_read_count !== undefined
    ? [`pages_read=${table.pages_read_count}`]
    : []),
  ...(analyze && table.pages_read_time_ms !== undefined
    ? [`pages_time=${ms(table.pages_read_time_ms)}`]
    : []),
  ...(table.key ? [`key=${table.key}`] : []),
  ...(table.filter ? [`filter=${table.filter}`] : []),
  // Marked as a percentage, because that is what it is: `filter=100` read as a predicate on
  // a table that had no predicate to report.
  ...(table.filtered === undefined ? [] : [`filtered=${pct(table.filtered)}`]),
];

/** The sort's own line: not a table, and the numbers that say what sorting cost. */
const filesortLine = (
  filesort: Record<string, any>,
  depth: number,
): PlanLine => {
  const parts: string[] = [];
  if (filesort.sort_key) parts.push(`sort_key=${filesort.sort_key}`);
  // The server sends a boolean where a name would read better: `priority queue` is what
  // MariaDB calls the thing it selected, and `r_used_priority_queue=true` makes the reader
  // decode a field name to learn which of the two sorts ran.
  if (filesort.r_used_priority_queue === true) parts.push("priority queue");
  else if (filesort.r_used_priority_queue === false)
    parts.push("filesort buffer");
  if (filesort.r_sort_mode !== undefined)
    parts.push(`sort_mode=${filesort.r_sort_mode}`);
  if (filesort.r_limit !== undefined) parts.push(`limit=${filesort.r_limit}`);
  if (filesort.r_output_rows !== undefined)
    parts.push(`out_rows=${filesort.r_output_rows}`);
  const time = asNumber(filesort.r_total_time_ms);
  if (time !== undefined) parts.push(`time=${ms(time)}`);
  return { depth, label: "filesort", parts };
};

/** The name a materialised union's result set carries, if this table wraps one. */
const materializedUnionName = (innerBlock: any): string | undefined => {
  const name = innerBlock?.union_result?.table_name;
  return typeof name === "string" ? name : undefined;
};

/**
 * Every line of the plan, in document order, each knowing how deep it sits.
 *
 * Depth is what makes the shape readable: a `filesort`'s temporary table and a
 * materialised derived table both hold scans of their own, and a flat list of tables
 * presents "reading the derived result" and "building it" as two unrelated rows. Children
 * are indented under the line that produced them instead.
 */
const collectPlanLines = (plan: any, analyze: boolean): PlanLine[] => {
  const out: PlanLine[] = [];
  const options: WalkOptions = {
    analyze,
    annotate: declaredSelectIds(plan).size > 1,
  };

  const walk = (
    node: unknown,
    depth: number,
    context: WalkContext,
    seen: Set<unknown>,
  ): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth, context, seen);
      return;
    }
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    const record = node as Record<string, any>;

    // A block names itself, and everything beneath it inherits that name.
    const own: WalkContext =
      record.select_id === undefined
        ? context
        : {
            ...context,
            selectId: record.select_id,
            operation: record.operation,
          };

    // A sort is a step, not a table: its own line, with the rows it sorted beneath it.
    const filesort = record.filesort;
    if (filesort && typeof filesort === "object") {
      out.push(filesortLine(filesort, depth));
      walk(filesort.temporary_table, depth + 1, own, seen);
    }

    // `union_result` carries a `table_name` too, but nobody scans it: it names the set a
    // union produced, and that name belongs on the derived table's line rather than on a
    // line of its own. Reading it as a table is how `<union2,3>` came to be reported as a
    // scan that no statement performs.
    const holdsBranches = record.query_specifications !== undefined;
    const name = record.table_name ?? record.table;

    if (typeof name === "string" && !holdsBranches) {
      // MariaDB nests the storage-engine counters one level down, inside `r_engine_stats`,
      // rather than beside `r_table_time_ms`. Reading only the node's own fields found no
      // pages at all, so a scan that spent 96% of its time on disk was summarized without
      // mentioning it. Both spellings are read, because some versions lift them.
      const engineStats: Record<string, any> = record.r_engine_stats ?? {};
      const table: PlanTable = {
        table: name,
        access_type: record.access_type ?? undefined,
        rows:
          record.rows_examined_per_scan ??
          record.rows ??
          record.row_estimate ??
          undefined,
        actual_rows: record.r_rows ?? undefined,
        loops: asNumber(record.r_loops),
        table_time_ms: asNumber(
          record.r_table_time_ms ?? record.r_total_time_ms,
        ),
        other_time_ms: asNumber(record.r_other_time_ms),
        pages_read_count: asNumber(
          record.pages_read_count ??
            record.r_pages_read_count ??
            engineStats.pages_read_count,
        ),
        pages_read_time_ms: asNumber(
          record.pages_read_time_ms ??
            record.r_pages_read_time_ms ??
            engineStats.pages_read_time_ms,
        ),
        key: record.key ?? undefined,
        // Only a condition is a filter. `filtered` is a percentage and used to be read
        // here as a fallback, which is how `filter=100` came to be printed for a table
        // that had no condition to show.
        filter: record.attached_condition ?? undefined,
        filtered: asNumber(record.r_filtered ?? record.filtered),
      };

      const innerBlock = record.materialized?.query_block;
      const unionName = materializedUnionName(innerBlock);

      out.push({
        depth,
        // A derived table's name is unique, so its line takes no block marker: the marker
        // exists to tell two scans of same-named tables apart, and `<derived2>` has
        // nothing to be told apart from.
        label: tableLabel(
          name,
          own,
          options.annotate && unionName === undefined,
        ),
        parts: [
          ...(unionName === undefined
            ? []
            : [`materialized UNION ${unionName}`]),
          ...tableParts(table, options.analyze),
        ],
        table,
      });

      // The scans that fill a materialised table belong beneath its line: reading the
      // derived result and building it are different phases, and flattening them makes the
      // inner time read as the outer time.
      if (innerBlock !== undefined) {
        walk(innerBlock, depth + 1, { ...own, materializedInto: name }, seen);
      }
    }

    for (const [key, value] of Object.entries(record)) {
      // Both are handled above, with the depth and the context they need.
      if (key === "filesort" || key === "materialized") continue;
      walk(value, depth, own, seen);
    }
  };

  walk(plan, 0, {}, new Set());
  return out;
};

/** Milliseconds, with the trailing zeros a reader does not need. */
const ms = (value: number): string => `${Number(value.toFixed(3))}ms`;

/** Two spaces per level of nesting, so a child line reads as belonging to its parent. */
const indent = (depth: number): string => "  ".repeat(depth);

/**
 * A percentage, to two places.
 *
 * The server sends `1.708453517`, which is a float rather than a measurement to nine
 * places; printing it whole claims a precision the estimate does not carry.
 */
const pct = (value: number): string => `${Number(value.toFixed(2))}%`;

/** Sum of the values that are present, or `undefined` when none of them are. */
const sumOf = (values: (number | undefined)[]): number | undefined => {
  const present = values.filter(
    (value): value is number => value !== undefined,
  );
  return present.length === 0
    ? undefined
    : present.reduce((total, value) => total + value, 0);
};

/** A block total, and the JSON path it was read from. */
type BlockTotal = { ms: number; path: string };

/**
 * The outermost block-level `r_total_time_ms` within `node`, and the path it was found on.
 *
 * MariaDB reports it on the block a set of tables belongs to (`query_block`, and again on
 * `nested_loop` for a nested one), never on the tables themselves. Searching for the
 * first one that is *not* a table node finds it wherever the version put it — and refuses
 * to fall back to a table's own time, because presenting one table's 5164ms as the
 * query's total is the mistake this is here to avoid.
 *
 * `node` must be the *block*, not the whole document. MariaDB emits `query_optimization`
 * ahead of `query_block`, and its `r_total_time_ms` is the optimizer choosing a plan —
 * 0.105ms against a statement that then ran for 6952ms. Walking the whole document found
 * that one first and returned it as the query's total, so the summary claimed 0.1ms
 * beside 6.9s of table reads: a report that reads as "fast" about a query that was not.
 *
 * The path comes back with the number so the summary can *say* which field it read
 * instead of asserting a provenance it may not have.
 */
const blockTotal = (
  node: unknown,
  path: string[] = [],
  seen = new Set<unknown>(),
): BlockTotal | undefined => {
  if (!node || typeof node !== "object" || seen.has(node)) return undefined;
  seen.add(node);

  const record = node as Record<string, any>;
  if (record.table_name === undefined) {
    const own = asNumber(record.r_total_time_ms);
    if (own !== undefined) {
      return { ms: own, path: [...path, "r_total_time_ms"].join(".") };
    }
  }

  for (const key of Object.keys(record)) {
    // An array earns its position, not its index: `nested_loop.0.r_total_time_ms` names a
    // slot the reader has no use for.
    const next = Array.isArray(record) ? path : [...path, key];
    const found = blockTotal(record[key], next, seen);
    if (found !== undefined) return found;
  }
  return undefined;
};

const mySqlJsonSummary = (
  label: string,
  plan: any,
  planLines: PlanLine[],
  analyze: boolean,
): string => {
  // The document's own block: MariaDB and MySQL wrap it in `query_block`, and anything
  // else that arrives is treated as the block itself rather than as an empty one, which
  // would report `select_id: unknown` for a plan that states it.
  //
  // The key is kept as well as the value, so the total can be reported with the path it
  // was actually read from rather than with the one this code assumes it read.
  const blockKey =
    plan.query_block !== undefined
      ? "query_block"
      : plan.query_plan !== undefined
        ? "query_plan"
        : undefined;
  const block = blockKey ? plan[blockKey] : plan;
  // Three times, not one. The block's total is the statement's own runtime; the sum of
  // the table reads is the part of that spent inside the scans; and the optimizer's is
  // the cost of choosing a plan, before any of it ran. Reported under one label, a reader
  // distrusts whichever came first — which is what the optimizer's 0.105ms did when it
  // was printed as the total of a 6952ms query.
  //
  // The search is scoped to the block for that reason. It used to walk the whole
  // document, where `query_optimization` sits ahead of `query_block` and was found first.
  const total = blockTotal(block, blockKey ? [blockKey] : []);
  const optimizerMs = asNumber(plan.query_optimization?.r_total_time_ms);
  // Summed over the lines that read a table, and only those. A `filesort` line reports a
  // sort rather than a scan, and the `<union2,3>` wrapper is not scanned at all — neither
  // contributes a figure that the block total does not already account for.
  const tables = planLines.flatMap((line) => (line.table ? [line.table] : []));
  const tableMs = sumOf(tables.map((table) => table.table_time_ms));
  const pages = sumOf(tables.map((table) => table.pages_read_count));
  const pagesMs = sumOf(tables.map((table) => table.pages_read_time_ms));

  const lines = [
    `${label} Execution Plan (${analyze ? "ANALYZE" : "EXPLAIN"}, FORMAT=JSON):`,
    `- select_id: ${block.select_id ?? "unknown"}`,
    `- tables read: ${tables.length}`,
  ];

  if (analyze) {
    // Each figure appears only when the server sent it. `time=unknownms` reads like a
    // measurement of zero, and `0.000ms` reads like a plan that cost nothing — which is
    // how a 5.1-second scan came to be summarized as instant.
    if (total !== undefined) {
      lines.push(`- execution time: ${ms(total.ms)} (${total.path})`);
    }
    if (tableMs !== undefined) {
      lines.push(`- time in table reads: ${ms(tableMs)}`);
    }
    // Named as the optimizer's, because it is not the query's: read as execution time, an
    // agent concludes a slow query is fast — the inverse of the mistake above.
    if (optimizerMs !== undefined) {
      lines.push(`- plan build time (optimizer): ${ms(optimizerMs)}`);
    }
    if (pages !== undefined) {
      lines.push(
        `- pages read: ${pages}${pagesMs === undefined ? "" : `, ${ms(pagesMs)}`}`,
      );
    }
    // Says so rather than printing nothing: an ANALYZE that produced estimates means the
    // server did not run the statement, which the reader needs to know before trusting it.
    if (
      tables.length > 0 &&
      tables.every((table) => table.actual_rows === undefined)
    ) {
      lines.push(
        "- note: this plan carries no actual rows, so it is estimates only",
      );
    }
    // A reading of the numbers, not a verdict: time that went into reading pages points
    // at a cold cache or a large scan, and says nothing about the query's shape.
    if (
      pagesMs !== undefined &&
      tableMs !== undefined &&
      tableMs > 0 &&
      pagesMs >= tableMs / 2
    ) {
      lines.push(
        `- note: ${ms(pagesMs)} of the ${ms(tableMs)} in table reads went to reading pages — a cold cache or a large scan rather than a slow filter`,
      );
    }
  }

  for (const line of planLines) {
    const parts = line.parts.length === 0 ? "" : `: ${line.parts.join(" ")}`;
    lines.push(`${indent(line.depth)}- ${line.label}${parts}`);
  }

  if (planLines.length === 0) lines.push("- no table access in this plan");
  return lines.join("\n");
};

/**
 * MySQL answers `EXPLAIN ANALYZE` with a text tree, not a document. Quoting it is more
 * useful than a paraphrase would be, so it is returned as the summary with the label
 * that says what it is.
 */
const treeSummary = (label: string, result: any): string => {
  const rows = Array.isArray(result) ? result : [result];
  const text = rows
    .map((row) =>
      typeof row === "string" ? row : String(Object.values(row ?? {})[0] ?? ""),
    )
    .join("\n")
    .trim();

  return `${label} Execution Plan (EXPLAIN ANALYZE, tree):\n${
    text || "no plan returned"
  }`;
};

const postgresSummary = (plan: any, analyze: boolean): string => {
  if (!plan) return "No plan available";
  const node = plan["Plan"] || plan;
  const lines = [
    `PostgreSQL Execution Plan (${analyze ? "ANALYZE" : "EXPLAIN"}):`,
    `- Node Type: ${node["Node Type"] ?? "unknown"}`,
    `- Total Cost: ${node["Total Cost"] ?? "unknown"}`,
    `- Estimated Rows: ${node["Plan Rows"] ?? "unknown"}`,
    `- Width: ${node["Plan Width"] ?? "unknown"} bytes`,
  ];

  // Only ANALYZE reports what happened. Printing `unknown` for an estimate-only plan
  // reads as a plan that ran and produced nothing, which is a different statement.
  if (analyze) {
    lines.push(
      `- Actual Rows: ${node["Actual Rows"] ?? "unknown"}`,
      `- Actual Time: ${node["Actual Total Time"] ?? "unknown"}ms`,
      `- Loops: ${node["Actual Loops"] ?? "unknown"}`,
    );
  }

  for (const [label, key] of [
    ["Join Type", "Join Type"],
    ["Relation", "Relation Name"],
    ["Index", "Index Name"],
    ["Filter", "Filter"],
  ] as const) {
    if (node[key]) lines.push(`- ${label}: ${node[key]}`);
  }

  return lines.join("\n");
};

/** Turn whatever the server answered into a plan, a label, and a summary worth reading. */
const summarize = (engine: string, raw: any, analyze: boolean) => {
  if (engine === "postgresql") {
    const plan = Array.isArray(raw) ? raw[0] : raw;
    return {
      engine,
      analyzed: analyze,
      format: "json" as PlanFormat,
      plan,
      summary: postgresSummary(plan, analyze),
    };
  }

  const label = engineLabel(engine);
  const plan = unwrapExplainJson(raw);

  if (
    plan &&
    typeof plan === "object" &&
    !Array.isArray(plan) &&
    "query_block" in plan
  ) {
    return {
      engine,
      analyzed: analyze,
      format: "json" as PlanFormat,
      plan,
      summary: mySqlJsonSummary(
        label,
        plan,
        collectPlanLines(plan, analyze),
        analyze,
      ),
    };
  }

  return {
    engine,
    analyzed: analyze,
    format: "tree" as PlanFormat,
    plan: raw,
    summary: treeSummary(label, raw),
  };
};
