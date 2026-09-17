import { existsSync } from "fs";
import type { Config } from "./types.js";
import { getConfigPath, loadConfig, reloadConfig } from "./config.js";

export type ConfigRuntimeState = {
  status: "not_loaded" | "loaded" | "reload_failed";
  loadedAt: string | null;
  lastReloadAttemptAt: string | null;
  lastReloadedAt: string | null;
  reloadError: string | null;
};

const state: ConfigRuntimeState = {
  status: "not_loaded",
  loadedAt: null,
  lastReloadAttemptAt: null,
  lastReloadedAt: null,
  reloadError: null,
};

const now = () => new Date().toISOString();

export const applyRuntimeConfig = (config: Config, reloaded = false) => {
  (global as any).__devtools_config = config;

  const timestamp = now();
  state.status = "loaded";
  state.loadedAt ??= timestamp;
  state.reloadError = null;
  if (reloaded) state.lastReloadedAt = timestamp;
};

export const reloadRuntimeConfig = async (): Promise<Config> => {
  state.lastReloadAttemptAt = now();

  try {
    const configPath = getConfigPath();
    if (configPath && existsSync(configPath)) {
      const config = await reloadConfig();
      applyRuntimeConfig(config, true);
      return config;
    }

    // No path was recorded at boot, or the file was removed under us. Re-run
    // discovery so a config created after startup is picked up; `loadConfig`
    // records the new path as a side effect.
    const config = await loadConfig();
    if (!getConfigPath()) {
      throw new Error("No loaded .devtools/config.yaml file to reload");
    }
    applyRuntimeConfig(config, true);
    return config;
  } catch (error: any) {
    state.status = "reload_failed";
    state.reloadError = error.message;
    throw error;
  }
};

export const getConfigRuntimeState = (): ConfigRuntimeState => ({ ...state });

export const resetConfigRuntimeState = () => {
  state.status = "not_loaded";
  state.loadedAt = null;
  state.lastReloadAttemptAt = null;
  state.lastReloadedAt = null;
  state.reloadError = null;
};
