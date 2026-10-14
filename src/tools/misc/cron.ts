import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import {
  CronParseError,
  dayName,
  describeCron,
  monthName,
  nextRuns,
  parseCronExpression,
  type CronField,
} from "./cron-parser.js";

/** More than this is a wall of timestamps rather than an answer. */
const MAX_COUNT = 20;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The run time as a person would write it.
 *
 * The ISO string is UTC and cannot be checked against a crontab by eye: `0 9 * * *` is
 * 09:00 *local* on every machine, and the ISO form of that is 02:00Z here and 01:00Z
 * there.
 */
const localStamp = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const asToolError = (error: unknown): ToolError => {
  if (error instanceof CronParseError) {
    return new ToolError(
      "INVALID_ARGUMENT",
      error.message,
      "Correct the expression and retry with `expression`. Do not resend the same value.",
      true,
      { parameter: "expression" },
    );
  }
  return new ToolError(
    "CRON_PARSE_FAILED",
    `The expression could not be parsed: ${(error as Error)?.message ?? String(error)}`,
    "Report this to the user; the expression itself may be valid.",
    false,
    { parameter: "expression" },
  );
};

const parseFrom = (value: unknown): Date => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return new Date();
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `"${String(value)}" is not a date this tool can read.`,
      "Pass an ISO 8601 timestamp in `from` (e.g. 2026-10-14T02:00:00Z), or omit it to start from now.",
      true,
      { parameter: "from" },
    );
  }
  return date;
};

/**
 * Each field as it was written and what it resolved to.
 *
 * The sentence above it is a summary; this is the working, and it is what makes the
 * answer checkable: `13 2 14 10 *` that reports minute `[13]` and month `[10]` is a
 * parser someone can trust with a schedule.
 */
const fieldView = (field: CronField, label?: (value: number) => string) => ({
  raw: field.raw,
  unrestricted: field.unrestricted,
  values: field.values,
  ...(label ? { names: field.values.map(label) } : {}),
});

export const cronParseTool: Tool = {
  name: "cron_parse",
  description:
    "Parse a five-field cron expression (minute hour day-of-month month day-of-week) and list when it next runs, in the machine's local time. Supports *, lists, ranges, steps, and names (jan-dec, sun-sat), and @daily-style shorthands. When both day-of-month and day-of-week are set, either may match, as cron does it.",
  params: {
    expression: {
      type: "string",
      description:
        "Cron expression (e.g., '0 9 * * *'), or a shorthand such as '@daily'",
    },
    count: {
      type: "number",
      optional: true,
      description: `Number of next runs to show (max ${MAX_COUNT})`,
      default: 5,
    },
    from: {
      type: "string",
      optional: true,
      description: "Start date (ISO string, default: now)",
    },
  },
  execute: async (params) => {
    const expression = String(params.expression ?? "").trim();
    // A count that is not a count is no count: asking for zero runs is a request nobody
    // makes, so it reads as "use the default" rather than as one timestamp.
    const requested = Number(params.count);
    const count =
      Number.isFinite(requested) && requested >= 1
        ? Math.min(Math.floor(requested), MAX_COUNT)
        : 5;
    const from = parseFrom(params.from);

    let parsed;
    let runs: Date[];
    try {
      parsed = parseCronExpression(expression);
      runs = nextRuns(parsed, from, count);
    } catch (error: any) {
      throw asToolError(error);
    }

    const result = {
      expression,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      description: describeCron(parsed),
      fields: {
        minute: fieldView(parsed.fields.minute),
        hour: fieldView(parsed.fields.hour),
        dayOfMonth: fieldView(parsed.fields.dayOfMonth),
        month: fieldView(parsed.fields.month, monthName),
        dayOfWeek: fieldView(parsed.fields.dayOfWeek, dayName),
      },
      from: from.toISOString(),
      count,
      // Both spellings: local because that is what the expression means, UTC because that
      // is what other tools will be handed.
      nextRuns: runs.map((date) => date.toISOString()),
      nextRunsLocal: runs.map(localStamp),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
