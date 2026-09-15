import * as net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "../../core/types.js";

const execFileAsync = promisify(execFile);

interface ProcessInfo {
  pid: number;
  name?: string;
  command?: string;
  user?: string;
}

interface PortCheckResult {
  host: string;
  port: number;
  open: boolean;
  state: "open" | "closed" | "timeout";
  latency_ms?: number;
  process?: ProcessInfo | null;
  error?: string;
}

function isLocal(host: string): boolean {
  const normalized = host.toLowerCase().trim();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
  );
}

/**
 * Check TCP connection to host:port.
 */
function probePort(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ open: boolean; state: "open" | "closed" | "timeout"; latencyMs?: number; error?: string }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();

    let resolved = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      if (resolved) return;
      resolved = true;
      const latencyMs = Number((performance.now() - start).toFixed(2));
      cleanup();
      resolve({ open: true, state: "open", latencyMs });
    });

    socket.once("timeout", () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ open: false, state: "timeout", error: "ETIMEDOUT" });
    });

    socket.once("error", (err: any) => {
      if (resolved) return;
      resolved = true;
      const errorCode = err.code || err.message || "ECONNREFUSED";
      cleanup();
      resolve({ open: false, state: "closed", error: errorCode });
    });

    socket.connect(port, host);
  });
}

/**
 * Attempt to inspect process details (PID, command) on local machine for a given port.
 */
async function inspectLocalProcess(port: number): Promise<ProcessInfo | null> {
  // Strategy 1: Try `lsof` (standard on macOS & Linux)
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-iTCP:" + port,
      "-sTCP:LISTEN",
      "-P",
      "-n",
      "-F",
      "pcn",
    ], { timeout: 1500 });

    if (stdout) {
      let pid: number | undefined;
      let name: string | undefined;

      const lines = stdout.split("\n");
      for (const line of lines) {
        if (line.startsWith("p")) {
          const parsedPid = parseInt(line.substring(1), 10);
          if (!isNaN(parsedPid)) pid = parsedPid;
        } else if (line.startsWith("c") && !name) {
          name = line.substring(1).trim();
        }
      }

      if (pid) {
        return { pid, name: name || undefined };
      }
    }
  } catch {
    // lsof might fail or not be installed, proceed to ss
  }

  // Strategy 2: Try `ss` (standard on modern Linux)
  try {
    const { stdout } = await execFileAsync("ss", [
      "-tlpn",
      `sport = :${port}`,
    ], { timeout: 1500 });

    if (stdout) {
      // ss output format example: users:(("node",pid=12345,fd=19))
      const match = stdout.match(/users:\(\("([^"]+)",pid=(\d+)/);
      if (match) {
        return {
          pid: parseInt(match[2], 10),
          name: match[1],
        };
      }
    }
  } catch {
    // ss not available
  }

  // Strategy 3: Try `fuser` (Linux fallback)
  try {
    const { stdout } = await execFileAsync("fuser", [`${port}/tcp`], {
      timeout: 1500,
    });
    const pids = stdout.trim().split(/\s+/).filter(Boolean);
    if (pids.length > 0) {
      const parsedPid = parseInt(pids[0], 10);
      if (!isNaN(parsedPid)) {
        return { pid: parsedPid };
      }
    }
  } catch {
    // fuser not available
  }

  return null;
}

export const portCheckTool: Tool = {
  name: "port_check",
  description:
    "Check if TCP ports are open/listening and discover listening process details (PID, process name) on local machine.",
  params: {
    port: {
      type: "number",
      optional: true,
      description: "Port number to check (e.g., 3000, 5432)",
    },
    ports: {
      type: "string",
      optional: true,
      description: "Comma-separated list of port numbers (e.g. '3000,5432,6379')",
    },
    host: {
      type: "string",
      optional: true,
      description: "Target host (default: '127.0.0.1')",
      default: "127.0.0.1",
    },
    timeout: {
      type: "number",
      optional: true,
      description: "Connection timeout in ms (default: 1000)",
      default: 1000,
    },
  },
  execute: async (params) => {
    const host = params.host || "127.0.0.1";
    const timeout = typeof params.timeout === "number" && params.timeout > 0 ? params.timeout : 1000;

    let portList: number[] = [];

    if (typeof params.port === "number" && !isNaN(params.port)) {
      portList.push(params.port);
    }

    if (params.ports) {
      const parsed = String(params.ports)
        .split(",")
        .map((p) => parseInt(p.trim(), 10))
        .filter((p) => !isNaN(p) && p > 0 && p <= 65535);
      portList.push(...parsed);
    }

    // Deduplicate
    portList = Array.from(new Set(portList));

    if (portList.length === 0) {
      throw new Error("Must provide at least one valid port number via 'port' or 'ports'.");
    }

    const local = isLocal(host);

    const results: PortCheckResult[] = await Promise.all(
      portList.map(async (port): Promise<PortCheckResult> => {
        const probe = await probePort(host, port, timeout);
        let procInfo: ProcessInfo | null = null;

        if (probe.open && local) {
          procInfo = await inspectLocalProcess(port);
        }

        return {
          host,
          port,
          open: probe.open,
          state: probe.state,
          latency_ms: probe.latencyMs,
          process: procInfo,
          ...(probe.error ? { error: probe.error } : {}),
        };
      }),
    );

    if (results.length === 1) {
      return {
        content: [{ type: "text", text: JSON.stringify(results[0], null, 2) }],
      };
    }

    const openCount = results.filter((r) => r.open).length;
    const responsePayload = {
      summary: {
        total: results.length,
        open: openCount,
        closed: results.length - openCount,
      },
      results,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(responsePayload, null, 2) }],
    };
  },
};
