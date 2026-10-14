import { readFileSync } from "node:fs";
import type { ConnectionTlsConfig } from "../core/types.js";

/** How long to wait for a connection to be established, when the config does not say. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

/**
 * Build the driver's `ssl` option from a connection's `ssl` block.
 *
 * The files are read here rather than at config-load time for two reasons: a rotated
 * certificate is picked up by the next connection instead of resting in memory for the
 * life of the server, and `show_config` can report the *path* while never holding the
 * contents — the same reason a token is stored as a `cmd:` rather than inline.
 *
 * Returns `undefined` when the connection declares no `ssl` block, which is what tells
 * the caller to let the DSN (or the driver default) govern TLS.
 */
export const buildTlsOptions = (
  tls: ConnectionTlsConfig | undefined,
): Record<string, unknown> | undefined => {
  if (!tls) return undefined;

  const ssl: Record<string, unknown> = {};
  if (tls.ca) ssl.ca = readFileSync(tls.ca, "utf-8");
  if (tls.cert) ssl.cert = readFileSync(tls.cert, "utf-8");
  if (tls.key) ssl.key = readFileSync(tls.key, "utf-8");
  if (tls.rejectUnauthorized !== undefined) {
    ssl.rejectUnauthorized = tls.rejectUnauthorized;
  }

  return ssl;
};

/** TLS parameters a DSN may carry, all of which the `ssl` block supersedes. */
const DSN_TLS_PARAM = /[?&](?:ssl|uselibpqcompat)/i;

/**
 * Remove TLS parameters from a DSN.
 *
 * `pg` merges the connection string *over* the options object
 * (`Object.assign({}, config, parse(connectionString))`), so a `sslmode` left in the DSN
 * silently wins and the explicit `ssl` block is discarded — the opposite of every other
 * setting here. Stripping them is what makes `ssl` authoritative.
 *
 * A DSN carrying no TLS parameters is returned untouched, so nothing is re-encoded by
 * `URL` on the common path.
 */
export const stripTlsParams = (dsn: string): string => {
  if (!DSN_TLS_PARAM.test(dsn)) return dsn;

  try {
    const url = new URL(dsn);
    for (const key of [...url.searchParams.keys()]) {
      if (/^ssl/i.test(key) || key.toLowerCase() === "uselibpqcompat") {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    // A DSN `URL` cannot parse is left alone: a driver-side error naming it is more
    // useful than a mangled string.
    return dsn;
  }
};
