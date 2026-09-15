import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { publicHolidaysTool } from "../../../../src/tools/dummy-data/public-holidays.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

describe("public_holidays tool", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("real mode", () => {
    it("fetches and formats real holidays from Nager.Date", async () => {
      const mockHolidays = [
        {
          date: "2026-01-01",
          localName: "Tahun Baru Masehi",
          name: "New Year's Day",
          countryCode: "ID",
          fixed: false,
          global: true,
          counties: null,
          launchYear: null,
          types: ["Public"],
        },
        {
          date: "2026-08-17",
          localName: "Hari Kemerdekaan",
          name: "Independence Day",
          countryCode: "ID",
          fixed: true,
          global: true,
          counties: null,
          launchYear: null,
          types: ["Public"],
        },
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockHolidays,
      } as Response);

      const res = await parseToolJson(publicHolidaysTool, {
        country_code: "ID",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        mode: "real",
      });

      expect(res.mode).toBe("real");
      expect(res.country_code).toBe("ID");
      expect(res.start_date).toBe("2026-01-01");
      expect(res.end_date).toBe("2026-12-31");
      expect(res.count).toBe(2);
      expect(res.data).toHaveLength(2);
      expect(res.data[0]).toEqual({
        date: "2026-01-01",
        name: "New Year's Day",
        local_name: "Tahun Baru Masehi",
        country_code: "ID",
        types: ["Public"],
        verified: true,
        source: "nager_date",
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://date.nager.at/api/v3/PublicHolidays/2026/ID",
      );
    });

    it("filters inclusively across multi-year intervals", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/2025/")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { date: "2025-01-01", name: "New Year", localName: "NY", types: ["Public"] },
              { date: "2025-12-25", name: "Christmas", localName: "Xmas", types: ["Public"] },
            ],
          };
        }
        if (url.includes("/2026/")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { date: "2026-01-01", name: "New Year", localName: "NY", types: ["Public"] },
              { date: "2026-07-04", name: "Independence", localName: "4th Jul", types: ["Public"] },
            ],
          };
        }
        return { ok: false, status: 404 };
      });

      const res = await parseToolJson(publicHolidaysTool, {
        country_code: "us",
        start_date: "2025-06-01",
        end_date: "2026-05-01",
      });

      expect(res.count).toBe(2);
      expect(res.data.map((h: any) => h.date)).toEqual(["2025-12-25", "2026-01-01"]);
    });

    it("handles upstream network failures with informative error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      await expect(
        publicHolidaysTool.execute({
          country_code: "SG",
          mode: "real",
        }),
      ).rejects.toMatchObject({
        code: "UPSTREAM_ERROR",
        retryable: true,
      });
    });
  });

  describe("synthetic mode", () => {
    it("generates deterministic synthetic holidays without network calls", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const res = await parseToolJson(publicHolidaysTool, {
        country_code: "SG",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        mode: "synthetic",
        seed: 42,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(res.mode).toBe("synthetic");
      expect(res.country_code).toBe("SG");
      expect(res.count).toBeGreaterThan(0);
      for (const row of res.data) {
        expect(row.verified).toBe(false);
        expect(row.source).toBe("synthetic");
        expect(row.country_code).toBe("SG");
      }
    });

    it("is reproducible with same seed across all supported countries", async () => {
      for (const cc of ["ID", "MY", "SG", "US"]) {
        const res1 = await parseToolJson(publicHolidaysTool, {
          country_code: cc,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          mode: "synthetic",
          seed: 1234,
        });

        const res2 = await parseToolJson(publicHolidaysTool, {
          country_code: cc,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          mode: "synthetic",
          seed: 1234,
        });

        expect(res1).toEqual(res2);
      }
    });
  });

  describe("validation and error handling", () => {
    it("throws on missing country_code", async () => {
      await expect(publicHolidaysTool.execute({})).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "country_code",
      });
    });

    it("throws on unsupported country_code", async () => {
      await expect(
        publicHolidaysTool.execute({ country_code: "FR" }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "country_code",
      });
    });

    it("throws on invalid date format", async () => {
      await expect(
        publicHolidaysTool.execute({ country_code: "ID", start_date: "01-01-2026" }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "start_date",
      });
    });

    it("throws when start_date > end_date", async () => {
      await expect(
        publicHolidaysTool.execute({
          country_code: "ID",
          start_date: "2026-12-31",
          end_date: "2026-01-01",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "start_date",
      });
    });

    it("throws when date range exceeds 5 years", async () => {
      await expect(
        publicHolidaysTool.execute({
          country_code: "ID",
          start_date: "2020-01-01",
          end_date: "2027-01-01",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "end_date",
      });
    });

    it("throws on invalid mode", async () => {
      await expect(
        publicHolidaysTool.execute({ country_code: "ID", mode: "unknown" }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "mode",
      });
    });
  });
});
