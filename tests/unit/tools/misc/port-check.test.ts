import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as net from "node:net";
import { portCheckTool } from "../../../../src/tools/misc/port-check.js";

describe("portCheckTool", () => {
  let server: net.Server;
  let testPort: number;

  beforeAll(async () => {
    // Start a dummy TCP server on random available port
    await new Promise<void>((resolve) => {
      server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        testPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("should detect open port on localhost", async () => {
    const result = await portCheckTool.execute({
      port: testPort,
      host: "127.0.0.1",
    });

    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.port).toBe(testPort);
    expect(data.open).toBe(true);
    expect(data.state).toBe("open");
    expect(data.latency_ms).toBeDefined();
  });

  it("should detect closed port", async () => {
    // Port 65534 is almost certainly free/closed
    const result = await portCheckTool.execute({
      port: 65534,
      host: "127.0.0.1",
      timeout: 200,
    });

    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.port).toBe(65534);
    expect(data.open).toBe(false);
    expect(data.state).toBe("closed");
  });

  it("should handle multiple ports query", async () => {
    const result = await portCheckTool.execute({
      ports: `${testPort},65534`,
      host: "127.0.0.1",
      timeout: 200,
    });

    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.summary).toBeDefined();
    expect(data.summary.total).toBe(2);
    expect(data.summary.open).toBe(1);
    expect(data.summary.closed).toBe(1);
    expect(data.results).toHaveLength(2);
  });

  it("should throw error if no valid ports provided", async () => {
    await expect(portCheckTool.execute({})).rejects.toThrow(
      "Must provide at least one valid port number",
    );
  });
});
