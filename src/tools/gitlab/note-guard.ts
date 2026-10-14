import type { Config } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { isProviderConfigured } from "../../core/provider-config.js";
import {
  findBlockedEnvironment,
  resolveAllowWrite,
} from "../../core/security.js";
import { resolveMrId, resolveProjectId } from "../../providers/gitlab.js";

export type NoteTarget = {
  projectId: string | number;
  mrId: number;
  config: Config;
};

/**
 * The checks every GitLab note write shares, ordered so the caller gets the cheapest
 * failure first: is GitLab configured, are writes granted, is this project blocked.
 *
 * These deliberately repeat the guards inside `gitlab_create_note` rather than being
 * shared with it. That file's inline-comment positions are still awaiting live
 * verification, and moving its guards would put an unrelated change on the same build.
 */
export const assertNoteWriteAllowed = (
  params: Record<string, any>,
): NoteTarget => {
  const config = (global as any).__devtools_config;

  if (config?.providers?.gitlab?.enabled === false) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitLab is disabled in configuration.",
      "Enable providers.gitlab.enabled in .devtools/config.yaml, then retry this tool.",
      true,
      { configKey: "providers.gitlab.enabled" },
    );
  }
  if (!isProviderConfigured(config, "gitlab")) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitLab configuration is required.",
      "Configure GitLab with gitlab_set_config, then retry this tool.",
      true,
      { configKey: "providers.gitlab", setupTool: "gitlab_set_config" },
    );
  }
  if (!resolveAllowWrite(config, "gitlab")) {
    throw new ToolError(
      "GITLAB_WRITE_DISABLED",
      "GitLab write operations are disabled.",
      "Ask the user to remove `providers.gitlab.security.allow_write: false` (or set it to true) in .devtools/config.yaml, then retry this tool.",
      true,
      { configKey: "providers.gitlab.security.allow_write" },
    );
  }

  const projectId = resolveProjectId(params, config);

  // GitLab has no environment concept, so blocked_env is matched against the
  // resolved project path or numeric ID instead.
  const blockedEnv = findBlockedEnvironment(config, "gitlab", String(projectId));
  if (blockedEnv) {
    throw new ToolError(
      "GITLAB_ENVIRONMENT_BLOCKED",
      `GitLab writes are blocked for project "${projectId}" — it matches the blocked_env entry "${blockedEnv}".`,
      "Choose a project that is not listed in providers.gitlab.security.blocked_env; do not retry against this project.",
      false,
      { configKey: "providers.gitlab.security.blocked_env" },
    );
  }

  return { projectId, mrId: resolveMrId(params), config };
};

/** A note id has to be a real positive integer before it is worth a round trip. */
export const resolveNoteId = (params: Record<string, any>): number => {
  const noteId = Number(params.note_id);

  if (!Number.isInteger(noteId) || noteId <= 0) {
    throw new ToolError(
      "GITLAB_NOTE_ID_INVALID",
      "note_id must be a positive integer.",
      "Use the numeric id of the comment, as returned by gitlab_create_note or gitlab_get_mr.",
      false,
      { parameter: "note_id" },
    );
  }

  return noteId;
};

/**
 * A system note records an event (a label change, a push) rather than something a person
 * wrote, and GitLab refuses to change it. Saying so here beats forwarding the rejection.
 */
export const assertUserNote = (note: any, noteId: number): void => {
  if (note?.system === true) {
    throw new ToolError(
      "GITLAB_NOTE_NOT_EDITABLE",
      `Note ${noteId} is a system note, not a comment.`,
      "Pick a comment id written by a person; system notes record events and cannot be changed.",
      false,
      { parameter: "note_id" },
    );
  }
};
