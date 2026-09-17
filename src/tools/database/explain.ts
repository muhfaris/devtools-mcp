import { Tool } from "../../core/types.js";
import { createProvider } from "../../providers/index.js";
import { getProviderConfig } from "../../core/provider-config.js";
import { isProviderEnabled } from "../../core/security.js";
import {
  databaseRequestError,
  requireDatabaseConnection,
  requireQuery,
} from "./errors.js";

export const explainQueryTool: Tool = {
  name: "explain_query",
  description:
    "Run EXPLAIN ANALYZE on a query and get a plain-English performance summary",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection",
    },
    query: {
      type: "string",
      description: "SQL query to explain (SELECT, INSERT, UPDATE, DELETE)",
    },
    analyze: {
      type: "boolean",
      optional: true,
      description: "Run ANALYZE for actual execution stats (default: true)",
      default: true,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    if (!isProviderEnabled(config, "database")) {
      throw new Error(
        "Database provider is disabled in configuration. Enable providers.database.enabled in .devtools/config.yaml.",
      );
    }
    const { connectionName, connection: connConfig } =
      requireDatabaseConnection(config, params.connection);

    const query = requireQuery(params.query);

    const engine =
      getProviderConfig(config, "database")?.default_engine ?? "postgresql";
    const provider = createProvider(engine);

    try {
      await provider.connect(connConfig);
      const explainResult = await provider.explainQuery(query);
      await provider.disconnect();

      // Format the result
      let formatted: any;
      if (engine === "postgresql") {
        // PostgreSQL returns array of plans
        const plan = Array.isArray(explainResult)
          ? explainResult[0]
          : explainResult;
        formatted = {
          plan: plan,
          summary: extractPostgresSummary(plan),
        };
      } else {
        // MySQL
        formatted = {
          plan: explainResult,
          summary: extractMySQLSummary(explainResult),
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
      };
    } catch (error: any) {
      await provider.disconnect().catch(() => {});
      throw databaseRequestError("explain the query", error);
    }
  },
};

function extractPostgresSummary(plan: any): string {
  if (!plan) return "No plan available";
  const node = plan["Plan"] || plan;
  const cost = node["Total Cost"] || "unknown";
  const rows = node["Plan Rows"] || "unknown";
  const width = node["Plan Width"] || "unknown";
  const actualRows = node["Actual Rows"] || "unknown";
  const actualTime = node["Actual Total Time"] || "unknown";

  return `PostgreSQL Execution Plan:
- Total Cost: ${cost}
- Estimated Rows: ${rows}
- Actual Rows: ${actualRows}
- Actual Time: ${actualTime}ms
- Width: ${width} bytes
${node["Node Type"] ? `- Node Type: ${node["Node Type"]}` : ""}
${node["Join Type"] ? `- Join Type: ${node["Join Type"]}` : ""}
${node["Index Name"] ? `- Index: ${node["Index Name"]}` : ""}`;
}

function extractMySQLSummary(plan: any): string {
  if (!plan) return "No plan available";
  const rows = Array.isArray(plan) ? plan : [plan];
  const first = rows[0] || {};

  return `MySQL Execution Plan:
- id: ${first.id || "unknown"}
- select_type: ${first.select_type || "unknown"}
- table: ${first.table || "unknown"}
- type: ${first.type || "unknown"}
- possible_keys: ${first.possible_keys || "none"}
- key: ${first.key || "none"}
- key_len: ${first.key_len || "unknown"}
- ref: ${first.ref || "none"}
- rows: ${first.rows || "unknown"}
- Extra: ${first.Extra || "none"}`;
}
