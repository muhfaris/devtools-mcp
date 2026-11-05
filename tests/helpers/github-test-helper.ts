import { vi } from "vitest";
import type { Config } from "../../src/core/types.js";

export type StubbedResponse = {
  body?: unknown;
  text?: string;
  status?: number;
  headers?: Record<string, string>;
};

/**
 * A `fetch` stub that answers from a queue, in call order.
 *
 * Every GitHub tool is one or a few REST calls, so a queue keeps each test honest about
 * how many calls it takes and in what order — a route matcher would hide a tool that
 * started calling an endpoint it did not before.
 */
export const mockFetch = () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const queue: StubbedResponse[] = [];

  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${String(input)}`);
    const headers = new Headers(next.headers ?? {});
    const status = next.status ?? 200;
    // 204/205/304 may not carry a body; the Response constructor refuses one.
    if (status === 204 || status === 205 || status === 304) {
      return new Response(null, { status, headers });
    }
    if (next.text !== undefined) {
      return new Response(next.text, { status, headers });
    }
    return new Response(JSON.stringify(next.body ?? null), {
      status,
      headers: {
        "content-type": "application/json",
        ...(next.headers ?? {}),
      },
    });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    calls,
    enqueue: (...responses: StubbedResponse[]) => queue.push(...responses),
    restore: () => vi.unstubAllGlobals(),
  };
};

export const githubProviderConfig = (
  github: Record<string, unknown> = {},
): Config => ({
  providers: {
    github: {
      url: "https://github.com",
      token: "ghp_test",
      repo: "acme/widget",
      ...github,
    },
  },
});

/** Put a config where the tools read it, and tear the cached client down after. */
export const useGitHubConfig = (
  github: Record<string, unknown> = {},
): Config => {
  const config = githubProviderConfig(github);
  (global as any).__devtools_config = config;
  return config;
};

export const headerOf = (init: RequestInit, name: string): string | undefined => {
  const headers = new Headers(init.headers ?? {});
  return headers.get(name) ?? undefined;
};
