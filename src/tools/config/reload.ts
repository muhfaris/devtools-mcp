import { reloadRuntimeConfig } from "../../core/runtime-config.js";
import type { Tool } from "../../core/types.js";
import { getSafeConfigView } from "./show.js";

export const reloadConfigTool: Tool = {
  name: "reload_config",
  description:
    "Reload .devtools/config.yaml, replace session overrides, and show the effective configuration",
  execute: async () => {
    const config = await reloadRuntimeConfig();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { reloaded: true, ...getSafeConfigView(config) },
            null,
            2,
          ),
        },
      ],
    };
  },
};
