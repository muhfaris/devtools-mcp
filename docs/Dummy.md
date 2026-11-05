# 🎭 Dummy Data Module

> Locale-aware fake data generation for testing, seeding, and demos.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Locale Support](#-locale-support)
- [Tools](#-tools)
- [Usage Examples](#-usage-examples)
- [Known Limitations](#-known-limitations)
- [Testing Tips](#-testing-tips)

---

## 📖 Overview

The dummy data module generates realistic fake records for:

- UI/UX testing (layout, truncation, i18n)
- Database seeding
- Demo data for screenshots
- API response mocking
- QA fixtures

**Key design principles:**

- **Locale-aware** — respects regional formats (phone, postal code, tax ID)
- **Mixed by default** — each record gets a random locale for diverse test data
- **No config required** — hardcoded sensible defaults; override via params
- **Deterministic with seed** — pass `seed` for reproducible output

---

## 🌍 Locale Support

Supported locales: `en`, `id`, `my`, `sg`

| Locale | Country | Base Faker | Notes |
| :--- | :--- | :--- | :--- |
| `en` | United States | `fakerEN` | Full native support |
| `id` | Indonesia | `fakerID_ID` | Full native support |
| `my` | Malaysia | `fakerEN` ⚠️ | Fallback — see [limitations](#-known-limitations) |
| `sg` | Singapore | `fakerEN_GB` ⚠️ | Fallback — see [limitations](#-known-limitations) |

### Default Behavior

When `locale` is **not** specified, each record picks a **random locale** from the four. This simulates a global user base and surfaces i18n bugs that pure-English data would miss.

To force a single locale, pass `locale: <code>`.

### Country Pinning

The `country` field is always pinned to match the locale:

| Locale | `country` value |
| :--- | :--- |
| `en` | `United States` |
| `id` | `Indonesia` |
| `my` | `Malaysia` |
| `sg` | `Singapore` |

This avoids Faker returning unexpected countries for English-based locales.

---

## 🛠️ Tools

### `fake_person`

Generate realistic dummy person records.

**Parameters:**

| Param | Type | Optional | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `count` | number | ✅ | `10` | Number of records (max: 1000) |
| `locale` | string | ✅ | random | Force a single locale: `en`, `id`, `my`, `sg` |
| `seed` | number | ✅ | — | Random seed for reproducible output |

**Output fields:**

| Field | Description |
| :--- | :--- |
| `locale` | Which locale produced this record |
| `first_name` | Given name |
| `last_name` | Family name |
| `full_name` | `first_name + last_name` |
| `email` | Lowercase email derived from name |
| `phone` | Locale-formatted phone number |
| `address` | Street address |
| `city` | City |
| `state` | State/province |
| `country` | Pinned to locale |
| `postal_code` | Locale-formatted postal code |
| `date_of_birth` | ISO date, age between 18–65 |
| `gender` | `male` or `female` |
| `job_title` | Job title |

---

### `fake_company`

Generate realistic dummy company records with locale-appropriate tax ID formats.

**Parameters:**

| Param | Type | Optional | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `count` | number | ✅ | `10` | Number of records (max: 1000) |
| `locale` | string | ✅ | random | Force a single locale: `en`, `id`, `my`, `sg` |
| `seed` | number | ✅ | — | Random seed for reproducible output |

**Output fields:**

| Field | Description |
| :--- | :--- |
| `locale` | Which locale produced this record |
| `name` | Company name |
| `legal_name` | Locale-formatted legal name (`PT X`, `X Inc.`, `X Sdn Bhd`, etc.) |
| `email` | Contact email |
| `phone` | Locale-formatted phone |
| `website` | Company website URL |
| `address` | Street address |
| `city` | City |
| `state` | State/province |
| `country` | Pinned to locale |
| `postal_code` | Locale-formatted postal code |
| `industry` | Industry sector |
| `tax_id` | Locale-specific tax ID format (see below) |
| `employee_count` | 1 – 10000 |
| `founded_year` | 1950 – 2024 |

**Tax ID formats:**

| Locale | Format | Example | Official name |
| :--- | :--- | :--- | :--- |
| `en` | `XX-XXXXXXX` | `12-3456789` | EIN |
| `id` | `XX.XXX.XXX.X-XXX.XXX` | `12.345.678.9-123.000` | NPWP |
| `my` | 12 digits | `123456789012` | SSM |
| `sg` | 8 digits + letter | `12345678A` | UEN |

---

### `public_holidays`

Retrieve official verified public holidays or generate deterministic synthetic test holidays for `ID`, `MY`, `SG`, and `US`.

**Parameters:**

| Param | Type | Optional | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `country_code` | string | ❌ | — | ISO 3166-1 alpha-2 code: `ID`, `MY`, `SG`, `US` (case-insensitive) |
| `start_date` | string | ✅ | `YYYY-01-01` | Start date in `YYYY-MM-DD` format |
| `end_date` | string | ✅ | `YYYY-12-31` | End date in `YYYY-MM-DD` format |
| `mode` | string | ✅ | `real` | `"real"` (fetches Nager.Date) or `"synthetic"` (offline generator) |
| `seed` | number | ✅ | — | Random seed for reproducible output in synthetic mode |

**Output fields:**

| Field | Description |
| :--- | :--- |
| `count` | Total holidays in range |
| `mode` | `"real"` or `"synthetic"` |
| `country_code` | Normalized uppercase country code |
| `start_date` | Effective start date |
| `end_date` | Effective end date |
| `data` | Array of holiday records: `date`, `name`, `local_name`, `country_code`, `types`, `verified`, `source` |

> ⚠️ **Note on Synthetic Data:** Synthetic records are deterministically generated test fixtures for offline pipelines and must not be treated as legal or calendar truth. Real mode verifies official public holidays.


---

## 💡 Usage Examples

### CLI

```bash
# Mixed locales (each record random)
npm run dev -- fake_person --count 4

# Force Indonesian
npm run dev -- fake_person --count 3 --locale id

# Force Malaysian
npm run dev -- fake_person --locale my --count 2

# Reproducible output
npm run dev -- fake_person --count 3 --seed 42

# Companies
npm run dev -- fake_company --count 5
npm run dev -- fake_company --locale id --count 3
