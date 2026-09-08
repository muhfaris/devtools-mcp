import { Tool, ToolResult } from "../../src/core/types.js";

export const runTool = async (
  tool: Tool,
  params: Record<string, any>,
): Promise<string> => {
  const result = await tool.execute(params);
  return result.content?.[0]?.text || "";
};

export const parseToolJson = async (
  tool: Tool,
  params: Record<string, any>,
): Promise<any> => {
  const text = await runTool(tool, params);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
