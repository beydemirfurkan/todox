import * as memberships from "../repositories/project-memberships";
import * as notifications from "../repositories/notifications";

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
