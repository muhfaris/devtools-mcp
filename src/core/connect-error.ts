/**
 * A connection failure reduced to a shape that is safe to hand to an AI client.
 *
 * `providers_info` is the tool an agent reaches for when a provider will not connect, and
 * today it answers `healthy: false` and nothing else — a dead end that reads like a
 * network problem even when the cause is an untrusted certificate.
 *
 * The error contract in `docs/` is explicit, though: an arbitrary driver message must not
 * reach the client, because what a driver puts in `message` is whatever it was handed —
 * a host, a user, at worst a DSN. So this module *reads* arbitrary driver text and only
 * ever *emits* from its own closed vocabulary: a reason from a fixed union, a code narrow
 * enough to be safe, and a hint written here.
 */
export type ConnectionFailureReason =
  | "tls_certificate_untrusted"
  | "tls_handshake_failed"
  | "authentication_failed"
  | "host_not_found"
  | "connection_refused"
  | "connection_timeout"
  | "database_not_found"
  | "connection_failed";

export type ConnectionFailure = {
  reason: ConnectionFailureReason;
  /** The driver's code, or `null` when it was absent or not shaped like a code. */
  code: string | null;
  hint: string;
};

/** Driver codes that name one failure we can explain. Matched case-insensitively. */
const REASON_BY_CODE: Record<string, ConnectionFailureReason> = {
  // Node TLS: the server's chain leads to a CA this runtime does not trust.
  SELF_SIGNED_CERT_IN_CHAIN: "tls_certificate_untrusted",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls_certificate_untrusted",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls_certificate_untrusted",
  CERT_HAS_EXPIRED: "tls_certificate_untrusted",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls_certificate_untrusted",
  EPROTO: "tls_handshake_failed",
  ENOTFOUND: "host_not_found",
  EAI_AGAIN: "host_not_found",
  ECONNREFUSED: "connection_refused",
  ECONNRESET: "connection_failed",
  ETIMEDOUT: "connection_timeout",
  // PostgreSQL SQLSTATEs.
  "28P01": "authentication_failed",
  "28000": "authentication_failed",
  "3D000": "database_not_found",
  // MySQL/MariaDB error numbers, as mysql2 reports them.
  ER_ACCESS_DENIED_ERROR: "authentication_failed",
  ER_DBACCESS_DENIED_ERROR: "authentication_failed",
  ER_BAD_DB_ERROR: "database_not_found",
  ER_HOST_NOT_PRIVILEGED: "authentication_failed",
};

/**
 * Codes that are checked against the message instead, for the throwers that set no code:
 * `pg` times a connection out with a bare `new Error('timeout expired')`.
 *
 * The text is matched, never emitted — a match here only selects one of our own strings.
 */
const REASON_BY_MESSAGE: Array<[RegExp, ConnectionFailureReason]> = [
  [/^timeout (expired|exceeded when trying to connect)$/i, "connection_timeout"],
  [/self[- ]signed certificate/i, "tls_certificate_untrusted"],
  [/unable to verify/i, "tls_certificate_untrusted"],
  [/certificate has expired/i, "tls_certificate_untrusted"],
  [/altnames?/i, "tls_certificate_untrusted"],
];

const HINT_BY_REASON: Record<ConnectionFailureReason, string> = {
  tls_certificate_untrusted:
    "The server's TLS certificate is not trusted by this runtime. A managed endpoint signed by a private CA (Aiven, for one) needs that CA in `ssl.ca`, or `ssl.rejectUnauthorized: false` to connect without authenticating the server. A DSN `sslmode` cannot express a private CA.",
  tls_handshake_failed:
    "The TLS handshake failed before authentication. Check whether the server expects TLS at all, and whether the port or protocol is the right one.",
  authentication_failed:
    "The server refused the credentials. Re-check the user and password in the DSN, including any characters that need percent-encoding.",
  host_not_found:
    "The host did not resolve. Check the hostname in the DSN and the DNS of the machine running the server.",
  connection_refused:
    "Nothing accepted the connection on that host and port. Check that the server is running and listening on the address the DSN names.",
  connection_timeout:
    "The connection did not complete in time. A private endpoint that only accepts traffic from a known address is the usual cause.",
  database_not_found:
    "The server was reached but does not have that database. Check the database name at the end of the DSN.",
  connection_failed:
    "The driver reported a failure this build does not recognise, and it may have logged the underlying cause on stderr — ioredis, for one, rejects with a bare `Connection is closed.` and keeps the real DNS or socket error to itself. Reproduce with the same DSN or URL from the shell (`psql`, `mysql`, `redis-cli`) to see the full error.",
};

/** A driver code is a short enum-like token, never prose — and never a DSN. */
const CODE_PATTERN = /^[A-Za-z0-9_]{2,40}$/;

const safeCode = (value: unknown): string | null =>
  typeof value === "string" && CODE_PATTERN.test(value) ? value : null;

/**
 * The failure shape for a connection that was established but failed its probe: there is
 * no driver error to classify, and `healthy: false` alone is the dead end this module
 * exists to remove.
 */
export const healthProbeFailure = (): ConnectionFailure => ({
  reason: "connection_failed",
  code: null,
  hint: "The connection was established but the probe query failed. The server may be read-only, out of connections, or closing the session.",
});

/**
 * Classify a thrown connection error.
 *
 * The returned `hint` and `reason` come from this file; the driver's own message is read
 * for matching and then dropped, so nothing the driver wrote reaches the caller.
 */
export const classifyConnectionError = (error: unknown): ConnectionFailure => {
  const code = safeCode((error as { code?: unknown })?.code);
  const message =
    typeof (error as { message?: unknown })?.message === "string"
      ? (error as { message: string }).message
      : "";

  const byCode = code ? REASON_BY_CODE[code.toUpperCase()] : undefined;
  const byMessage = REASON_BY_MESSAGE.find(([pattern]) =>
    pattern.test(message),
  )?.[1];

  const reason: ConnectionFailureReason =
    byCode ?? byMessage ?? "connection_failed";

  return { reason, code, hint: HINT_BY_REASON[reason] };
};
