import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient } from "../../providers/github.js";
import { assertGitHubReadable } from "./guard.js";

export const githubGetFileTool: Tool = {
  name: "github_get_file",
  description:
    "Get raw file content, line ranges, or grep patterns/symbols from a remote GitHub repository without local cloning. GitHub serves files up to 100 MB this way; larger files are refused with a clear error.",
  params: {
    repo: {
      type: "string",
      optional: true,
      description:
        "Repository as 'owner/name'. Overrides providers.github.repo.",
    },
    file_path: {
      type: "string",
      description:
        "Relative file path inside the repository (e.g. 'src/index.ts')",
    },
    ref: {
      type: "string",
      optional: true,
      description:
        "Branch, tag, or commit SHA. Defaults to the repository's default branch.",
    },
    pattern: {
      type: "string",
      optional: true,
      description:
        "Regex pattern or substring to grep within the file (e.g. '^func ' or 'GetDeadline')",
    },
    start_line: {
      type: "number",
      optional: true,
      description: "1-based starting line number to read",
    },
    end_line: {
      type: "number",
      optional: true,
      description: "1-based ending line number to read",
    },
  },
  execute: async (params) => {
    const { repo } = assertGitHubReadable(params);

    const filePath = String(params.file_path || "").trim();
    if (!filePath) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A valid file_path is required.",
        "Provide a relative file path inside the repository, then retry.",
        true,
        { parameter: "file_path" },
      );
    }

    const ref = typeof params.ref === "string" ? params.ref.trim() : "";
    const client = getGitHubClient();

    try {
      const content = await client.requestText({
        path: `/repos/${repo}/contents/${filePath
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        query: ref ? { ref } : undefined,
        // Raw media type: the contents API otherwise wraps the file in JSON and base64,
        // which caps it at 1 MB and costs a decode for no benefit.
        accept: "application/vnd.github.raw",
      });

      const allLines = content.split("\n");
      const totalLines = allLines.length;
      const fileName = filePath.split("/").pop() ?? filePath;

      if (params.pattern) {
        let regex: RegExp;
        try {
          regex = new RegExp(String(params.pattern));
        } catch {
          regex = new RegExp(
            String(params.pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          );
        }

        const matches = allLines.flatMap((text, index) =>
          regex.test(text) ? [{ line: index + 1, text }] : [],
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  fileName,
                  filePath,
                  ref: ref || "default",
                  totalLines,
                  pattern: params.pattern,
                  totalMatches: matches.length,
                  matches,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      let slicedContent = content;
      let startLine = 1;
      let endLine = totalLines;
      const isSliced =
        params.start_line !== undefined || params.end_line !== undefined;

      if (isSliced) {
        startLine = Math.max(1, Number(params.start_line) || 1);
        endLine = Math.min(totalLines, Number(params.end_line) || totalLines);
        slicedContent =
          startLine <= endLine
            ? allLines.slice(startLine - 1, endLine).join("\n")
            : "";
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                fileName,
                filePath,
                size: Buffer.byteLength(content, "utf-8"),
                ref: ref || "default",
                totalLines,
                isSliced,
                startLine: isSliced ? startLine : 1,
                endLine: isSliced ? endLine : totalLines,
                content: slicedContent,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError(
        `get file '${filePath}' at ref '${ref || "default"}'`,
        error,
      );
    }
  },
};
