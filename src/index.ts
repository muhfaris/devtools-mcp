#!/usr/bin/env node
import { program } from "commander";
import { loadConfig } from "./core/config.js";
import { createRegistry, registerAllTools } from "./tools/index.js";
import { startMcpServer } from "./mcp/server.js";
import { applyRuntimeConfig } from "./core/runtime-config.js";
import { startConfigWatcher } from "./core/config-watch.js";
import { VERSION } from "./core/version.js";

const applyConfig = (config: any) => applyRuntimeConfig(config);

const main = async () => {
  const config = await loadConfig();
  applyConfig(config);

  const registry = createRegistry();
  await registerAllTools(registry, config);

  if (process.argv.length > 2) {
    program.name("devtools").description("DevTools CLI").version(VERSION);

    for (const tool of registry.list()) {
      const cmd = program
        .command(tool.name)
        .description(tool.description || "");

      if (tool.params) {
        for (const [key, schema] of Object.entries(tool.params)) {
          const needsValue =
            schema.type === "string" || schema.type === "number";
          // A boolean that defaults to true is already on; a bare `--key` flag could
          // only turn it on again. Commander's negation form is the only way to say
          // "off", and it also supplies the default, so no separate default is passed.
          const defaultsOn = schema.type === "boolean" && schema.default === true;
          const flag = needsValue
            ? `--${key} <${key}>`
            : defaultsOn
              ? `--no-${key}`
              : `--${key}`;
          const description = defaultsOn
            ? `${schema.description || key} Pass --no-${key} to turn it off.`
            : schema.description || key;
          cmd.option(flag, description);
        }
      }

      cmd.action(async (opts) => {
        try {
          const result = await registry.execute(tool.name, opts);
          console.log(
            result.content?.[0]?.text || JSON.stringify(result, null, 2),
          );
        } catch (error: any) {
          console.error("❌", error.message);
          process.exit(1);
        }
      });
    }

    await program.parseAsync(process.argv);
  } else {
    // The watcher only matters for the long-running MCP server.
    startConfigWatcher();
    await startMcpServer(registry);
  }
};

main().catch(console.error);
