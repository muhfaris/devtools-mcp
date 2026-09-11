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

export const fakePersonTool: Tool = {
  name: "fake_person",
  description:
    "Generate realistic dummy person data. Defaults to mixed locales (en/id/my/sg); pass `locale` to force one.",
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

      const firstName = f.person.firstName();
      const lastName = f.person.lastName();

      rows.push({
        locale,
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        email: f.internet.email({ firstName, lastName }).toLowerCase(),
        phone: f.phone.number(),
        address: f.location.streetAddress(),
        city: f.location.city(),
        state: f.location.state(),
        country: COUNTRY_BY_LOCALE[locale],
        postal_code: f.location.zipCode(),
        date_of_birth: f.date
          .birthdate({ min: 18, max: 65, mode: "age" })
          .toISOString()
          .split("T")[0],
        gender: f.person.sex(),
        job_title: f.person.jobTitle(),
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
