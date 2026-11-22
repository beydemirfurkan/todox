import { all, one, run, type Statement } from "../db/client";
import { now } from "../util/time";
import type { ProjectMembership } from "../types";

export type MembershipView = ProjectMembership & {
  project_name: string;
  project_summary: string | null;
  owner_name: string;
  owner_email: string;
};

export type ProjectMemberView = ProjectMembership & {
  name: string;
  email: string;
  username: string;
};

export const listByUser = (userId: number) =>
  all<MembershipView>(
    `SELECT pm.*, p.name AS project_name, p.summary AS project_summary,
            owner.name AS owner_name, owner.email AS owner_email
       FROM project_memberships pm
       JOIN projects p ON p.id = pm.project_id
       JOIN users owner ON owner.id = p.user_id
      WHERE pm.user_id = ?
      ORDER BY p.name`,
    [userId],
  );

export const listByProject = (projectId: number) =>
  all<ProjectMemberView>(
    `SELECT pm.*, u.name, u.email, u.username
       FROM project_memberships pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY u.name, u.email`,
    [projectId],
  );

/**
 * How many people share each of these projects, counted in the database.
 *
 * The dashboard renders a card per project; a count per card would be a round
 * trip per card. Projects with no members are simply absent from the map.
 */
export async function countsByProjects(projectIds: number[]): Promise<Map<number, number>> {
  if (!projectIds.length) return new Map();
  const rows = await all<{ project_id: number; n: string }>(
    `SELECT project_id, COUNT(*) AS n FROM project_memberships
      WHERE project_id IN (${projectIds.map(() => "?").join(",")})
      GROUP BY project_id`,
    projectIds,
  );
  return new Map(rows.map((r) => [r.project_id, Number(r.n)]));
}

export const byProjectAndEmail = (projectId: number, email: string) =>
  one<ProjectMembership>(
    `SELECT pm.* FROM project_memberships pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND lower(u.email) = lower(?)`,
    [projectId, email],
  );

/** Insert only when the matching invitation was claimed by this transaction. */
export const createForAcceptedInvitationStmt = (input: {
  invitationId: number;
  userId: number;
  accessSlug: string;
  acceptedAt: string;
}): Statement => ({
  text: `INSERT INTO project_memberships
           (project_id, user_id, access_slug, invited_by, created_at)
         SELECT i.project_id, ?, ?, i.invited_by, ?
           FROM project_invitations i
          WHERE i.id = ? AND i.accepted_by = ? AND i.accepted_at = ?
         ON CONFLICT (project_id, user_id) DO NOTHING
         RETURNING *`,
  params: [
    input.userId,
    input.accessSlug,
    input.acceptedAt,
    input.invitationId,
    input.userId,
    input.acceptedAt,
  ],
});

/**
 * The row, but only if the caller owns the project it is in.
 *
 * Removing somebody has to tell them so, and the only place their user id
 * exists is the row about to be deleted. Reading it first is the whole reason
 * this is a two-step in a service rather than one call from the action.
 */
export const ownedById = (ownerId: number, membershipId: number) =>
  one<ProjectMembership>(
    `SELECT pm.* FROM project_memberships pm
       JOIN projects p ON p.id = pm.project_id
      WHERE pm.id = ? AND p.user_id = ?`,
    [membershipId, ownerId],
  );

export const removeOwned = (ownerId: number, membershipId: number) =>
  run(
    `DELETE FROM project_memberships pm
      USING projects p
      WHERE pm.id = ? AND p.id = pm.project_id AND p.user_id = ?`,
    [membershipId, ownerId],
  );

/** Whether this account already reaches some project under this route slug. */
export const isAccessSlugTaken = async (userId: number, slug: string): Promise<boolean> =>
  Boolean(
    await one("SELECT 1 AS n FROM project_memberships WHERE user_id = ? AND access_slug = ?", [
      userId,
      slug,
    ]),
  );

/**
 * The incoming owner's membership, retired as the project becomes theirs.
 *
 * Guarded on the outgoing owner still holding the project, so a transfer that
 * lost a race deletes nothing: the statements after it are guarded the same
 * way and the whole transaction becomes a no-op.
 */
export const removeForTransferStmt = (input: {
  projectId: number;
  toUserId: number;
  fromUserId: number;
}): Statement => ({
  text: `DELETE FROM project_memberships
          WHERE project_id = ? AND user_id = ?
            AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?)`,
  params: [input.projectId, input.toUserId, input.projectId, input.fromUserId],
});

/** The outgoing owner stays on as a member, once the project has moved. */
export const createForTransferStmt = (input: {
  projectId: number;
  fromUserId: number;
  toUserId: number;
  accessSlug: string;
  rootPath: string | null;
}): Statement => ({
  text: `INSERT INTO project_memberships
           (project_id, user_id, access_slug, root_path, invited_by, created_at)
         SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?)`,
  params: [
    input.projectId,
    input.fromUserId,
    input.accessSlug,
    input.rootPath,
    input.toUserId,
    now(),
    input.projectId,
    input.toUserId,
  ],
});

export type SharedProject = { id: number; name: string; slug: string; members: number };

/**
 * Projects this account owns that somebody else is a member of.
 *
 * Deleting the account would take these, and the members' work in them, with
 * it -- which is why account deletion asks for each to be handed on first.
 */
export async function sharedOwnedBy(userId: number): Promise<SharedProject[]> {
  const rows = await all<{ id: number; name: string; slug: string; members: string }>(
    `SELECT p.id, p.name, p.slug, COUNT(pm.id) AS members
       FROM projects p
       JOIN project_memberships pm ON pm.project_id = p.id
      WHERE p.user_id = ?
      GROUP BY p.id, p.name, p.slug
      ORDER BY p.name`,
    [userId],
  );
  return rows.map((r) => ({ ...r, members: Number(r.members) }));
}
