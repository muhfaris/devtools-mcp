import { faker } from "@faker-js/faker";
import { Tool } from "../../core/types.js";
import {
  LOCALES,
  LOCALE_CODES,
  COUNTRY_BY_LOCALE,
  pickRandomLocale,
  resolveLocale,
  seedAllLocales,
} from "./locales.js";

const DEFAULT_COUNT = 10;
const MAX_ROWS = 1000;

const INDUSTRIES = [
  "Technology",
  "Finance",
  "Healthcare",
  "Retail",
  "Manufacturing",
  "Education",
  "Logistics",
  "Media",
  "Real Estate",
  "Hospitality",
];

export const fakeCompanyTool: Tool = {
  name: "fake_company",
  description:
    "Generate realistic dummy company data with locale-appropriate tax ID formats (EIN, NPWP, SSM, UEN).",
  params: {
    count: {
      type: "number",
      optional: true,
      description: `Number of records (default: ${DEFAULT_COUNT}, max: ${MAX_ROWS})`,
    },
    locale: {
      type: "string",
      optional: true,
      description: `Force a single locale: ${LOCALE_CODES.join(", ")}. If omitted, each record gets a random locale.`,
    },
    seed: {
      type: "number",
      optional: true,
      description: "Random seed for reproducible output",
    },
  },
  execute: async (params) => {
    const count = Math.min(Number(params.count) || DEFAULT_COUNT, MAX_ROWS);
    const forcedLocale = params.locale
      ? resolveLocale(String(params.locale))
      : null;

    if (params.seed !== undefined) {
      seedAllLocales(Number(params.seed));
    }

    const rows = [];
    for (let i = 0; i < count; i++) {
      const locale = forcedLocale ?? pickRandomLocale();
      const f = LOCALES[locale];

      const name = f.company.name();

      rows.push({
        locale,
        name,
        legal_name: buildLegalName(name, locale),
        email: `contact@${f.internet.domainName()}`.toLowerCase(),
        phone: f.phone.number(),
        website: `https://${f.internet.domainName()}`,
        address: f.location.streetAddress(),
        city: f.location.city(),
        state: f.location.state(),
        country: COUNTRY_BY_LOCALE[locale],
        postal_code: f.location.zipCode(),
        industry: faker.helpers.arrayElement(INDUSTRIES),
        tax_id: buildTaxId(locale),
        employee_count: faker.number.int({ min: 1, max: 10000 }),
        founded_year: faker.number.int({ min: 1950, max: 2024 }),
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ count: rows.length, data: rows }, null, 2),
        },
      ],
    };
  },
};

function buildLegalName(name: string, locale: string): string {
  if (locale === "id") {
    const isPublic = faker.datatype.boolean({ probability: 0.2 });
    const prefix = faker.helpers.arrayElement(["PT", "CV"]);
    return isPublic && prefix === "PT" ? `PT ${name} Tbk` : `${prefix} ${name}`;
  }

  const suffixes: Record<string, string[]> = {
    en: ["Inc.", "LLC", "Corp.", "Ltd."],
    my: ["Sdn Bhd", "Bhd"],
    sg: ["Pte Ltd", "LLP"],
  };
  const suffix = faker.helpers.arrayElement(suffixes[locale] || ["Inc."]);
  return `${name} ${suffix}`;
}

function buildTaxId(locale: string): string {
  const num = (n: number) => faker.string.numeric(n);
  switch (locale) {
    case "id":
      // NPWP: XX.XXX.XXX.X-XXX.XXX
      return `${num(2)}.${num(3)}.${num(3)}.${num(1)}-${num(3)}.${num(3)}`;
    case "my":
      // SSM: 12 digits
      return num(12);
    case "sg":
      // UEN: 8 digits + letter, or year + 5 digits + letter
      return `${num(8)}${faker.string.alpha({ length: 1, casing: "upper" })}`;
    case "en":
    default:
      // EIN: XX-XXXXXXX
      return `${num(2)}-${num(7)}`;
  }
}
