import { reloadRuntimeConfig } from "../../core/runtime-config.js";
import { startConfigWatcher } from "../../core/config-watch.js";
import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getSafeConfigView } from "./show.js";

export const reloadConfigTool: Tool = {
  name: "reload_config",
  description:
    "Reload .devtools/config.yaml, replace session overrides, and show the effective configuration",
  execute: async () => {
    let config;
    try {
      config = await reloadRuntimeConfig();
    } catch (error: unknown) {
      throw new ToolError(
        "CONFIG_RELOAD_FAILED",
        "Configuration reload failed; the previous valid runtime configuration remains active.",
        "Correct .devtools/config.yaml, then retry reload_config.",
        true,
        { configKey: ".devtools/config.yaml", cause: error },
      );
    }

    // A config discovered by this reload may not have existed at boot, so make sure
    // the watcher is pointed at it before returning.
    startConfigWatcher();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              data: { reloaded: true, ...getSafeConfigView(config) },
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
