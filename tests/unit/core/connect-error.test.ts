import { describe, expect, it } from "vitest";
import {
  classifyConnectionError,
  healthProbeFailure,
} from "../../../src/core/connect-error.js";

describe("classifyConnectionError", () => {
  it("explains an untrusted private CA as a TLS problem", () => {
    const failure = classifyConnectionError(
      Object.assign(new Error("self-signed certificate in certificate chain"), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      }),
    );

    expect(failure.reason).toBe("tls_certificate_untrusted");
    expect(failure.code).toBe("SELF_SIGNED_CERT_IN_CHAIN");
    // The hint has to point at the fix, not just name the problem.
    expect(failure.hint).toContain("ssl.ca");
  });

  it.each([
    ["ECONNREFUSED", "connection_refused"],
    ["ENOTFOUND", "host_not_found"],
    ["EAI_AGAIN", "host_not_found"],
    ["ETIMEDOUT", "connection_timeout"],
    ["28P01", "authentication_failed"],
    ["28000", "authentication_failed"],
    ["3D000", "database_not_found"],
    ["ER_ACCESS_DENIED_ERROR", "authentication_failed"],
    ["ER_BAD_DB_ERROR", "database_not_found"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_certificate_untrusted"],
    ["EPROTO", "tls_handshake_failed"],
  ])("maps driver code %s to %s", (code, reason) => {
    const failure = classifyConnectionError(
      Object.assign(new Error("irrelevant"), { code }),
    );
    expect(failure.reason).toBe(reason);
    expect(failure.code).toBe(code);
  });

  it("classifies the code-less timeout node-postgres throws", () => {
    // pg times a connection out with a bare `new Error('timeout expired')`, so the code
    // lookup finds nothing and the message is the only signal there is.
    expect(classifyConnectionError(new Error("timeout expired")).reason).toBe(
      "connection_timeout",
    );
    expect(
      classifyConnectionError(
        new Error("timeout exceeded when trying to connect"),
      ).reason,
    ).toBe("connection_timeout");
  });

  it("falls back without echoing anything the driver wrote", () => {
    const failure = classifyConnectionError(
      new Error("auth failed for postgres://admin:hunter2@db.internal/app"),
    );

    expect(failure.reason).toBe("connection_failed");
    expect(JSON.stringify(failure)).not.toMatch(/hunter2|db\.internal|admin/);
  });

  it("refuses a code that is not shaped like a code", () => {
    // A `code` is set by whoever threw, so it can carry anything — including a DSN.
    const failure = classifyConnectionError(
      Object.assign(new Error("x"), {
        code: "postgres://admin:hunter2@db.internal/app",
      }),
    );

    expect(failure.code).toBeNull();
    expect(JSON.stringify(failure)).not.toMatch(/hunter2/);
  });

  it.each([["boom"], [undefined], [null], [{ code: 42 }]])(
    "survives a thrown non-Error (%s)",
    (thrown) => {
      const failure = classifyConnectionError(thrown);
      expect(failure.reason).toBe("connection_failed");
      expect(failure.code).toBeNull();
      expect(failure.hint).toBeTruthy();
    },
  );
});

describe("healthProbeFailure", () => {
  it("gives a reason for a connection that established but failed its probe", () => {
    const failure = healthProbeFailure();
    expect(failure.reason).toBe("connection_failed");
    expect(failure.code).toBeNull();
    expect(failure.hint).toContain("probe");
  });
});
