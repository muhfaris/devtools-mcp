import { afterEach, describe, expect, it } from "vitest";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import { cronParseTool } from "../../../../src/tools/misc/cron.js";
import { parseCronExpression } from "../../../../src/tools/misc/cron-parser.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

/** Local wall-clock fields of an ISO instant, which is what a crontab is written in. */
const localParts = (iso: string) => {
  const date = new Date(iso);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
};

const parse = (params: Record<string, any>) =>
  parseToolJson(cronParseTool, params);

describe("cron_parse", () => {
  it("fires when the expression says, not every minute", async () => {
    // The finding this replaces: the five fields were split apart and then unused, so
    // every expression was answered with "one minute after the last one".
    const result = await parse({
      expression: "13 2 14 10 *",
      from: "2026-01-01T00:00:00Z",
      count: 2,
    });

    expect(result.nextRunsLocal).toHaveLength(2);
    expect(localParts(result.nextRuns[0])).toEqual({
      year: 2026,
      month: 10,
      day: 14,
      hour: 2,
      minute: 13,
    });
    // Once a year: the next one is the same date a year later.
    expect(localParts(result.nextRuns[1])).toEqual({
      year: 2027,
      month: 10,
      day: 14,
      hour: 2,
      minute: 13,
    });
    // The description reads the fields it was given: month `10` is October, not the
    // eleventh name in a list.
    expect(result.description).toBe(
      "Runs at 02:13 on day 14 of the month, in October.",
    );
    expect(result.fields.month.names).toEqual(["October"]);
  });

  it("describes the expression it read", async () => {
    const result = await parse({ expression: "0 9 * * 1-5", count: 1 });

    expect(result.description).toBe(
      "Runs at 09:00 on Monday, Tuesday, Wednesday, Thursday, Friday.",
    );
    // The note admitting the parser was a placeholder is gone; the answer is the answer.
    expect(result.note).toBeUndefined();
  });

  it("says which timezone the runs are in", async () => {
    const result = await parse({ expression: "0 9 * * *", count: 1 });

    expect(result.timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(localParts(result.nextRuns[0]).hour).toBe(9);
  });

  it("expands every minute", async () => {
    const result = await parse({
      expression: "* * * * *",
      from: "2026-03-01T10:00:00Z",
      count: 3,
    });

    const stamps = result.nextRunsLocal;
    const minutes = stamps.map((stamp: string) => Number(stamp.slice(-2)));
    // Three consecutive minutes, not three unrelated ones.
    expect(minutes[1] - minutes[0]).toBe(1);
    expect(minutes[2] - minutes[1]).toBe(1);
  });

  it("honours a step, a list, and a range", async () => {
    const step = await parse({
      expression: "*/15 * * * *",
      count: 4,
      from: "2026-03-01T10:00:00Z",
    });
    expect(step.fields.minute.values).toEqual([0, 15, 30, 45]);

    const list = await parse({
      expression: "5,35 8,20 * * *",
      count: 1,
      from: "2026-03-01T00:00:00Z",
    });
    expect(list.fields.hour.values).toEqual([8, 20]);
    expect(list.fields.minute.values).toEqual([5, 35]);
    // Which of the two hours comes first depends on the machine's offset from UTC, so the
    // assertion is about the set, and the next test is about the arithmetic.
    expect([8, 20]).toContain(localParts(list.nextRuns[0]).hour);
    expect([5, 35]).toContain(localParts(list.nextRuns[0]).minute);

    const range = await parse({
      expression: "0 6-9 * 1-3 *",
      count: 4,
      from: "2026-01-01T00:00:00Z",
    });
    expect(range.fields.hour.values).toEqual([6, 7, 8, 9]);
    expect(range.fields.month.values).toEqual([1, 2, 3]);
  });

  it("reads names, and both spellings of Sunday", async () => {
    const named = await parse({
      expression: "0 9 * jan-mar mon-fri",
      count: 1,
      from: "2026-01-01T00:00:00Z",
    });
    expect(named.fields.month.values).toEqual([1, 2, 3]);
    expect(named.fields.dayOfWeek.values).toEqual([1, 2, 3, 4, 5]);

    const sunday = await parse({
      expression: "0 0 * * 7",
      count: 1,
      from: "2026-03-01T10:00:00Z",
    });
    expect(sunday.fields.dayOfWeek.values).toEqual([0]);
    expect(new Date(sunday.nextRuns[0]).getDay()).toBe(0);
  });

  it("matches either day field when both are restricted", async () => {
    // Vixie cron's one departure from "and": `0 0 1 * mon` is the first of the month *or*
    // any Monday, and a reader who assumes otherwise is wrong twice a month.
    const result = await parse({
      expression: "0 0 1 * mon",
      count: 5,
      from: "2026-06-30T00:00:00Z",
    });

    expect(localParts(result.nextRuns[0])).toMatchObject({
      day: 1,
      hour: 0,
      minute: 0,
    });
    expect(result.description).toContain("either matches");
    for (const iso of result.nextRuns) {
      const date = new Date(iso);
      expect(date.getDate() === 1 || date.getDay() === 1).toBe(true);
    }
  });

  it("understands the shorthands", async () => {
    const daily = await parse({
      expression: "@daily",
      count: 1,
      from: "2026-03-01T10:00:00Z",
    });

    expect(daily.fields.hour.values).toEqual([0]);
    expect(localParts(daily.nextRuns[0])).toMatchObject({
      hour: 0,
      minute: 0,
      day: 2,
    });
  });

  it("caps the count and never returns none", async () => {
    expect(
      (await parse({ expression: "0 0 * * *", count: 50 })).nextRuns,
    ).toHaveLength(20);
    expect(
      (await parse({ expression: "0 0 * * *", count: 0 })).nextRuns,
    ).toHaveLength(5);
    expect(
      (await parse({ expression: "0 0 * * *", count: -3 })).nextRuns,
    ).toHaveLength(5);
  });

  it("refuses an expression it cannot read, naming what is wrong", async () => {
    const cases: [string, RegExp][] = [
      ["0 9 * *", /Expected 5 fields.*got 4/],
      ["0 0 12 * * *", /Expected 5 fields.*got 6/],
      ["60 9 * * *", /60 is out of range for the minute field/],
      ["0 24 * * *", /24 is out of range for the hour field/],
      ["0 9 0 * *", /0 is out of range for the day-of-month field/],
      ["0 9 * 13 *", /13 is out of range for the month field/],
      ["0 9 * * 8", /8 is out of range for the day-of-week field/],
      ["0 9 * * abc", /"abc" is not a number or a known name/],
      ["0 9 * * 5-1", /runs backwards in the day-of-week field/],
      ["*/0 * * * *", /A step of 0 in the minute field would never advance/],
      ["0,,9 * * * *", /Missing a value in the minute field/],
      ["0 9 * * 1/2/3", /more than one step in the day-of-week field/],
    ];

    for (const [expression, message] of cases) {
      await expect(parse({ expression }), expression).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "expression",
      });
      await expect(parse({ expression }), expression).rejects.toThrow(message);
    }
  });

  it("refuses a schedule that never happens", async () => {
    // 30 February is not a date: the search would run forever if it were not bounded.
    await expect(
      parse({
        expression: "0 0 30 2 *",
        count: 1,
        from: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/No run within 5 years/);
  });

  it("refuses a start date it cannot read", async () => {
    await expect(
      parse({ expression: "0 9 * * *", from: "next tuesday" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "from" });
  });
});

describe("parseCronExpression", () => {
  it("keeps the field as written alongside what it resolved to", () => {
    const parsed = parseCronExpression("13 2 14 10 *");

    expect(parsed.fields.minute.raw).toBe("13");
    expect(parsed.fields.minute.values).toEqual([13]);
    expect(parsed.fields.minute.unrestricted).toBe(false);
    expect(parsed.fields.dayOfWeek.unrestricted).toBe(true);
    // `*` on day-of-week is every day, Sunday (0) first.
    expect(parsed.fields.dayOfWeek.values).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("reads a bare value with a step as a range", () => {
    // `10/5` is the same as `10-59/5`, not the single minute 10.
    expect(parseCronExpression("10/5 * * * *").fields.minute.values).toEqual([
      10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
  });

  it("folds a step over the whole field", () => {
    expect(parseCronExpression("0 4/6 * * *").fields.hour.values).toEqual([
      4, 10, 16, 22,
    ]);
  });

  it("normalizes whitespace between fields", () => {
    expect(
      parseCronExpression("  13   2  14  10   *  ").fields.dayOfMonth.values,
    ).toEqual([14]);
  });
});
