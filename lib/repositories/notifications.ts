import type { NotificationKind } from "../constants";
import { all, run, type Statement } from "../db/client";
import type { NotificationView } from "../types";
import { now } from "../util/time";

export type NewNotification = {
  userId: number;
  kind: NotificationKind;
  projectId?: number | null;
  actorId?: number | null;
  detail?: string | null;
};

const insert = (n: NewNotification) => ({
  columns: "(user_id, kind, project_id, actor_id, detail, created_at)",
  values: [n.userId, n.kind, n.projectId ?? null, n.actorId ?? null, n.detail ?? null, now()],
});

export function createStmt(n: NewNotification): Statement {
  const { columns, values } = insert(n);
  return {
    text: `INSERT INTO notifications ${columns} VALUES (?, ?, ?, ?, ?, ?)`,
    params: values,
  };
}

/**
 * The guarded form, for the accept path.
 *
 * The membership insert beside it ends in ON CONFLICT DO NOTHING, so somebody
 * who is already a member can replay an invitation without gaining a second
 * membership. An unguarded INSERT here would still fire, and the owner would
 * collect a fresh "they accepted" every time the link was opened. The
 * condition is the same one the membership statement uses: only if this
 * transaction is the one that claimed the invitation.
 */
export function createForAcceptedInvitationStmt(
  n: NewNotification & { invitationId: number; acceptedBy: number; acceptedAt: string },
): Statement {
  const { columns, values } = insert(n);
  return {
    text: `INSERT INTO notifications ${columns}
           SELECT ?, ?, ?, ?, ?, ?
             FROM project_invitations i
            WHERE i.id = ? AND i.accepted_by = ? AND i.accepted_at = ?`,
    params: [...values, n.invitationId, n.acceptedBy, n.acceptedAt],
  };
}

export const create = (n: NewNotification) => {
  const stmt = createStmt(n);
  return run(stmt.text, stmt.params);
};

/**
 * The bell, in one query.
 *
 * `unread` is a window over the whole result rather than a second round trip:
 * window functions run before LIMIT, so the count is every unread row this
 * account has, not just the ones shown. The cost is that the window reads all
 * of them — which is why `purgeRead` exists.
 *
 * The slug is the recipient's own route to the project, not the owner's:
 * collaborators keep a user-local `access_slug`. It comes back null when they
 * cannot reach the project at all — an invitation not yet accepted, or a
 * membership that has just been taken away — and the bell renders those as
 * plain rows rather than dead links.
 */
export const feed = (userId: number, limit: number) =>
  all<NotificationView & { unread: string }>(
    `SELECT n.*,
            p.name AS project_name,
            COALESCE(pm.access_slug,
                     CASE WHEN p.user_id = n.user_id THEN p.slug END) AS project_slug,
            actor.name AS actor_name,
            COUNT(*) FILTER (WHERE n.read_at IS NULL) OVER () AS unread
       FROM notifications n
       LEFT JOIN projects p ON p.id = n.project_id
       LEFT JOIN project_memberships pm
              ON pm.project_id = n.project_id AND pm.user_id = n.user_id
       LEFT JOIN users actor ON actor.id = n.actor_id
      WHERE n.user_id = ?
      ORDER BY n.id DESC
      LIMIT ?`,
    [userId, limit],
  );

export const markAllRead = (userId: number, at: string) =>
  run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", [
    at,
    userId,
  ]);

/** Read and old. Unread rows stay however long they take to be looked at. */
export const purgeRead = (before: string) =>
  run("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?", [before]);

/**
 * Point a project's notifications at another project, for a merge.
 *
 * Without this the rows would go with the deleted project by cascade, and an
 * unread badge would clear itself by having its subject removed underneath it.
 */
export const reassignStmt = (fromId: number, intoId: number): Statement => ({
  text: "UPDATE notifications SET project_id = ? WHERE project_id = ?",
  params: [intoId, fromId],
});
