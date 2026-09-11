import { describe, expect, it } from "vitest";
import { fakePersonTool, fakeCompanyTool } from "../../../../src/tools/dummy-data/index.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

describe("dummy data tools", () => {
  describe("fake_person", () => {
    it("generates default 10 records with mixed locales", async () => {
      const res = await parseToolJson(fakePersonTool, {});
      expect(res.count).toBe(10);
      expect(res.data).toHaveLength(10);
      for (const row of res.data) {
        expect(row).toHaveProperty("locale");
        expect(row).toHaveProperty("full_name");
        expect(row).toHaveProperty("email");
        expect(row).toHaveProperty("phone");
        expect(row).toHaveProperty("country");
        expect(["United States", "Indonesia", "Malaysia", "Singapore"]).toContain(row.country);
      }
    });

    it("respects custom count and clamps at 1000", async () => {
      const res = await parseToolJson(fakePersonTool, { count: 3 });
      expect(res.count).toBe(3);
      expect(res.data).toHaveLength(3);
    });

    it("forces a specific locale", async () => {
      const res = await parseToolJson(fakePersonTool, { count: 5, locale: "id" });
      expect(res.count).toBe(5);
      for (const row of res.data) {
        expect(row.locale).toBe("id");
        expect(row.country).toBe("Indonesia");
      }
    });

    it("throws ToolError for unsupported locale", async () => {
      await expect(
        fakePersonTool.execute({ locale: "fr" }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        parameter: "locale",
        retryable: true,
      });
    });

    it("generates deterministic output with seed", async () => {
      const res1 = await parseToolJson(fakePersonTool, { count: 5, seed: 12345 });
      const res2 = await parseToolJson(fakePersonTool, { count: 5, seed: 12345 });
      expect(res1).toEqual(res2);
    });
  });

  describe("fake_company", () => {
    it("generates default 10 records with company fields and tax IDs", async () => {
      const res = await parseToolJson(fakeCompanyTool, {});
      expect(res.count).toBe(10);
      expect(res.data).toHaveLength(10);
      for (const row of res.data) {
        expect(row).toHaveProperty("name");
        expect(row).toHaveProperty("legal_name");
        expect(row).toHaveProperty("tax_id");
        expect(row).toHaveProperty("industry");
      }
    });

    it("generates correct tax ID formats per locale", async () => {
      const resEn = await parseToolJson(fakeCompanyTool, { count: 2, locale: "en" });
      for (const row of resEn.data) {
        expect(row.tax_id).toMatch(/^\d{2}-\d{7}$/);
        expect(row.country).toBe("United States");
      }

      const resId = await parseToolJson(fakeCompanyTool, { count: 2, locale: "id" });
      for (const row of resId.data) {
        expect(row.tax_id).toMatch(/^\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}$/);
        expect(row.country).toBe("Indonesia");
        expect(row.legal_name.startsWith("PT ") || row.legal_name.startsWith("CV ")).toBe(true);
      }

      const resMy = await parseToolJson(fakeCompanyTool, { count: 2, locale: "my" });
      for (const row of resMy.data) {
        expect(row.tax_id).toMatch(/^\d{12}$/);
        expect(row.country).toBe("Malaysia");
        expect(row.legal_name.endsWith("Sdn Bhd") || row.legal_name.endsWith("Bhd")).toBe(true);
      }

      const resSg = await parseToolJson(fakeCompanyTool, { count: 2, locale: "sg" });
      for (const row of resSg.data) {
        expect(row.tax_id).toMatch(/^\d{8}[A-Z]$/);
        expect(row.country).toBe("Singapore");
        expect(row.legal_name.endsWith("Pte Ltd") || row.legal_name.endsWith("LLP")).toBe(true);
      }
    });

    it("generates deterministic output with seed", async () => {
      const res1 = await parseToolJson(fakeCompanyTool, { count: 5, seed: 9999 });
      const res2 = await parseToolJson(fakeCompanyTool, { count: 5, seed: 9999 });
      expect(res1).toEqual(res2);
    });
  });
});
