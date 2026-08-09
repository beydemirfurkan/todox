import * as projects from "../repositories/projects";
import type { Project } from "../types";

export const bySharedToken = (token: string) => projects.byShareToken(token);

export async function setSharing(
  userId: number,
  id: number,
  opts: { enabled: boolean; includeLog?: boolean },
): Promise<Project | undefined> {
  if (!opts.enabled) {
    await projects.setShare(userId, id, null, false);
    return projects.byId(userId, id);
  }
  const current = await projects.byId(userId, id);
  if (!current) return undefined;
  // Keep the existing link alive when only the log toggle changes.
  const token = current.share_token ?? projects.freshShareToken();
  await projects.setShare(userId, id, token, Boolean(opts.includeLog));
  return projects.byId(userId, id);
}

/** Rotate the link, invalidating whatever was handed out before. */
export async function rotate(userId: number, id: number) {
  const current = await projects.byId(userId, id);
  if (!current?.share_token) return;
  await projects.setShare(
    userId,
    id,
    projects.freshShareToken(),
    current.share_log === 1,
  );
}
