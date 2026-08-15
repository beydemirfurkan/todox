import { tx } from "../db/client";
import * as contextsRepo from "../repositories/contexts";
import * as notificationsRepo from "../repositories/notifications";
import * as invitationsRepo from "../repositories/project-invitations";
import * as membershipsRepo from "../repositories/project-memberships";
import * as projectPathsRepo from "../repositories/project-paths";
import * as projectsRepo from "../repositories/projects";
import * as tasksRepo from "../repositories/tasks";
import { BadRequest } from "./errors";
import { assertProject } from "./ownership";
import { mustResolve } from "./project-resolver";

/**
 * Fold one project into another, keeping everything both of them recorded.
 *
 * The case this exists for: the same repository registered twice because it was
 * opened from two machines, back when a project was identified by one absolute
 * path. Resolution no longer does that, but the accounts that already split
 * need a way back, and `slug` is deliberately not updatable -- so the way back
 * is to move the rows, not to rename the row.
 *
 * Everything runs in one `tx()`. A half-done merge is the worst of the three
 * outcomes: tasks under a project whose paths still point at the other one is a
 * log that disagrees with itself, which is exactly what this product sells
 * against.
 */
export async function merge(
  userId: number,
  params: { from: string; into: string; confirm: string },
) {
  const from = await mustResolve(userId, params.from);
  const into = await mustResolve(userId, params.into);

  // Owner, not member: holding access to a project is not the right to
  // dissolve it. `NotYours` answers 404, so this says nothing about whether
  // somebody else's id exists.
  await assertProject(userId, from.id);
  await assertProject(userId, into.id);

  if (from.id === into.id)
    throw new BadRequest("from and into are the same project; nothing to merge");

  // Case-insensitive, like `delete_project`: the point is to stop this
  // happening by reflex, not to test anybody's typing.
  if (params.confirm.trim().toLowerCase() !== from.slug.toLowerCase())
    throw new BadRequest(
      `confirm must be "${from.slug}", the slug of the project being merged away`,
    );

  await refuseIfShared(from);

  const counts = await tasksRepo.counts(from.id);
  const contexts = await contextsRepo.listByProject(userId, from.id);
  const carriedPaths = await projectPathsRepo.listFor(userId, from.id);

  await tx([
    tasksRepo.reassignStmt(from.id, into.id),
    contextsRepo.reassignStmt(from.id, into.id),
    notificationsRepo.reassignStmt(from.id, into.id),
    projectPathsRepo.reassignStmt(userId, from.id, into.id),
    // The absorbed project's own `root_path` is a path nothing else records --
    // it lives in the row that is about to be deleted, so it has to become a
    // `project_paths` row or the second machine stops resolving.
    ...(from.root_path
      ? [projectPathsRepo.addStmt(userId, into.id, from.root_path)]
      : []),
    ...(from.repo_url
      ? [projectsRepo.fillRepoUrlStmt(userId, into.id, from.repo_url)]
      : []),
    projectsRepo.removeStmt(userId, from.id),
  ]);

  const tasksMoved = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    merged: from.slug,
    into: into.slug,
    tasks_moved: tasksMoved,
    contexts_moved: contexts.length,
    paths_moved: carriedPaths.length + (from.root_path ? 1 : 0),
    note:
      "Linked file paths were recorded on whichever machine linked them, so the " +
      "merged project now holds paths in both forms. Staleness is judged by hash, " +
      "not by path, so they still report correctly.",
  };
}

/**
 * Shared projects are out of scope, and say so rather than half-working.
 *
 * `project_memberships` is unique on both `(project_id, user_id)` and
 * `(user_id, access_slug)`: moving a membership can collide on either, and the
 * collision would surface as a raw Postgres error in the middle of a
 * transaction that has already moved the tasks. Refusing up front is a smaller
 * lie than a merge that works until two people share a collaborator.
 */
async function refuseIfShared(from: { id: number; slug: string }) {
  const [members, invitations] = await Promise.all([
    membershipsRepo.listByProject(from.id),
    invitationsRepo.listByProject(from.id),
  ]);
  if (members.length === 0 && invitations.length === 0) return;

  throw new BadRequest(
    `"${from.slug}" has collaborators or pending invitations, and merging one is not ` +
      `supported yet. Remove them first, or merge the other direction.`,
  );
}
