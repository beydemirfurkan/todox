import { all, one, run, type Statement } from "../db/client";
import type { ProjectInvitation } from "../types";
import { hashToken } from "../util/tokens";

export type InvitationView = ProjectInvitation & {
  project_name: string;
  project_slug: string;
  inviter_name: string | null;
  /** Who to tell when this is accepted. The project owner, not the inviter. */
  owner_id: number | null;
};

const ACTIVE = "accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?";

export async function replacePending(input: {
  projectId: number;
  email: string;
  invitedBy: number;
  token: string;
  createdAt: string;
  expiresAt: string;
}) {
  const row = await one<ProjectInvitation>(
    `WITH retired AS (
       UPDATE project_invitations SET revoked_at = ?
        WHERE project_id = ? AND lower(email) = lower(?)
          AND accepted_at IS NULL AND revoked_at IS NULL
     )
     INSERT INTO project_invitations
       (project_id, email, token_hash, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      input.createdAt,
      input.projectId,
      input.email,
      input.projectId,
      input.email,
      hashToken(input.token),
      input.invitedBy,
      input.createdAt,
      input.expiresAt,
    ],
  );
  return row!;
}

export const byToken = (token: string, at: string) =>
  one<InvitationView>(
    `SELECT i.*, p.name AS project_name, p.slug AS project_slug, p.user_id AS owner_id,
            inviter.name AS inviter_name
       FROM project_invitations i
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN users inviter ON inviter.id = i.invited_by
      WHERE i.token_hash = ? AND i.${ACTIVE}`,
    [hashToken(token), at],
  );

export const byIdForEmail = (id: number, email: string, at: string) =>
  one<InvitationView>(
    `SELECT i.*, p.name AS project_name, p.slug AS project_slug, p.user_id AS owner_id,
            inviter.name AS inviter_name
       FROM project_invitations i
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN users inviter ON inviter.id = i.invited_by
      WHERE i.id = ? AND lower(i.email) = lower(?) AND i.${ACTIVE}`,
    [id, email, at],
  );

export const listPendingForEmail = (email: string, at: string) =>
  all<InvitationView>(
    `SELECT i.*, p.name AS project_name, p.slug AS project_slug, p.user_id AS owner_id,
            inviter.name AS inviter_name
       FROM project_invitations i
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN users inviter ON inviter.id = i.invited_by
      WHERE lower(i.email) = lower(?) AND i.${ACTIVE}
      ORDER BY i.created_at DESC`,
    [email, at],
  );

/**
 * Which of these projects have somebody waiting on an invitation.
 *
 * For the home page's empty-projects fold, whose definition of empty has to
 * match `removeIfEmpty`'s or it offers a button that does nothing. A project
 * with an unanswered invitation holds a person, whatever else it holds.
 */
export async function projectIdsWithPending(
  projectIds: number[],
  at: string,
): Promise<Set<number>> {
  if (!projectIds.length) return new Set();
  const rows = await all<{ project_id: number }>(
    `SELECT DISTINCT project_id FROM project_invitations
      WHERE project_id IN (${projectIds.map(() => "?").join(",")})
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    [...projectIds, at],
  );
  return new Set(rows.map((r) => r.project_id));
}

export const listByProject = (projectId: number) =>
  all<InvitationView>(
    `SELECT i.*, p.name AS project_name, p.slug AS project_slug, p.user_id AS owner_id,
            inviter.name AS inviter_name
       FROM project_invitations i
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN users inviter ON inviter.id = i.invited_by
      WHERE i.project_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      ORDER BY i.created_at DESC`,
    [projectId],
  );

export const acceptStmt = (id: number, userId: number, acceptedAt: string): Statement => ({
  text: `UPDATE project_invitations
            SET accepted_at = ?, accepted_by = ?
          WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL
            AND expires_at > ?
          RETURNING *`,
  params: [acceptedAt, userId, id, acceptedAt],
});

/**
 * Creates the recipient and membership from one invitation in one statement.
 * The generated user id has to feed two later writes, which the HTTP driver's
 * fixed-list transaction API cannot express without CTEs.
 */
export const acceptWithNewUser = (input: {
  token: string;
  username: string;
  passwordHash: string;
  accessSlug: string;
  acceptedAt: string;
}) =>
  one<{ user_id: number; access_slug: string }>(
    `WITH eligible AS (
       SELECT i.* FROM project_invitations i
        WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND i.expires_at > ?
          AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(i.email))
     ), created_user AS (
       INSERT INTO users
         (username, email, name, password_hash, created_at, email_verified_at)
       SELECT ?, e.email, '', ?, ?, ? FROM eligible e
       RETURNING id
     ), claimed AS (
       UPDATE project_invitations i
          SET accepted_at = ?, accepted_by = u.id
         FROM eligible e, created_user u
        WHERE i.id = e.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
       RETURNING i.project_id, i.invited_by, u.id AS user_id
     ), member AS (
       INSERT INTO project_memberships
         (project_id, user_id, access_slug, invited_by, created_at)
       SELECT c.project_id, c.user_id, ?, c.invited_by, ? FROM claimed c
       RETURNING user_id, access_slug
     )
     SELECT user_id, access_slug FROM member`,
    [
      hashToken(input.token),
      input.acceptedAt,
      input.username,
      input.passwordHash,
      input.acceptedAt,
      input.acceptedAt,
      input.acceptedAt,
      input.accessSlug,
      input.acceptedAt,
    ],
  );

export const revokeOwned = (ownerId: number, invitationId: number, revokedAt: string) =>
  run(
    `UPDATE project_invitations i SET revoked_at = ?
       FROM projects p
      WHERE i.id = ? AND p.id = i.project_id AND p.user_id = ?
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL`,
    [revokedAt, invitationId, ownerId],
  );

export const purgeExpired = (at: string) =>
  run(
    `DELETE FROM project_invitations
      WHERE expires_at <= ? AND (accepted_at IS NOT NULL OR revoked_at IS NOT NULL)`,
    [at],
  );
