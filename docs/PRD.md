# PRD: DevTools MCP

**Status:** Draft v1.0
**Owner:** Faris
**Tanggal:** 8 September 2026
**Dokumen:** Product Requirements Document — Flagship Scope

---

## 1. Ringkasan Eksekutif

DevTools MCP adalah sebuah **MCP (Model Context Protocol) server** yang menyediakan satu set tool development-utility yang bisa dipakai langsung oleh developer maupun AI coding assistant (Claude Code, Cursor, dsb.) selama proses development. Tujuannya: menghilangkan konteks-switching ke browser/tools eksternal untuk hal-hal repetitif seperti generate ID, generate dummy data, inspect schema database, generate test scenario, dan dokumentasi — semua bisa dilakukan langsung dari dalam sesi coding.

**Positioning:** bukan sekadar kumpulan utility kecil (seperti banyak MCP server sejenis di pasaran), tapi *developer companion* yang context-aware — tahu schema database project lo, tahu konvensi project lo, dan bisa dikonfigurasi supaya defaultnya sesuai kebutuhan tim/project masing-masing.

**Kenapa sekarang (flagship, bukan MVP-tempel):** kalau dibangun sebagai MVP kecil-kecilan lalu di-extend belakangan, arsitekturnya gampang jadi kaku (hardcoded per-tool, susah nambah provider DB baru, susah nambah config layer). Karena itu PRD ini didesain dengan asumsi dari awal: banyak tool, banyak provider, banyak config surface, dipakai lintas project.

---

## 2. Latar Belakang & Masalah

Selama koding dibantu AI assistant, pola yang berulang:

- AI sering nebak-nebak format ID (UUID vs ULID vs auto-increment) → salah asumsi → bug halus.
- AI generate dummy data manual dari deskripsi lo, bukan dari schema asli → data ga representative, kadang melanggar constraint (unique, FK, enum).
- AI ga tau struktur DB project secara real-time → halusinasi nama kolom/tabel.
- AI ga tau isi `.env` / `docker-compose.yml` yang diperlukan → salah assume env var.
- Test scenario / test case sering ditulis manual, padahal bisa di-generate sistematis dari endpoint spec.
- Dokumentasi (OpenAPI, changelog, ADR) sering telat/ga sinkron dengan kode karena effort manual.
- Command line utility kecil (base64, JWT decode, case converter, cron parser) — solve dengan buka website pihak ketiga, konteks pindah keluar dari editor/chat.

**Masalah inti:** tidak ada satu titik akses terstandarisasi yang bisa dipanggil AI assistant untuk semua kebutuhan "utility development" ini — sehingga AI harus generate manual (rawan salah) atau developer harus keluar dari flow.

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan Produk
1. Menyediakan single MCP server dengan tool coverage lengkap untuk kebutuhan development sehari-hari.
2. Semua tool bisa dipanggil AI assistant secara langsung (via MCP tool-calling) maupun manual oleh developer (CLI/API).
3. Tool yang berhubungan dengan database/schema harus **introspect real** dari koneksi aktual (bukan tebakan), dengan opsi read-only enforcement untuk keamanan.
4. Semua default value (algoritma ID, struktur codegraph, dsb.) harus **configurable per-project**, bukan hardcoded global.
5. Arsitektur extensible: menambah tool baru atau provider baru (mis. DB engine baru) tidak butuh refactor besar.

### 3.2 Non-Tujuan (di luar scope v1)
- Bukan APM/observability tool (bukan pengganti Datadog/Grafana).
- Bukan full ORM/migration tool (boleh bantu generate migration diff, tapi bukan pengganti Prisma/GORM/Sequelize sepenuhnya).
- Bukan CI/CD orchestrator.
- Tidak menyimpan/mengelola secret produksi (execute query dibatasi lingkungan non-prod secara default, lihat §9 Security).

---

## 4. Target Pengguna & Use Case

| Persona | Kebutuhan Utama |
|---|---|
| Solo developer / indie hacker (seperti Faris) | Speed — generate ID/dummy data/test scenario instan tanpa keluar dari editor/chat AI |
| AI coding agent (Claude Code, Cursor, dll.) | Sumber kebenaran (ground truth) untuk schema DB, env, dan konvensi project — supaya output kode akurat, bukan halusinasi |
| Tim kecil (startup) | Konsistensi konvensi lintas anggota tim (semua pakai ULID yang sama, semua generate dummy data dari schema yang sama) |
| QA / tester | Generate test scenario & dummy data otomatis dari spec/endpoint |

**Use case utama:**
- "Generate 50 dummy user sesuai schema tabel `users`, respect constraint & FK ke `companies`."
- "AI, tolong buat endpoint baru — sebelum itu cek dulu struktur tabel `orders` yang sebenarnya."
- "Generate test scenario positive + negative buat endpoint `POST /orders` ini."
- "Convert response JSON ini ke TypeScript interface pakai case yang sesuai."
- "Buatkan commit message dari diff ini sesuai conventional commits."

---

## 5. Scope Tool — Flagship (Lengkap)

Dikelompokkan per kategori. Kolom **Provider config** menandakan tool yang butuh koneksi/konfigurasi eksternal (DB, dsb).

### 5.1 ID & Identifier Generator
| Tool | Deskripsi | Konfigurasi |
|---|---|---|
| `generate_ulid` | ULID, opsional custom timestamp | - |
| `generate_uuid4` | UUID v4 | - |
| `generate_uuid7` | UUID v7 (time-ordered) | - |
| `generate_cuid` | CUID2 | - |
| `generate_nanoid` | Nano ID, custom alphabet & length | alphabet, length |
| `generate_ksuid` | KSUID | - |
| `generate_snowflake` | Snowflake ID (Twitter-style) | machine_id, epoch |
| `generate_objectid` | MongoDB ObjectID | - |
| `generate_shortid` / `generate_hashid` | Short unique ID (URL shortener use-case) | length, salt |
| `generate_batch` | Generate N ID sekaligus dari tipe manapun di atas | count, type |

### 5.2 Dummy / Fake Data Generator
| Tool | Deskripsi |
|---|---|
| `fake_person` | Nama, email, no HP (format lokal ID/MY), alamat, dsb. — locale-aware |
| `fake_company` | Nama perusahaan, NPWP dummy, alamat bisnis |
| `generate_from_schema` | **Core feature.** Ambil schema tabel (dari DB introspection) → generate dummy row yang valid: respect type, nullable, unique, enum, FK reference ke tabel lain |
| `generate_from_json_schema` | Generate dummy payload dari JSON Schema / OpenAPI schema / TypeScript type |
| `seed_database` | Generate + insert langsung dummy data ke DB (staging/dev only, dengan safety guard) |
| `generate_csv` | Generate dummy dataset dalam format CSV untuk keperluan import/testing |

### 5.3 Database Tooling
| Tool | Deskripsi |
|---|---|
| `get_db_schema` | Introspect schema (tabel, kolom, tipe, constraint, index, FK) — PostgreSQL, MySQL, MariaDB |
| `execute_query` | Jalankan query — default read-only, whitelist mode untuk write |
| `generate_erd` | Generate diagram ERD (Mermaid/SVG) dari schema |
| `explain_query` | Jalankan EXPLAIN/ANALYZE, kasih ringkasan performa dalam bahasa natural |
| `suggest_index` | Analisis query pattern / unused index → saran index |
| `diff_schema` | Bandingkan schema A vs B → generate migration SQL |
| `generate_seed_from_table` | Export sample data dari tabel existing (anonymized opsional) buat seed dev/staging |

### 5.4 Environment & Config
| Tool | Deskripsi |
|---|---|
| `get_env_schema` | Parse `.env`, `.env.example`, `docker-compose.yml` → daftar env var yang dibutuhkan + tipe/default yang terdeteksi |
| `validate_env` | Cek `.env` aktual vs `.env.example` — env var yang hilang/ga terpakai |
| `diff_env` | Bandingkan env antar environment (dev vs staging vs prod template) |

### 5.5 Code Intelligence
| Tool | Deskripsi |
|---|---|
| `codegraph` | Generate dependency graph / call graph project (default on, configurable exclude path) |
| `rtk` (repo-to-knowledge / repo topology kit — perlu didefinisikan ulang nama & scope-nya) | Ringkasan struktur repo: entry point, layer arsitektur, konvensi folder |
| `case_convert` | Convert antar camelCase / snake_case / kebab-case / PascalCase / CONSTANT_CASE |
| `json_yaml_toml_convert` | Convert antar format JSON/YAML/TOML |
| `diff_viewer` | Diff dua blob teks/JSON secara terstruktur |

### 5.6 Testing
| Tool | Deskripsi |
|---|---|
| `generate_test_scenario` | Dari endpoint/OpenAPI spec → generate skenario happy path, edge case, negative case (format Gherkin/plain) |
| `curl_to_code` | Convert curl command → kode client (Go/JS/TS/Python) |
| `mock_server` | Spin up mock API server sementara dari OpenAPI/schema |
| `validate_openapi` | Validasi contract OpenAPI (contract testing) |
| `record_replay_http` | Rekam request/response HTTP, replay untuk regression test |

### 5.7 Documentation
| Tool | Deskripsi |
|---|---|
| `generate_openapi` | Generate/update OpenAPI spec dari kode (parse route + struct/type) |
| `generate_changelog` | Generate changelog dari git log (conventional commits) |
| `generate_readme_skeleton` | Generate README awal dari struktur project |
| `generate_adr` | Generate template Architecture Decision Record |

### 5.8 Git & Collaboration
| Tool | Deskripsi |
|---|---|
| `commit_message` | Generate conventional commit message dari diff |
| `pr_description` | Generate deskripsi PR dari diff + commit history |
| `branch_name` | Generate nama branch dari judul ticket/issue |

### 5.9 Encoding & Security Utility
| Tool | Deskripsi |
|---|---|
| `base64_encode_decode` | Encode/decode base64 |
| `jwt_decode` | Decode (+ verify opsional) JWT |
| `hash_generate` | MD5/SHA1/SHA256/bcrypt |
| `regex_test` | Test & jelaskan regex terhadap sample string |
| `secret_generate` | Generate password/secret/API key dengan policy custom |

### 5.10 Misc Dev Utility
| Tool | Deskripsi |
|---|---|
| `cron_parse` | Parse & jelaskan cron expression dalam bahasa natural, next-run preview |
| `timezone_convert` | Convert timestamp antar timezone |

---

## 6. Arsitektur

### 6.1 Prinsip Desain
- **Plugin-based tool registry** — tiap tool adalah modul independen yang register diri ke core server. Nambah tool baru = nambah modul, tanpa sentuh core.
- **Provider abstraction** untuk semua hal yang berhubungan ke sistem eksternal (database engine, dsb.) — interface generik (`Introspect()`, `ExecuteQuery()`, dst.) diimplementasi per-engine (Postgres/MySQL/MariaDB), supaya nambah engine baru (mis. SQLite, SQL Server) tinggal implementasi interface tanpa ubah tool layer.
- **Config layer berlapis**: default global → override per-project (`.devtools/config.yaml` di root repo) → override per-invocation (parameter saat tool dipanggil).
- **Stateless per-call, tapi cache-aware** — schema introspection di-cache dengan TTL/invalidation, supaya ga query metadata DB tiap kali dipanggil.

### 6.2 Komponen
Rincian komponen (Registry, Config Loader, Tool Layer, Provider Layer, MCP Server) ada di **[Architecture.md](./Architecture.md)**.

### 6.3 Tech Stack (usulan, sesuai stack existing Faris)
- **Bahasa:** TypeScript di Node 20.19+ — satu codebase melayani CLI dan MCP server; build ke `dist/` lewat `tsc`.
- **DB driver:** `pg` (Postgres), `mysql2` (MySQL/MariaDB), `ioredis` (Redis), `@gitbeaker/rest` (GitLab).
- **Config format:** YAML (`.devtools/config.yaml`).
- **Distribution:** paket npm (`npx @muhfaris/devtools`), Node >= 20.19. Publish lewat GitHub release; lihat [Development.md](./Development.md).

### 6.4 Konfigurasi Contoh
Contoh lengkap `.devtools/config.yaml` ada di **[Configuration.md](./Configuration.md)**.

---

## 7. Prioritas Rilis

Karena arahan produk ini flagship (bukan MVP yang dipangkas), semua kategori di §5 masuk **scope produk final**. Yang dibedakan bukan "fitur mana yang dibuang", tapi **urutan implementasi** berdasarkan dependency teknis & value density.

| Fase | Fokus | Kategori |
|---|---|---|
| **Fase 1 — Fondasi** | Core server, plugin registry, config layer | Arsitektur inti (§6), tanpa tool bisnis dulu |
| **Fase 2 — Utility Cepat** | Tool tanpa dependency eksternal, value langsung terasa | ID Generator (5.1), Encoding/Security (5.9), Misc Utility (5.10), Git helper (5.8) |
| **Fase 3 — Database Core** | Provider abstraction terbentuk di sini | `get_db_schema`, `execute_query`, `get_env_schema` |
| **Fase 4 — Data Generation** | Bergantung pada Fase 3 (butuh schema) | Dummy Data Generator (5.2) lengkap, `generate_erd`, `diff_schema` |
| **Fase 5 — Testing & Docs** | Bergantung pada Fase 3+4 (butuh data & schema representatif) | Testing (5.6), Documentation (5.7) |
| **Fase 6 — Code Intelligence** | Paling kompleks, butuh AST parsing multi-bahasa | `codegraph`, `rtk`, `generate_openapi` dari kode |

Tiap fase tetap shippable & usable secara independen — bukan blocked total sampai semua fase selesai.

---

## 8. Non-Functional Requirements

- **Performance:** tool response < 200ms untuk generator murni (ID, encoding); < 2s untuk introspection DB dengan cache hit; < 5s cache miss pada schema besar (>100 tabel).
- **Reliability:** semua provider call (DB, dsb.) punya timeout & graceful error — MCP tool call tidak boleh hang.
- **Portability:** jalan di macOS/Linux minimal (dev environment Faris), Windows nice-to-have.
- **Observability:** setiap tool call ter-log (tool name, durasi, sukses/gagal) untuk debugging.
- **Extensibility:** menambah tool baru harus achievable dalam < 1 hari kerja tanpa nyentuh core server.
- **Zero-config start:** tool non-DB harus bisa dipakai tanpa config file sama sekali (sensible default).

---

## 9. Security & Safety

- `allow_write` punya **satu arti di semua provider**: grant, **deny by default**. Write `execute_query`, `gitlab_create_note`/`gitlab_update_note`/`gitlab_delete_note`, dan Redis write butuh `security.allow_write: true` (default bersama) atau `providers.<provider>.security.allow_write: true` (override per provider); direkomendasikan hanya untuk dev/staging.
- Environment yang ditandai `production`/`prod` dicocokkan lewat `blocked_env` (default `[production, prod]`) ke **nama koneksi** (bukan DSN/host); untuk GitLab dicocokkan ke **project path/ID**. Write tetap **diblokir default** dan butuh override eksplisit + konfirmasi.
- Tidak ada flag `readonly` per koneksi: kontrol per koneksi diungkapkan dengan mendaftarkan nama koneksi di `blocked_env` provider tersebut.
- Kredensial DB tidak pernah di-log atau dikembalikan dalam response tool (masking otomatis).
- `fake_person`/`fake_company` harus jelas-jelas generate data sintetis, tidak boleh accidental leak data asli dari DB connected (isolasi logic generator dari logic introspection).
- Audit log lokal untuk semua tool kategori mutasi (execute_query write, seed_database).

---

## 10. Metrik Keberhasilan

- **Adoption pribadi:** dipakai aktif di ≥3 project Faris (mis. [[kain]], [[xauusd-backtesting-platform]], [[gherkio]]) dalam 1 bulan setelah Fase 3 selesai.
- **Reduksi context-switch:** subjektif — berkurangnya jumlah kali buka tools eksternal (uuidgenerator.net, jwt.io, dsb.) selama sesi coding.
- **Akurasi AI assistant:** berkurangnya kasus AI berhalusinasi nama kolom/tabel setelah `get_db_schema` terintegrasi dalam workflow.
- **Kalau dirilis publik nanti:** GitHub stars, jumlah tool yang di-invoke per hari (kalau ada telemetry opt-in).

---

## 11. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Scope terlalu besar, ga pernah selesai | Fase per §7 tetap shippable independen; commit ke Fase 1–2 dulu sebagai working product |
| `codegraph`/`rtk` butuh parsing multi-bahasa (Go, PHP, TS, Python, Lua) — kompleksitas tinggi | Taruh di Fase 6 (paling akhir), mulai dari 1 bahasa (Go atau TS) sebagai proof of concept |
| Koneksi DB di tool MCP = risiko keamanan kalau config salah | Default read-only + production-block by default (§9) |
| Nama tool `rtk` ambigu, belum ada definisi jelas | Perlu didefinisikan ulang scope & nama sebelum masuk implementasi (flag di §5.5) |

---

## 12. Open Questions

1. `rtk` — apa kepanjangan & scope pastinya? Perlu didefinisikan sebelum masuk Fase 6.
2. Distribusi: standalone binary saja, atau juga publish sebagai npm package (npx-able) untuk audiens yang bukan Go dev?
3. Multi-tenant/tim: apakah config & cache perlu di-share antar anggota tim (butuh Redis/central config), atau cukup per-developer lokal untuk v1?
4. Apakah `seed_database` & `execute_query` write perlu approval flow (mis. dry-run dulu, tampilkan preview sebelum eksekusi)?
5. Locale untuk `fake_person`/`fake_company` — prioritas ID & MY dulu sesuai domain project existing, tapi apakah perlu extensible ke locale lain dari awal?

---

## 13. Client Integration

DevTools MCP didistribusikan sebagai **satu binary** yang dijalankan via stdio transport oleh masing-masing client. Tidak ada integrasi khusus per-client yang perlu dibangun — cukup daftarin command-nya di config masing-masing tool.

Panduan setup per-client (Claude Code, Cursor, CodeCompanion.nvim, Codex, MCP Inspector) ada di **[MCP-Clients.md](./MCP-Clients.md)**.

### Prinsip Desain untuk Kompatibilitas Lintas Client
- **Transport: stdio only untuk v1.** Semua client di atas support stdio; HTTP/SSE (buat remote/multi-user) masuk scope belakangan kalau dibutuhkan.
- **Config precedence:** env var yang dikirim client (`env` di config masing-masing) **override** default di `.devtools/config.yaml`, tapi *tidak override* per-invocation parameter yang eksplisit dikirim saat tool dipanggil.
- **Auto-discovery `.devtools/config.yaml`:** saat process start, binary cari file ini di `cwd` lalu jalan ke atas sampai ketemu root git repo — supaya tidak perlu di-pass manual di tiap client config, cukup taruh 1 file di root project.
- **Satu binary, semua client** — karena ketiganya invoke via command line (bukan HTTP endpoint), distribusi sebagai compiled Go binary paling gampang: tinggal `cmd`/`command` yang beda-beda formatnya doang, isinya sama.

---

## 14. Lampiran — Daftar Lengkap Tool (Flat List)

Generator: `generate_ulid`, `generate_uuid4`, `generate_uuid7`, `generate_cuid`, `generate_nanoid`, `generate_ksuid`, `generate_snowflake`, `generate_objectid`, `generate_shortid`, `generate_batch`

Dummy Data: `fake_person`, `fake_company`, `generate_from_schema`, `generate_from_json_schema`, `seed_database`, `generate_csv`

Database: `get_db_schema`, `execute_query`, `generate_erd`, `explain_query`, `suggest_index`, `diff_schema`, `generate_seed_from_table`

Env/Config: `get_env_schema`, `validate_env`, `diff_env`

Code Intelligence: `codegraph`, `rtk`, `case_convert`, `json_yaml_toml_convert`, `diff_viewer`

Testing: `generate_test_scenario`, `curl_to_code`, `mock_server`, `validate_openapi`, `record_replay_http`

Documentation: `generate_openapi`, `generate_changelog`, `generate_readme_skeleton`, `generate_adr`

Git: `commit_message`, `pr_description`, `branch_name`

Security/Encoding: `base64_encode_decode`, `jwt_decode`, `hash_generate`, `regex_test`, `secret_generate`

Misc: `cron_parse`, `timezone_convert`

**Total: 44 tool** dalam 10 kategori.
