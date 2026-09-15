import { faker } from "@faker-js/faker";
import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";

export const SUPPORTED_HOLIDAY_COUNTRIES = ["ID", "MY", "SG", "US"] as const;
export type SupportedHolidayCountry = (typeof SUPPORTED_HOLIDAY_COUNTRIES)[number];

const MAX_YEAR_RANGE = 5;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface HolidayRecord {
  date: string;
  name: string;
  local_name: string;
  country_code: string;
  types: string[];
  verified: boolean;
  source: "nager_date" | "synthetic";
}

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
}

export const publicHolidaysTool: Tool = {
  name: "public_holidays",
  description:
    "Retrieve verified public holidays (via Nager.Date) or generate deterministic synthetic holiday test data for ID, MY, SG, and US.",
  params: {
    country_code: {
      type: "string",
      optional: false,
      description: `ISO 3166-1 alpha-2 country code: ${SUPPORTED_HOLIDAY_COUNTRIES.join(", ")} (case-insensitive).`,
    },
    start_date: {
      type: "string",
      optional: true,
      description: "Start date in ISO format YYYY-MM-DD (defaults to Jan 1 of the current year).",
    },
    end_date: {
      type: "string",
      optional: true,
      description: "End date in ISO format YYYY-MM-DD (defaults to Dec 31 of the current year).",
    },
    mode: {
      type: "string",
      optional: true,
      description: 'Execution mode: "real" (fetches verified holidays) or "synthetic" (deterministic offline generator). Default: "real".',
      default: "real",
    },
    seed: {
      type: "number",
      optional: true,
      description: "Random seed for reproducible output in synthetic mode.",
    },
  },
  execute: async (params) => {
    const countryCode = validateCountryCode(params.country_code);
    const mode = validateMode(params.mode);
    const currentYear = new Date().getUTCFullYear();
    const startDate = params.start_date
      ? validateDateFormat(String(params.start_date), "start_date")
      : `${currentYear}-01-01`;
    const endDate = params.end_date
      ? validateDateFormat(String(params.end_date), "end_date")
      : `${currentYear}-12-31`;

    validateDateRange(startDate, endDate);

    const startYear = parseInt(startDate.slice(0, 4), 10);
    const endYear = parseInt(endDate.slice(0, 4), 10);

    let holidays: HolidayRecord[] = [];

    if (mode === "real") {
      holidays = await fetchRealHolidays(countryCode, startYear, endYear);
    } else {
      if (params.seed !== undefined) {
        faker.seed(Number(params.seed));
      }
      holidays = generateSyntheticHolidays(countryCode, startYear, endYear, params.seed !== undefined ? Number(params.seed) : undefined);
    }

    // Filter strictly within the inclusive date range
    const filtered = holidays
      .filter((h) => h.date >= startDate && h.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Deduplicate by date + name
    const seen = new Set<string>();
    const deduplicated: HolidayRecord[] = [];
    for (const h of filtered) {
      const key = `${h.date}_${h.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(h);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: deduplicated.length,
              mode,
              country_code: countryCode,
              start_date: startDate,
              end_date: endDate,
              data: deduplicated,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

function validateCountryCode(raw: unknown): SupportedHolidayCountry {
  if (!raw || typeof raw !== "string") {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "A country_code is required.",
      `Provide one of: ${SUPPORTED_HOLIDAY_COUNTRIES.join(", ")}.`,
      true,
      { parameter: "country_code", availableValues: [...SUPPORTED_HOLIDAY_COUNTRIES] },
    );
  }

  const normalized = raw.trim().toUpperCase();
  if (!SUPPORTED_HOLIDAY_COUNTRIES.includes(normalized as SupportedHolidayCountry)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Unsupported country code: "${raw}".`,
      `Supported country codes are: ${SUPPORTED_HOLIDAY_COUNTRIES.join(", ")}.`,
      true,
      { parameter: "country_code", availableValues: [...SUPPORTED_HOLIDAY_COUNTRIES] },
    );
  }

  return normalized as SupportedHolidayCountry;
}

function validateMode(raw: unknown): "real" | "synthetic" {
  if (raw === undefined || raw === null) {
    return "real";
  }
  const mode = String(raw).trim().toLowerCase();
  if (mode !== "real" && mode !== "synthetic") {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Invalid mode: "${raw}".`,
      'Mode must be either "real" or "synthetic".',
      true,
      { parameter: "mode", availableValues: ["real", "synthetic"] },
    );
  }
  return mode;
}

function validateDateFormat(value: string, paramName: string): string {
  const trimmed = value.trim();
  if (!DATE_REGEX.test(trimmed)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Invalid date format for ${paramName}: "${value}".`,
      "Date must be in YYYY-MM-DD format (e.g. 2026-01-01).",
      true,
      { parameter: paramName },
    );
  }

  const [year, month, day] = trimmed.split("-").map((s) => parseInt(s, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Invalid calendar date for ${paramName}: "${value}".`,
      "Provide a valid calendar date in YYYY-MM-DD format.",
      true,
      { parameter: paramName },
    );
  }

  return trimmed;
}

function validateDateRange(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Invalid date range: start_date must be before or equal to end_date.",
      `Received start_date: "${startDate}", end_date: "${endDate}".`,
      true,
      { parameter: "start_date" },
    );
  }

  const startYear = parseInt(startDate.slice(0, 4), 10);
  const endYear = parseInt(endDate.slice(0, 4), 10);
  if (endYear - startYear > MAX_YEAR_RANGE) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Date range spans ${endYear - startYear + 1} years, exceeding the maximum allowed ${MAX_YEAR_RANGE} years.`,
      `Shorten the interval between start_date and end_date.`,
      true,
      { parameter: "end_date" },
    );
  }
}

async function fetchRealHolidays(
  countryCode: SupportedHolidayCountry,
  startYear: number,
  endYear: number,
): Promise<HolidayRecord[]> {
  const results: HolidayRecord[] = [];

  for (let year = startYear; year <= endYear; year++) {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err: any) {
      throw new ToolError(
        "UPSTREAM_ERROR",
        `Failed to reach Nager.Date API: ${err?.message || "Network error"}.`,
        'Verify internet connectivity or run with mode: "synthetic" for offline test data.',
        true,
        { cause: err },
      );
    }

    if (!response.ok) {
      if (response.status === 404) {
        continue;
      }
      throw new ToolError(
        "UPSTREAM_ERROR",
        `Nager.Date API returned HTTP ${response.status} for ${countryCode} in ${year}.`,
        'Check country code and year or use mode: "synthetic".',
        true,
      );
    }

    const data = (await response.json()) as NagerHoliday[];
    for (const item of data) {
      results.push({
        date: item.date,
        name: item.name,
        local_name: item.localName || item.name,
        country_code: countryCode,
        types: Array.isArray(item.types) && item.types.length > 0 ? item.types : ["Public"],
        verified: true,
        source: "nager_date",
      });
    }
  }

  return results;
}

function generateSyntheticHolidays(
  countryCode: SupportedHolidayCountry,
  startYear: number,
  endYear: number,
  seed?: number,
): HolidayRecord[] {
  const records: HolidayRecord[] = [];

  for (let year = startYear; year <= endYear; year++) {
    const yearHolidays = getBaseHolidaysForYear(countryCode, year, seed);
    for (const h of yearHolidays) {
      records.push({
        date: h.date,
        name: h.name,
        local_name: h.local_name,
        country_code: countryCode,
        types: ["Public"],
        verified: false,
        source: "synthetic",
      });
    }
  }

  return records;
}

interface BaseHoliday {
  date: string;
  name: string;
  local_name: string;
}

function getBaseHolidaysForYear(
  countryCode: SupportedHolidayCountry,
  year: number,
  seed?: number,
): BaseHoliday[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = year;

  switch (countryCode) {
    case "ID": {
      // Deterministic synthetic holidays for Indonesia
      const fixed: BaseHoliday[] = [
        { date: `${y}-01-01`, name: "New Year's Day", local_name: "Tahun Baru Masehi" },
        { date: `${y}-05-01`, name: "Labour Day", local_name: "Hari Buruh Internasional" },
        { date: `${y}-06-01`, name: "Pancasila Day", local_name: "Hari Lahir Pancasila" },
        { date: `${y}-08-17`, name: "Independence Day", local_name: "Hari Kemerdekaan Republik Indonesia" },
        { date: `${y}-12-25`, name: "Christmas Day", local_name: "Hari Raya Natal" },
      ];
      // Deterministic synthetic movable feasts based on year/seed offset
      const offset = (seed !== undefined ? Math.abs(seed) : 0) % 5;
      fixed.push({
        date: `${y}-03-${pad(20 + offset)}`,
        name: "Nyepi (Balinese New Year)",
        local_name: "Hari Suci Nyepi (Tahun Baru Saka)",
      });
      fixed.push({
        date: `${y}-04-${pad(10 + offset)}`,
        name: "Eid al-Fitr",
        local_name: "Hari Raya Idul Fitri",
      });
      fixed.push({
        date: `${y}-05-${pad(15 + offset)}`,
        name: "Waisak Day",
        local_name: "Hari Raya Waisak",
      });
      return fixed;
    }
    case "MY": {
      const fixed: BaseHoliday[] = [
        { date: `${y}-01-01`, name: "New Year's Day", local_name: "Tahun Baru Masehi" },
        { date: `${y}-02-01`, name: "Federal Territory Day", local_name: "Hari Wilayah Persekutuan" },
        { date: `${y}-05-01`, name: "Labour Day", local_name: "Hari Pekerja" },
        { date: `${y}-08-31`, name: "National Day", local_name: "Hari Kebangsaan" },
        { date: `${y}-09-16`, name: "Malaysia Day", local_name: "Hari Malaysia" },
        { date: `${y}-12-25`, name: "Christmas Day", local_name: "Hari Krismas" },
      ];
      const offset = (seed !== undefined ? Math.abs(seed) : 0) % 5;
      fixed.push({
        date: `${y}-02-${pad(10 + offset)}`,
        name: "Chinese New Year",
        local_name: "Tahun Baru Cina",
      });
      fixed.push({
        date: `${y}-04-${pad(12 + offset)}`,
        name: "Hari Raya Aidilfitri",
        local_name: "Hari Raya Aidilfitri",
      });
      return fixed;
    }
    case "SG": {
      const fixed: BaseHoliday[] = [
        { date: `${y}-01-01`, name: "New Year's Day", local_name: "New Year's Day" },
        { date: `${y}-05-01`, name: "Labour Day", local_name: "Labour Day" },
        { date: `${y}-08-09`, name: "National Day", local_name: "National Day" },
        { date: `${y}-12-25`, name: "Christmas Day", local_name: "Christmas Day" },
      ];
      const offset = (seed !== undefined ? Math.abs(seed) : 0) % 5;
      fixed.push({
        date: `${y}-02-${pad(12 + offset)}`,
        name: "Chinese New Year",
        local_name: "农历新年",
      });
      fixed.push({
        date: `${y}-04-${pad(18 + offset)}`,
        name: "Good Friday",
        local_name: "Good Friday",
      });
      fixed.push({
        date: `${y}-05-${pad(22 + offset)}`,
        name: "Vesak Day",
        local_name: "卫塞节",
      });
      return fixed;
    }
    case "US": {
      const fixed: BaseHoliday[] = [
        { date: `${y}-01-01`, name: "New Year's Day", local_name: "New Year's Day" },
        { date: `${y}-06-19`, name: "Juneteenth", local_name: "Juneteenth National Independence Day" },
        { date: `${y}-07-04`, name: "Independence Day", local_name: "Independence Day" },
        { date: `${y}-11-11`, name: "Veterans Day", local_name: "Veterans Day" },
        { date: `${y}-12-25`, name: "Christmas Day", local_name: "Christmas Day" },
      ];
      // US floating holidays (MLK Day: 3rd Mon Jan, Presidents' Day: 3rd Mon Feb, Memorial Day: last Mon May, Labor Day: 1st Mon Sep, Columbus Day: 2nd Mon Oct, Thanksgiving: 4th Thu Nov)
      fixed.push({
        date: getNthDayOfMonth(y, 1, 1, 3), // 3rd Monday in Jan
        name: "Martin Luther King, Jr. Day",
        local_name: "Martin Luther King, Jr. Day",
      });
      fixed.push({
        date: getNthDayOfMonth(y, 2, 1, 3), // 3rd Monday in Feb
        name: "Washington's Birthday",
        local_name: "Presidents' Day",
      });
      fixed.push({
        date: getLastDayOfMonth(y, 5, 1), // Last Monday in May
        name: "Memorial Day",
        local_name: "Memorial Day",
      });
      fixed.push({
        date: getNthDayOfMonth(y, 9, 1, 1), // 1st Monday in Sep
        name: "Labor Day",
        local_name: "Labor Day",
      });
      fixed.push({
        date: getNthDayOfMonth(y, 10, 1, 2), // 2nd Monday in Oct
        name: "Columbus Day",
        local_name: "Columbus Day",
      });
      fixed.push({
        date: getNthDayOfMonth(y, 11, 4, 4), // 4th Thursday in Nov
        name: "Thanksgiving Day",
        local_name: "Thanksgiving Day",
      });
      return fixed;
    }
  }
}

function getNthDayOfMonth(year: number, month: number, dayOfWeek: number, nth: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) break;
    if (d.getUTCDay() === dayOfWeek) {
      count++;
      if (count === nth) {
        return `${year}-${pad(month)}-${pad(day)}`;
      }
    }
  }
  return `${year}-${pad(month)}-01`;
}

function getLastDayOfMonth(year: number, month: number, dayOfWeek: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  let lastMatchingDay = 1;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) break;
    if (d.getUTCDay() === dayOfWeek) {
      lastMatchingDay = day;
    }
  }
  return `${year}-${pad(month)}-${pad(lastMatchingDay)}`;
}
