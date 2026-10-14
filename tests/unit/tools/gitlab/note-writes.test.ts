import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabUpdateNoteTool } from "../../../../src/tools/gitlab/update-note.js";
import { gitlabDeleteNoteTool } from "../../../../src/tools/gitlab/delete-note.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

const gitlabProvider = (gitlab: Record<string, unknown>) => ({
  providers: { gitlab: { url: "https://gitlab.com", token: "token", ...gitlab } },
});

const granted = { projectId: 100, security: { allow_write: true } };

const stubNotes = async (note: Record<string, unknown> = {}) => {
  const existing = {
    id: 901,
    body: "Old body",
    author: { username: "tester" },
    created_at: "2026-09-09T00:00:00Z",
    system: false,
    ...note,
  };
  const mockShow = vi.fn().mockResolvedValue(existing);
  const mockEdit = vi.fn().mockResolvedValue({
    ...existing,
    body: "Corrected body",
    updated_at: "2026-09-25T00:00:00Z",
  });
  const mockRemove = vi.fn().mockResolvedValue(undefined);

  const gitlabMod = await import("../../../../src/providers/gitlab.js");
  gitlabMod.initGitLab((global as any).__devtools_config);
  const client = gitlabMod.getGitLabClient();
  (client as any).MergeRequestNotes = {
    show: mockShow,
    edit: mockEdit,
    remove: mockRemove,
  };

  return { mockShow, mockEdit, mockRemove };
};

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_update_note", () => {
  it("replaces the comment body and reports what it replaced", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockShow, mockEdit } = await stubNotes();

    const res = await parseToolJson(gitlabUpdateNoteTool, {
      mr_id: 12,
      note_id: 901,
      body: "Corrected text",
    });

    expect(mockShow).toHaveBeenCalledWith(100, 12, 901);
    expect(mockEdit).toHaveBeenCalledWith(100, 12, 901, { body: "Corrected text" });
    expect(res).toMatchObject({
      id: 901,
      mrId: 12,
      body: "Corrected body",
      previousBody: "Old body",
      success: true,
    });
    expect(res.url).toContain("#note_901");
  });

  it("denies writes when nothing grants them", async () => {
    (global as any).__devtools_config = gitlabProvider({ projectId: 100 });

    await expect(
      gitlabUpdateNoteTool.execute({ mr_id: 12, note_id: 901, body: "Corrected" }),
    ).rejects.toMatchObject({
      code: "GITLAB_WRITE_DISABLED",
      configKey: "providers.gitlab.security.allow_write",
    });
  });

  it("blocks a project matching a blocked_env entry", async () => {
    (global as any).__devtools_config = gitlabProvider({
      projectId: "group/production-app",
      security: { allow_write: true, blocked_env: ["production"] },
    });

    await expect(
      gitlabUpdateNoteTool.execute({ mr_id: 12, note_id: 901, body: "Corrected" }),
    ).rejects.toMatchObject({ code: "GITLAB_ENVIRONMENT_BLOCKED" });
  });

  it("rejects a note id that is not a positive integer", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);

    await expect(
      gitlabUpdateNoteTool.execute({ mr_id: 12, note_id: 0, body: "Corrected" }),
    ).rejects.toMatchObject({
      code: "GITLAB_NOTE_ID_INVALID",
      parameter: "note_id",
      retryable: false,
    });
  });

  it("requires a non-empty replacement body", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);

    await expect(
      gitlabUpdateNoteTool.execute({ mr_id: 12, note_id: 901, body: "   " }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      parameter: "body",
    });
  });

  it("refuses to edit a system note", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockEdit } = await stubNotes({ system: true });

    await expect(
      gitlabUpdateNoteTool.execute({ mr_id: 12, note_id: 901, body: "Corrected" }),
    ).rejects.toMatchObject({
      code: "GITLAB_NOTE_NOT_EDITABLE",
      parameter: "note_id",
      retryable: false,
    });
    expect(mockEdit).not.toHaveBeenCalled();
  });
});

describe("gitlab_delete_note", () => {
  it("describes the comment and stops without confirmation", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockRemove } = await stubNotes();

    const res = await parseToolJson(gitlabDeleteNoteTool, {
      mr_id: 12,
      note_id: 901,
    });

    expect(res).toMatchObject({
      mrId: 12,
      noteId: 901,
      deleted: false,
      confirmationRequired: true,
    });
    expect(res.wouldDelete).toMatchObject({
      id: 901,
      author: "tester",
      body: "Old body",
    });
    expect(res.message).toContain("confirm: true");
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("deletes the comment once confirmed", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockRemove } = await stubNotes();

    const res = await parseToolJson(gitlabDeleteNoteTool, {
      mr_id: 12,
      note_id: 901,
      confirm: true,
    });

    expect(mockRemove).toHaveBeenCalledWith(100, 12, 901);
    expect(res).toMatchObject({ noteId: 901, deleted: true, success: true });
    expect(res.deletedNote).toMatchObject({ id: 901, body: "Old body" });
  });

  it("denies writes when nothing grants them", async () => {
    (global as any).__devtools_config = gitlabProvider({ projectId: 100 });

    await expect(
      gitlabDeleteNoteTool.execute({ mr_id: 12, note_id: 901, confirm: true }),
    ).rejects.toMatchObject({
      code: "GITLAB_WRITE_DISABLED",
      configKey: "providers.gitlab.security.allow_write",
    });
  });

  it("refuses to delete a system note", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockRemove } = await stubNotes({ system: true });

    await expect(
      gitlabDeleteNoteTool.execute({ mr_id: 12, note_id: 901, confirm: true }),
    ).rejects.toMatchObject({ code: "GITLAB_NOTE_NOT_EDITABLE" });
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
