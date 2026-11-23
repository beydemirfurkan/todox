import * as folders from "../repositories/project-folders";
import * as placements from "../repositories/project-placements";
import type { ProjectFolder, ProjectPlacement } from "../types";
import { now } from "../util/time";
import { BadRequest } from "./errors";
import { assertFolder, assertProjectAccess } from "./ownership";

/**
 * How one person arranges the projects they can see: pinned on top, then
 * their folders, then everything not in one, and the archive folded away.
 *
 * Display only. Agents list and brief projects exactly as before -- an
 * archived repository still answers `get_context` -- because this is about a
 * crowded sidebar, not about which work exists.
 */

export interface FolderGroup<P> {
  id: number;
  name: string;
  projects: P[];
}

export interface ArrangedProjects<P> {
  pinned: P[];
  folders: FolderGroup<P>[];
  /** In no folder, not pinned, not archived: the list as it always was. */
  loose: P[];
  archived: P[];
}

/**
 * Groups a list already in the order it should be read (newest activity
 * first) without reordering it, except that pins keep the order they were
 * made in. Each project appears once: the archive outranks a pin, and a pin
 * outranks a folder, because a pinned project is wanted on top, not twice.
 *
 * A folder with nothing in it still appears, so a folder just made is there
 * to see. A placement for a project not in the list -- one the person has
 * since lost access to -- is ignored.
 */
export function arrange<P extends { id: number }>(input: {
  projects: readonly P[];
  placements: readonly ProjectPlacement[];
  folders: readonly ProjectFolder[];
}): ArrangedProjects<P> {
  const placementOf = new Map(input.placements.map((row) => [row.project_id, row]));
  const groups = input.folders.map((folder) => ({ id: folder.id, name: folder.name, projects: [] as P[] }));
  const groupOf = new Map(groups.map((group) => [group.id, group]));
  const pinned: { project: P; at: string }[] = [];
  const loose: P[] = [];
  const archived: P[] = [];

  for (const project of input.projects) {
    const placement = placementOf.get(project.id);
    const group = placement?.folder_id != null ? groupOf.get(placement.folder_id) : undefined;
    if (placement?.archived_at) archived.push(project);
    else if (placement?.pinned_at) pinned.push({ project, at: placement.pinned_at });
    else if (group) group.projects.push(project);
    else loose.push(project);
  }

  pinned.sort((first, second) => first.at.localeCompare(second.at));
  return { pinned: pinned.map((row) => row.project), folders: groups, loose, archived };
}

/** The folders and placements `arrange` needs, in one round trip. */
export async function arrangementFor(userId: number) {
  const [folderRows, placementRows] = await Promise.all([
    folders.listByUser(userId),
    placements.listByUser(userId),
  ]);
  return { folders: folderRows, placements: placementRows };
}

/** Trimmed, one line, and not empty or a paragraph. */
export function folderName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new BadRequest("a folder needs a name");
  if (name.length > folders.FOLDER_NAME_MAX)
    throw new BadRequest(`a folder name is at most ${folders.FOLDER_NAME_MAX} characters`);
  return name;
}

export async function createFolder(userId: number, rawName: string): Promise<ProjectFolder> {
  return folders.findOrCreate(userId, folderName(rawName));
}

/**
 * Into an existing folder, into one named here (made if new), or out of any.
 * Either way the project must be one this person can see, and the folder
 * theirs -- the schema refuses anything else too, but the 404 comes from here.
 */
export async function moveToFolder(
  userId: number,
  projectId: number,
  target: { folderId: number } | { newFolderName: string } | { none: true },
): Promise<void> {
  await assertProjectAccess(userId, projectId);
  if ("none" in target) {
    await placements.setFolder(userId, projectId, null);
    return;
  }
  if ("folderId" in target) {
    await assertFolder(userId, target.folderId);
    await placements.setFolder(userId, projectId, target.folderId);
    return;
  }
  const folder = await createFolder(userId, target.newFolderName);
  await placements.setFolder(userId, projectId, folder.id);
}

export async function pinProject(userId: number, projectId: number): Promise<void> {
  await assertProjectAccess(userId, projectId);
  await placements.setPinnedAt(userId, projectId, now());
}

export async function unpinProject(userId: number, projectId: number): Promise<void> {
  await assertProjectAccess(userId, projectId);
  await placements.setPinnedAt(userId, projectId, null);
}

export async function archiveProject(userId: number, projectId: number): Promise<void> {
  await assertProjectAccess(userId, projectId);
  await placements.setArchivedAt(userId, projectId, now());
}

export async function unarchiveProject(userId: number, projectId: number): Promise<void> {
  await assertProjectAccess(userId, projectId);
  await placements.setArchivedAt(userId, projectId, null);
}

/** Renaming onto another of your folders' names is refused, not merged. */
export async function renameFolder(userId: number, folderId: number, rawName: string): Promise<void> {
  await assertFolder(userId, folderId);
  const name = folderName(rawName);
  const clash = (await folders.listByUser(userId)).find(
    (folder) => folder.id !== folderId && folder.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw new BadRequest(`you already have a folder called "${clash.name}"`);
  await folders.rename(folderId, name);
}

export async function deleteFolder(userId: number, folderId: number): Promise<void> {
  await assertFolder(userId, folderId);
  await folders.remove(folderId);
}
