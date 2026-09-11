import { faker, fakerEN, fakerEN_GB, fakerID_ID } from "@faker-js/faker";
import { ToolError } from "../../core/errors.js";

// Faker.js does not ship a Malay (ms_MY) or Singapore (en_SG) locale.
// For `my` and `sg`, we use English instances as the base and rely on
// COUNTRY_BY_LOCALE + custom formatting (phone, tax ID) to make output
// locale-appropriate.
export const LOCALES = {
  en: fakerEN,
  id: fakerID_ID,
  my: fakerEN, // fallback — no ms_MY in faker
  sg: fakerEN_GB, // British English, closest to Singapore conventions
} as const;

export type Locale = keyof typeof LOCALES;

export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];

export const COUNTRY_BY_LOCALE: Record<Locale, string> = {
  en: "United States",
  id: "Indonesia",
  my: "Malaysia",
  sg: "Singapore",
};

export const resolveLocale = (requested?: string): Locale => {
  if (!requested) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "A locale is required.",
      `Provide one of: ${LOCALE_CODES.join(", ")}.`,
      true,
      { parameter: "locale", availableValues: LOCALE_CODES },
    );
  }
  if (!(requested in LOCALES)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Unsupported locale: "${requested}".`,
      `Supported locales are: ${LOCALE_CODES.join(", ")}.`,
      true,
      { parameter: "locale", availableValues: LOCALE_CODES },
    );
  }
  return requested as Locale;
};

export const pickRandomLocale = (): Locale => {
  return fakerEN.helpers.arrayElement(LOCALE_CODES);
};

export const seedAllLocales = (seed: number): void => {
  faker.seed(seed);
  for (const f of Object.values(LOCALES)) {
    f.seed(seed);
  }
};
