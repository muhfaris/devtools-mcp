import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient, pageIsFull, pageSize } from "../../providers/github.js";
import type { GitHubCodeSearchItem } from "../../providers/github-types.js";
import { assertGitHubReadable } from "./guard.js";

type CodeSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubCodeSearchItem[];
};

export const githubSearchCodeTool: Tool = {
  name: "github_search_code",
  description:
    "Search for code, function definitions, symbols, or text across a GitHub repository (equivalent to remote 'git grep'). GitHub's code search indexes the repository's default branch only, caps results at 1000, and needs a token with repository read access. `incompleteResults: true` means GitHub timed out and the list is partial.",
  params: {
    repo: {
      type: "string",
      optional: true,
      description:
        "Repository as 'owner/name'. Overrides providers.github.repo.",
    },
    search: {
      type: "string",
      description:
        "Search term, function name, or symbol to find across repository files",
    },
    page: {
      type: "number",
      optional: true,
      description: "Page number for pagination (default: 1)",
      default: 1,
    },
    per_page: {
      type: "number",
      optional: true,
      description: "Maximum search results to return (default: 20, max: 100)",
      default: 20,
    },
  },
  execute: async (params) => {
    const { repo } = assertGitHubReadable(params);

    const searchTerm = String(params.search || "").trim();
    if (!searchTerm) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A search term is required.",
        "Provide a query string in 'search', then retry.",
        true,
        { parameter: "search" },
      );
    }

    const client = getGitHubClient();
    const perPage = pageSize(params.per_page ?? 20);
    const page = Math.max(Number(params.page) || 1, 1);

    try {
      const response = await client.request<CodeSearchResponse>({
        path: `/search/code`,
        query: {
          // The repository qualifier is what restricts the search; code search is
          // otherwise account-wide and ignores a repo path in the URL.
          q: `${searchTerm} repo:${repo}`,
          per_page: perPage,
          page,
        },
        accept: "application/vnd.github.text-match+json",
      });

      const items = (response.items ?? []).map((item) => ({
        name: item.name,
        path: item.path,
        sha: item.sha,
        url: item.html_url,
        // Fragments carry the surrounding line and the indices of the match, which is
        // the difference between a path to open and a hit to read.
        matches: (item.text_matches ?? []).map((match) => ({
          fragment: match.fragment,
          texts: (match.matches ?? []).map((entry) => entry.text),
        })),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                repo,
                search: searchTerm,
                page,
                perPage,
                totalCount: response.total_count,
                incompleteResults: response.incomplete_results === true,
                // GitHub fills a page only when more matches exist, so a full page means
                // this is not the end of them.
                truncated: pageIsFull(items.length, perPage),
                totalFound: items.length,
                results: items,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError(`search code for '${searchTerm}'`, error);
    }
  },
};
