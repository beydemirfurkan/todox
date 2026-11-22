import { tx } from "../db/client";
import * as memberships from "../repositories/project-memberships";
import * as notifications from "../repositories/notifications";
import * as projects from "../repositories/projects";

/**
 * Taking somebody off a project, and telling them.
 *
 * A service and not a one-liner in the action, because it spans two tables in
 * an order that matters: the membership row is the only place the removed
 * person's user id exists, and it is about to be deleted. Reading it first is
 * the whole job.
 *
 * The read is owner-scoped, so a membership belonging to another account's
 * project simply is not found and nothing happens -- the same answer a
 * nonexistent id gets.
 */
export async function removeMember(ownerId: number, membershipId: number) {
  const membership = await memberships.ownedById(ownerId, membershipId);
  if (!membership) return false;

  await memberships.removeOwned(ownerId, membershipId);
  // After the delete, and not in a transaction with it: losing the notice is a
  // worse outcome than losing the removal only if the removal is what the
  // owner asked for. A notice nobody can act on is noise; a member who was
  // meant to be gone and is not is a security answer given wrongly.
  await notifications.create({
    userId: membership.user_id,
    kind: "member_removed",
    projectId: membership.project_id,
    actorId: ownerId,
  });
  return true;
}

export type TransferOutcome =
  | { ok: true; formerOwnerSlug: string }
  | { ok: false; code: "not-found" | "conflict" };

/**
 * Hands a project to one of its members.
 *
 * The incoming owner's membership is retired, the project moves under their
 * account, and the outgoing owner stays on as a member -- all in one
 * transaction, each statement guarded on who holds the project, so a lost
 * race changes nothing rather than half of it.
 *
 * Slugs are per account. The new owner keeps the route they already had for
 * it unless they own another project under that name; the old owner keeps
 * theirs unless a membership of theirs already uses it.
 *
 * The membership is looked up owner-scoped, like `removeMember`: somebody
 * else's membership id is not found, the same answer a made-up one gets.
 */
export async function transferOwnership(
  ownerId: number,
  membershipId: number,
): Promise<TransferOutcome> {
  const membership = await memberships.ownedById(ownerId, membershipId);
  if (!membership) return { ok: false, code: "not-found" };
  const project = await projects.ownedById(ownerId, membership.project_id);
  if (!project) return { ok: false, code: "not-found" };

  const newOwnerId = membership.user_id;
  const [newOwnerSlug, formerOwnerSlug] = await Promise.all([
    slugFor(newOwnerId, membership.access_slug, projects.isOwnedSlugTaken),
    slugFor(ownerId, project.slug, memberships.isAccessSlugTaken),
  ]);

  try {
    await tx([
      memberships.removeForTransferStmt({
        projectId: project.id,
        toUserId: newOwnerId,
        fromUserId: ownerId,
      }),
      projects.transferStmt({
        id: project.id,
        fromUserId: ownerId,
        toUserId: newOwnerId,
        slug: newOwnerSlug,
        rootPath: membership.root_path,
      }),
      memberships.createForTransferStmt({
        projectId: project.id,
        fromUserId: ownerId,
        toUserId: newOwnerId,
        accessSlug: formerOwnerSlug,
        rootPath: project.root_path,
      }),
      notifications.createStmt({
        userId: newOwnerId,
        kind: "ownership_received",
        projectId: project.id,
        actorId: ownerId,
      }),
    ]);
  } catch (error) {
    // A slug taken between the check and the write. Nothing was applied.
    if (isUniqueViolation(error)) return { ok: false, code: "conflict" };
    throw error;
  }
  // Every statement was guarded, so a transfer that lost a race applied
  // nothing; this is what tells it apart from one that went through.
  if (!(await projects.ownedById(newOwnerId, project.id))) return { ok: false, code: "not-found" };
  return { ok: true, formerOwnerSlug };
}

async function slugFor(
  userId: number,
  wanted: string,
  isTaken: (userId: number, slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(userId, wanted))) return wanted;
  return projects.nextFreeSlug(userId, wanted);
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";

/**
 * Deletes a project and tells the people who were in it.
 *
 * The members are read first, because the delete cascades their memberships
 * away and with them the only record of who they were. The notices carry the
 * project's name in `detail` and no project id: the id is about to point at
 * nothing, and `notifications.project_id` cascades, so a notice tied to it
 * would be deleted along with the project it is about.
 */
export async function deleteProject(ownerId: number, projectId: number): Promise<boolean> {
  const project = await projects.ownedById(ownerId, projectId);
  if (!project) return false;
  const members = await memberships.listByProject(project.id);

  await projects.remove(ownerId, project.id);
  if (members.length === 0) return true;
  // After the delete, for the reason `removeMember` gives: the deletion is
  // what the owner asked for, and it must not hang on the notices.
  await tx(
    members.map((member) =>
      notifications.createStmt({
        userId: member.user_id,
        kind: "project_deleted",
        actorId: ownerId,
        detail: project.name,
      }),
    ),
  );
  return true;
}
