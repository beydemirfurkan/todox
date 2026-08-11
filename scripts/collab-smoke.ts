/**
 * Exercises collaboration end to end: invite, accept, attribution, removal,
 * and the notifications each of those is supposed to produce.
 *
 * Talks to the services directly, like the other smoke suites -- these are
 * server-side rules, and driving them through forms would test Next's plumbing
 * instead. Needs a database, so it only runs where one is configured.
 */
import "./env";

import { one, run } from "../lib/db/client";
import * as entriesRepo from "../lib/repositories/entries";
import * as invitationsRepo from "../lib/repositories/project-invitations";
import * as membershipsRepo from "../lib/repositories/project-memberships";
import * as projectsRepo from "../lib/repositories/projects";
import * as usersRepo from "../lib/repositories/users";
import { removeMember } from "../lib/services/collaboration";
import { feed } from "../lib/services/notifications";
import { accept, invite } from "../lib/services/project-invitations";
import * as limit from "../lib/services/rate-limit";
import * as taskService from "../lib/services/task-service";
import { hashPassword } from "../lib/util/password";

const line = (s: string) => console.log(`\n--- ${s} ---`);

let failures = 0;
const expect = (label: string, pass: boolean) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
};

const rnd = () => Math.random().toString(36).slice(2, 10);

async function makeUser(prefix: string, verified: boolean) {
  const user = await usersRepo.create({
    username: `${prefix}-${rnd()}`,
    email: `${prefix}-${rnd()}@todox.local`,
    name: `${prefix === "owner" ? "Ada" : "Mert"} ${rnd()}`,
    password_hash: await hashPassword("correct-horse"),
  });
  if (verified) await usersRepo.markEmailVerified(user.id);
  return (await usersRepo.byId(user.id))!;
}

const kinds = (rows: { kind: string }[]) => rows.map((r) => r.kind);

async function main() {
  const owner = await makeUser("owner", true);
  const member = await makeUser("member", true);

  const project = await projectsRepo.create(owner.id, {
    name: `collab-smoke-${rnd()}`,
    slug: `collab-smoke-${rnd()}`,
    summary: "throwaway",
  });

  line("invitation reaches the invited account");
  const sent = await invite({
    userId: owner.id,
    projectId: project.id,
    email: member.email,
    lang: "en",
  });
  expect("invite accepted by the service", sent === "sent");

  const invitedFeed = await feed(member.id);
  expect("the invited account is told", kinds(invitedFeed.items).includes("invite_received"));
  expect("and it counts as unread", invitedFeed.unread === 1);

  line("accepting joins the project and tells the owner");
  const pending = await invitationsRepo.listPendingForEmail(
    member.email,
    new Date().toISOString(),
  );
  expect("the invitation is listed for the address", pending.length === 1);
  expect("and it carries the owner to notify", pending[0]?.owner_id === owner.id);

  const accessSlug = await accept({
    userId: member.id,
    email: member.email,
    invitationId: pending[0].id,
    emailVerified: true,
    lang: "en",
  });
  expect("accepting returns a usable route", Boolean(accessSlug));

  const ownerFeed = await feed(owner.id);
  expect("the owner is told", kinds(ownerFeed.items).includes("invite_accepted"));

  line("a replayed acceptance does not tell the owner twice");
  await accept({
    userId: member.id,
    email: member.email,
    invitationId: pending[0].id,
    emailVerified: true,
    lang: "en",
  });
  const afterReplay = await feed(owner.id);
  expect(
    "still exactly one acceptance notice",
    afterReplay.items.filter((n) => n.kind === "invite_accepted").length === 1,
  );

  line("both sides can see the project and each other");
  const asMember = await projectsRepo.bySlug(member.id, accessSlug!);
  expect("the member reaches it by their own slug", asMember?.id === project.id);
  expect("and it says whose it is", asMember?.owner_name === owner.name);
  expect("and reads as a membership", asMember?.access_role === "member");

  const asOwner = await projectsRepo.bySlug(owner.id, project.slug);
  expect("the owner still reads as owner", asOwner?.access_role === "owner");

  const roster = await membershipsRepo.listByProject(project.id);
  expect("the roster holds the member", roster.some((m) => m.user_id === member.id));
  expect("with a name to show", Boolean(roster[0]?.name && roster[0]?.username));

  const sizes = await membershipsRepo.countsByProjects([project.id]);
  expect("and is counted for the dashboard", sizes.get(project.id) === 1);

  line("what the member writes carries their name");
  const task = await taskService.create({
    project_id: project.id,
    title: "written by the collaborator",
    actor: "human",
    user_id: member.id,
  });
  await taskService.addEntry({
    task_id: task.id,
    kind: "decision",
    body: "this one is mine",
    author: "human",
    user_id: member.id,
  });

  const log = await entriesRepo.listByTask(task.id);
  expect("the entry knows who wrote it", log[0]?.user_id === member.id);
  expect("and comes back with the name attached", log[0]?.author_name === member.name);

  const opening = await one<{ user_id: number | null }>(
    "SELECT user_id FROM task_events WHERE task_id = ? ORDER BY id LIMIT 1",
    [task.id],
  );
  expect("so does the opening status event", opening?.user_id === member.id);

  await taskService.update(
    task.id,
    { status: "doing" },
    { actor: "human", user_id: owner.id },
  );
  const moved = await one<{ user_id: number | null }>(
    "SELECT user_id FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 1",
    [task.id],
  );
  expect("and a transition records who moved it", moved?.user_id === owner.id);

  line("removal tells the person it happened to");
  const membership = roster.find((m) => m.user_id === member.id)!;
  expect("removal reports success", (await removeMember(owner.id, membership.id)) === true);
  expect(
    "the project is gone for them",
    (await projectsRepo.bySlug(member.id, accessSlug!)) === undefined,
  );
  const removedFeed = await feed(member.id);
  expect("and they are told", kinds(removedFeed.items).includes("member_removed"));
  expect(
    "with nowhere to click, since they cannot go there",
    removedFeed.items.find((n) => n.kind === "member_removed")?.project_slug === null,
  );

  line("a stranger cannot remove somebody from a project they do not own");
  const stranger = await makeUser("member", true);
  expect(
    "refused, the same way a nonexistent id is",
    (await removeMember(stranger.id, membership.id)) === false,
  );

  // Cascades take the project, its tasks, the log and the notifications.
  for (const u of [owner.id, member.id, stranger.id])
    await run("DELETE FROM users WHERE id = ?", [u]);
  await limit.sweep();

  console.log(failures === 0 ? "\nOK (cleaned up)" : `\n${failures} FAILURE(S)`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
