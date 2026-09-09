#!/usr/bin/env node
import { program } from "commander";
import { watch } from "fs";
import { loadConfig, getConfigPath } from "./core/config.js";
import { createRegistry, registerAllTools } from "./tools/index.js";
import { startMcpServer } from "./mcp/server.js";
import {
  applyRuntimeConfig,
  reloadRuntimeConfig,
} from "./core/runtime-config.js";

const applyConfig = (config: any) => applyRuntimeConfig(config);

const startWatcher = () => {
  const path = getConfigPath();
  if (!path) return;
  let timer: NodeJS.Timeout | null = null;
  watch(path, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await reloadRuntimeConfig();
        console.warn("🔄 .devtools/config.yaml reloaded");
      } catch (error: any) {
        console.warn("⚠️ Config reload failed:", error.message);
      }
    }, 200);
  });
};

const main = async () => {
  const config = await loadConfig();
  applyConfig(config);
  startWatcher();

  const registry = createRegistry();
  await registerAllTools(registry, config);

  if (process.argv.length > 2) {
    program.name("devtools").description("DevTools CLI").version("0.1.0");

    for (const tool of registry.list()) {
      const cmd = program
        .command(tool.name)
        .description(tool.description || "");

      if (tool.params) {
        for (const [key, schema] of Object.entries(tool.params)) {
          const needsValue =
            schema.type === "string" || schema.type === "number";
          const flag = needsValue ? `--${key} <${key}>` : `--${key}`;
          cmd.option(flag, schema.description || key);
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
    await startMcpServer(registry);
  }
};

main().catch(console.error);
