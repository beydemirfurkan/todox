import { all, one, run, type Statement } from "../db/client";
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

export const removeOwned = (ownerId: number, membershipId: number) =>
  run(
    `DELETE FROM project_memberships pm
      USING projects p
      WHERE pm.id = ? AND p.id = pm.project_id AND p.user_id = ?`,
    [membershipId, ownerId],
  );
