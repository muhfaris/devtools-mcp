import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeWatcher = () => ({ close: vi.fn(), unref: vi.fn() });

vi.mock("fs", () => ({ watch: vi.fn() }));
vi.mock("../../../src/core/config.js", () => ({ getConfigPath: vi.fn() }));
vi.mock("../../../src/core/runtime-config.js", () => ({
  reloadRuntimeConfig: vi.fn(),
}));

import { watch } from "fs";
import { getConfigPath } from "../../../src/core/config.js";
import { reloadRuntimeConfig } from "../../../src/core/runtime-config.js";
import {
  getWatchedConfigPath,
  startConfigWatcher,
  stopConfigWatcher,
} from "../../../src/core/config-watch.js";

const mockWatch = watch as unknown as ReturnType<typeof vi.fn>;
const mockGetConfigPath = getConfigPath as unknown as ReturnType<typeof vi.fn>;
const mockReload = reloadRuntimeConfig as unknown as ReturnType<typeof vi.fn>;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockWatch.mockReset();
  mockGetConfigPath.mockReset();
  mockReload.mockReset().mockResolvedValue({});
  mockWatch.mockImplementation(() => fakeWatcher());
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  stopConfigWatcher();
  warn.mockRestore();
  vi.useRealTimers();
});

describe("startConfigWatcher", () => {
  it("does nothing when no config path is known", () => {
    mockGetConfigPath.mockReturnValue(null);

    expect(startConfigWatcher()).toBe(false);
    expect(mockWatch).not.toHaveBeenCalled();
    expect(getWatchedConfigPath()).toBeNull();
  });

  it("watches the containing directory and unrefs the watcher", () => {
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");

    expect(startConfigWatcher()).toBe(true);

    const watcher = mockWatch.mock.results[0].value;
    // The directory, not the file: a file watch follows the inode and dies on a
    // rename-replace save.
    expect(mockWatch).toHaveBeenCalledWith(
      "/project/.devtools",
      expect.any(Function),
    );
    // unref matters: a referenced watcher keeps one-shot CLI commands alive forever.
    expect(watcher.unref).toHaveBeenCalledOnce();
    expect(getWatchedConfigPath()).toBe("/project/.devtools/config.yaml");
  });

  it("ignores events for sibling files in the config directory", async () => {
    vi.useFakeTimers();
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    startConfigWatcher();

    const onChange = mockWatch.mock.calls[0][1];
    onChange("change", "notes.md");
    onChange("rename", "other.yaml");
    await vi.advanceTimersByTimeAsync(250);

    expect(mockReload).not.toHaveBeenCalled();
  });

  it("reloads on a config rename, which is how an atomic save looks", async () => {
    vi.useFakeTimers();
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    startConfigWatcher();

    mockWatch.mock.calls[0][1]("rename", "config.yaml");
    await vi.advanceTimersByTimeAsync(250);

    expect(mockReload).toHaveBeenCalledOnce();
  });

  it("reloads when the platform reports no filename", async () => {
    vi.useFakeTimers();
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    startConfigWatcher();

    mockWatch.mock.calls[0][1]("change", null);
    await vi.advanceTimersByTimeAsync(250);

    expect(mockReload).toHaveBeenCalledOnce();
  });

  it("is idempotent for the same path", () => {
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");

    startConfigWatcher();
    startConfigWatcher();

    expect(mockWatch).toHaveBeenCalledOnce();
  });

  it("re-arms when the resolved path changes", () => {
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    startConfigWatcher();
    const first = mockWatch.mock.results[0].value;

    mockGetConfigPath.mockReturnValue("/other/.devtools/config.yaml");
    startConfigWatcher();

    expect(first.close).toHaveBeenCalledOnce();
    expect(mockWatch).toHaveBeenCalledTimes(2);
    expect(getWatchedConfigPath()).toBe("/other/.devtools/config.yaml");
  });

  it("reloads once per burst of change events", async () => {
    vi.useFakeTimers();
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    startConfigWatcher();

    const onChange = mockWatch.mock.calls[0][1];
    onChange();
    onChange();
    onChange();
    expect(mockReload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(mockReload).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("🔄 .devtools/config.yaml reloaded");
  });

  it("logs a failed reload without throwing", async () => {
    vi.useFakeTimers();
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    mockReload.mockRejectedValue(new Error("bad yaml"));
    startConfigWatcher();

    mockWatch.mock.calls[0][1]();
    await vi.advanceTimersByTimeAsync(250);

    expect(warn).toHaveBeenCalledWith("⚠️ Config reload failed:", "bad yaml");
  });
});

describe("stopConfigWatcher", () => {
  it("closes the watcher and forgets the path", () => {
    mockGetConfigPath.mockReturnValue("/project/.devtools/config.yaml");
    startConfigWatcher();
    const watcher = mockWatch.mock.results[0].value;

    stopConfigWatcher();

    expect(watcher.close).toHaveBeenCalledOnce();
    expect(getWatchedConfigPath()).toBeNull();
  });

  it("is safe when nothing is being watched", () => {
    expect(() => stopConfigWatcher()).not.toThrow();
  });
});
