/**
 * A five-field cron parser, and the next times an expression fires.
 *
 * Written here rather than pulled in as a dependency for one tool, but the reason it
 * exists at all is that the tool it serves used to parse an expression by splitting it
 * into five parts and then ignoring all five: `13 2 14 10 *` was answered with "now plus
 * one minute", five times over. A parser that is not used is not a parser.
 */

export type CronFieldName =
  | "minute"
  | "hour"
  | "dayOfMonth"
  | "month"
  | "dayOfWeek";

export type CronField = {
  /** The field as written, so an answer can be checked against the input. */
  raw: string;
  /** Every value the field allows, ascending and deduplicated. */
  values: number[];
  /**
   * Whether the field was written as `*`. The two day fields need to know: with both
   * restricted, cron matches *either*, which is not the same as matching both.
   */
  unrestricted: boolean;
};

export type ParsedCronExpression = {
  fields: Record<CronFieldName, CronField>;
};

/** Thrown for anything the expression gets wrong, with the field named. */
export class CronParseError extends Error {
  constructor(
    message: string,
    readonly field?: CronFieldName,
  ) {
    super(message);
    this.name = "CronParseError";
  }
}

type FieldSpec = {
  name: CronFieldName;
  label: string;
  min: number;
  max: number;
  names?: Record<string, number>;
  /** Applied to each value after parsing; used to fold Sunday's `7` onto `0`. */
  normalize?: (value: number) => number;
};

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const nameMap = (
  names: readonly string[],
  offset = 1,
): Record<string, number> =>
  Object.fromEntries(names.map((name, index) => [name, index + offset]));

const SPECS: FieldSpec[] = [
  { name: "minute", label: "minute", min: 0, max: 59 },
  { name: "hour", label: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", label: "day-of-month", min: 1, max: 31 },
  {
    name: "month",
    label: "month",
    min: 1,
    max: 12,
    names: nameMap(MONTH_NAMES),
  },
  {
    name: "dayOfWeek",
    label: "day-of-week",
    // Cron accepts both 0 and 7 for Sunday; both fold onto 0 below.
    min: 0,
    max: 7,
    names: nameMap(DAY_NAMES, 0),
    normalize: (value) => value % 7,
  },
];

/** The shorthands cron itself understands, expanded before parsing. */
const SHORTHANDS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const parseValue = (token: string, spec: FieldSpec): number => {
  const text = token.trim().toLowerCase();
  if (text === "") {
    throw new CronParseError(
      `Missing a value in the ${spec.label} field.`,
      spec.name,
    );
  }

  const named = spec.names?.[text];
  const value = named ?? Number(text);

  if (!Number.isInteger(value)) {
    throw new CronParseError(
      `"${token}" is not a number or a known name in the ${spec.label} field.`,
      spec.name,
    );
  }
  if (value < spec.min || value > spec.max) {
    throw new CronParseError(
      `${value} is out of range for the ${spec.label} field (${spec.min}-${spec.max}).`,
      spec.name,
    );
  }
  return value;
};

/**
 * One comma-separated part: a single value, a range (`1-5`), a step over a range
 * (`1-30/5`), a bare value with a step (`10/5`), or everything with a step.
 */
const parseTerm = (term: string, spec: FieldSpec): number[] => {
  const segments = term.split("/");
  if (segments.length > 2) {
    throw new CronParseError(
      `"${term}" has more than one step in the ${spec.label} field.`,
      spec.name,
    );
  }

  const [rangePart, stepPart] = segments;
  let step = 1;
  if (stepPart !== undefined) {
    step = parseValue(stepPart, spec);
    if (step < 1) {
      throw new CronParseError(
        `A step of ${step} in the ${spec.label} field would never advance.`,
        spec.name,
      );
    }
  }

  let start: number;
  let end: number;

  if (rangePart === "*") {
    start = spec.min;
    end = spec.max;
  } else if (rangePart.includes("-")) {
    const [from, to] = rangePart.split("-");
    start = parseValue(from, spec);
    end = parseValue(to, spec);
    if (start > end) {
      throw new CronParseError(
        `The range "${rangePart}" runs backwards in the ${spec.label} field.`,
        spec.name,
      );
    }
  } else {
    start = parseValue(rangePart, spec);
    // `10/5` means "from 10 to the end of the field, every 5" — the same as `10-max/5`,
    // and not the single value `10`.
    end = stepPart === undefined ? start : spec.max;
  }

  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
};

const parseField = (raw: string, spec: FieldSpec): CronField => {
  const collected = new Set<number>();

  for (const term of raw.split(",")) {
    for (const value of parseTerm(term, spec)) {
      collected.add(spec.normalize ? spec.normalize(value) : value);
    }
  }

  return {
    raw,
    values: [...collected].sort((a, b) => a - b),
    unrestricted: raw === "*",
  };
};

/** Parse a five-field expression, or throw with the field that is wrong. */
export const parseCronExpression = (
  expression: string,
): ParsedCronExpression => {
  const trimmed = String(expression ?? "").trim();
  if (!trimmed) {
    throw new CronParseError("A cron expression is required.");
  }

  const expanded = SHORTHANDS[trimmed.toLowerCase()] ?? trimmed;
  const parts = expanded.split(/\s+/);

  if (parts.length !== 5) {
    throw new CronParseError(
      `Expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}. A 6-field expression with seconds is not supported.`,
    );
  }

  const fields = {} as Record<CronFieldName, CronField>;
  SPECS.forEach((spec, index) => {
    fields[spec.name] = parseField(parts[index], spec);
  });

  return { fields };
};

/**
 * Month and day names for a cron value, from the value rather than the array index.
 */
export const dayName = (value: number): string =>
  DAY_LABELS[value] ?? String(value);

export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Month and day names for a cron value.
 *
 * Months are 1-based — `10` is October, not the eleventh entry — and days are 0-based,
 * with Sunday at 0. Two conventions in one feature is exactly the sort of thing that ends
 * up off by one, so each one is named rather than indexed at the call site.
 */
export const monthName = (value: number): string =>
  MONTH_LABELS[value - 1] ?? String(value);

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const pad = (value: number): string => String(value).padStart(2, "0");

/** A value list as a phrase, or `all` when the field matches everything. */
const listOf = (
  values: number[],
  total: number,
  label?: (value: number) => string,
): string => {
  if (values.length === total) return "all";
  const shown = values.map((value) => label?.(value) ?? String(value));
  return shown.length === 1 ? shown[0] : shown.join(", ");
};

/**
 * A sentence describing the schedule.
 *
 * Deliberately literal: it names the fields it read, so a reader can check the sentence
 * against the expression instead of trusting a paraphrase. The previous answer carried a
 * note saying full support was "coming soon", which is the sort of thing that reads as a
 * description and is not one.
 */
export const describeCron = (parsed: ParsedCronExpression): string => {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = parsed.fields;

  const everyMinute = minute.values.length === 60 && hour.values.length === 24;
  const minutePart = everyMinute
    ? "every minute"
    : hour.values.length === 24
      ? `at minute ${listOf(minute.values, 60)} of every hour`
      : minute.values.length === 1 && hour.values.length === 1
        ? `at ${pad(hour.values[0])}:${pad(minute.values[0])}`
        : minute.values.length === 1
          ? `at minute ${minute.values[0]} of hours ${hour.values.join(", ")}`
          : `at minutes ${minute.values.join(", ")} of hours ${hour.values.join(", ")}`;

  const domPart = dayOfMonth.unrestricted
    ? null
    : `on day ${listOf(dayOfMonth.values, 31)} of the month`;
  const dowPart = dayOfWeek.unrestricted
    ? null
    : `on ${listOf(dayOfWeek.values, 7, dayName)}`;

  const dayPart = !domPart
    ? (dowPart ?? "every day")
    : !dowPart
      ? domPart
      : // Both restricted: cron matches either, which is worth spelling out because
        // "day 1 and Monday" is what the two clauses look like they mean.
        `${domPart} or ${dowPart} (either matches)`;

  const monthPart = month.unrestricted
    ? ""
    : `, in ${listOf(month.values, 12, monthName)}`;

  return `Runs ${minutePart} ${dayPart}${monthPart}.`;
};

/**
 * Whether a date's day matches the expression.
 *
 * With both day fields restricted, cron matches **either** — the one rule in cron that is
 * not a conjunction, and the one a reader is most likely to get wrong.
 */
const dayMatches = (parsed: ParsedCronExpression, date: Date): boolean => {
  const { dayOfMonth, dayOfWeek } = parsed.fields;
  const domMatches = dayOfMonth.values.includes(date.getDate());
  const dowMatches = dayOfWeek.values.includes(date.getDay());

  if (!dayOfMonth.unrestricted && !dayOfWeek.unrestricted) {
    return domMatches || dowMatches;
  }
  if (!dayOfMonth.unrestricted) return domMatches;
  if (!dayOfWeek.unrestricted) return dowMatches;
  return true;
};

/** How far ahead a search will look before giving up on a schedule. */
const SEARCH_YEARS = 5;

/**
 * The next `count` times the expression fires at or after `from`, in **local** time —
 * cron has no timezone of its own, and every crontab on a machine is written in the
 * machine's.
 *
 * Walks the calendar rather than the clock: a year of minutes is half a million checks
 * for an expression like `0 0 29 2 *`, so a matching day is sought first and the hour and
 * minute lists are only consulted once one is found.
 *
 * A time that does not exist (the hour a DST shift skips) is passed over instead of being
 * invented, which is what cron does with it.
 */
export const nextRuns = (
  parsed: ParsedCronExpression,
  from: Date,
  count: number,
): Date[] => {
  const runs: Date[] = [];
  const cursor = new Date(from.getTime());
  // Cron fires strictly *after* the reference time: asking "what runs at 02:13" at
  // 02:13 returns tomorrow, not now.
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const deadline = new Date(from.getTime());
  deadline.setFullYear(deadline.getFullYear() + SEARCH_YEARS);

  while (runs.length < count) {
    if (cursor.getTime() > deadline.getTime()) {
      throw new CronParseError(
        `No run within ${SEARCH_YEARS} years of ${from.toISOString()}. Check the day-of-month and month fields against each other.`,
      );
    }

    // Month: skip forward a month at a time rather than a day at a time.
    if (!parsed.fields.month.values.includes(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    if (!dayMatches(parsed, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    if (!parsed.fields.hour.values.includes(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!parsed.fields.minute.values.includes(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }

    runs.push(new Date(cursor.getTime()));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return runs;
};
