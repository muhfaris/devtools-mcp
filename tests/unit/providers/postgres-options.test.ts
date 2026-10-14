import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildPoolOptions } from "../../../src/providers/postgres.js";
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  stripTlsParams,
} from "../../../src/providers/tls.js";

const dir = mkdtempSync(join(tmpdir(), "devtools-tls-"));
const caPath = join(dir, "ca.pem");
const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
writeFileSync(caPath, CA_PEM);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const AIVEN_DSN =
  "postgres://user:pass@db.example.com:12273/v1_db?sslmode=require";

describe("buildPoolOptions", () => {
  it("bounds the wait for a connection", () => {
    // node-postgres defaults connectionTimeoutMillis to 0, which means a host that
    // accepts TCP and then stalls holds the tool open forever.
    expect(
      buildPoolOptions({ dsn: AIVEN_DSN }).connectionTimeoutMillis,
    ).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
    expect(
      buildPoolOptions({ dsn: AIVEN_DSN, connect_timeout: 2500 })
        .connectionTimeoutMillis,
    ).toBe(2500);
  });

  it("passes no ssl option when the connection declares none", () => {
    const options = buildPoolOptions({ dsn: AIVEN_DSN });

    expect("ssl" in options).toBe(false);
    // The DSN is left exactly as configured, so the driver stays in charge of TLS.
    expect(options.connectionString).toBe(AIVEN_DSN);
  });

  it("makes an explicit ssl block authoritative over the DSN", () => {
    const options = buildPoolOptions({ dsn: AIVEN_DSN, ssl: { ca: caPath } });

    // `pg` merges the connection string *over* the options object, so a `sslmode` left in
    // the DSN would discard this block. It has to be gone for the CA to take effect.
    expect(options.connectionString).not.toContain("sslmode");
    expect(options.connectionString).toContain("db.example.com");
    expect((options.ssl as any).ca).toBe(CA_PEM);
    expect("rejectUnauthorized" in (options.ssl as any)).toBe(false);
  });

  it("carries an explicit rejectUnauthorized through", () => {
    const options = buildPoolOptions({
      dsn: AIVEN_DSN,
      ssl: { rejectUnauthorized: false },
    });

    expect((options.ssl as any).rejectUnauthorized).toBe(false);
  });

  it("keeps pool size and idle timeout", () => {
    const options = buildPoolOptions({
      dsn: AIVEN_DSN,
      pool_size: 3,
      timeout: 1234,
    });

    expect(options.max).toBe(3);
    expect(options.idleTimeoutMillis).toBe(1234);
  });
});

describe("stripTlsParams", () => {
  it("returns a DSN with no TLS parameters untouched", () => {
    const dsn = "postgresql://user:pass@127.0.0.1:5433/app?application_name=devtools";
    expect(stripTlsParams(dsn)).toBe(dsn);
  });

  it("removes sslmode, the other ssl parameters, and uselibpqcompat", () => {
    const stripped = stripTlsParams(
      "postgres://user:pass@host:5432/db?sslmode=require&sslrootcert=/etc/ca.pem&uselibpqcompat=true&application_name=x",
    );

    expect(stripped).not.toMatch(/sslmode|sslrootcert|uselibpqcompat/);
    expect(stripped).toContain("application_name=x");
  });

  it("leaves an unparseable DSN alone rather than mangling it", () => {
    const dsn = "not a dsn?sslmode=require";
    expect(stripTlsParams(dsn)).toBe(dsn);
  });
});
