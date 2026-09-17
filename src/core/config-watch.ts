import { watch, type FSWatcher } from "fs";
import { basename, dirname } from "path";
import { getConfigPath } from "./config.js";
import { reloadRuntimeConfig } from "./runtime-config.js";

const DEBOUNCE_MS = 200;

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * Arm the config watcher for the currently resolved path.
 *
 * Idempotent: re-arming the same path is a no-op, and a config discovered *after*
 * boot — or moved by a later reload — is picked up on the next call. Callers that
 * create or discover a config (the `reload_config` and `config_init` tools) therefore
 * keep the watcher pointing at the right file.
 *
 * The watcher is `unref()`ed so it can never hold the event loop open: the MCP server
 * owns the loop, and one-shot CLI commands must be able to exit.
 *
 * Returns true when a path is being watched.
 */
/**
 * Whether a directory event concerns the watched config file.
 *
 * `filename` is null on some platforms and for some event types, in which case we
 * reload conservatively — the debounce makes that cheap.
 */
const isConfigEvent = (path: string, filename: string | Buffer | null): boolean =>
  filename === null || filename === undefined
    ? true
    : String(filename) === basename(path);

const scheduleReload = (): void => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await reloadRuntimeConfig();
      console.warn("🔄 .devtools/config.yaml reloaded");
    } catch (error: any) {
      console.warn("⚠️ Config reload failed:", error.message);
    }
  }, DEBOUNCE_MS);
};

export const startConfigWatcher = (): boolean => {
  const path = getConfigPath();
  if (!path) return false;
  if (path === watchedPath) return true;

  watcher?.close();
  watchedPath = path;
  // Watch the containing directory rather than the file itself: `fs.watch` on a file
  // follows the inode, so a rename-replace save (vim with backupcopy=no, several IDEs)
  // leaves the watcher attached to the old inode and live reload silently stops for the
  // rest of the session. A directory watch survives the replacement.
  watcher = watch(dirname(path), (_event, filename) => {
    if (isConfigEvent(path, filename)) scheduleReload();
  });
  watcher.unref();
  return true;
};

export const stopConfigWatcher = (): void => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  watcher?.close();
  watcher = null;
  watchedPath = null;
};

/** The path currently being watched, or null. Exposed for tests. */
export const getWatchedConfigPath = (): string | null => watchedPath;
