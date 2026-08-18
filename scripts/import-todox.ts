/**
 * Loads a `todox-export` file into an account on this instance.
 *
 * The other half of "run your own if the log matters to you". An export nobody
 * can load is a file, not a way out, so this exists to make the round trip real
 * rather than promised.
 *
 *   pnpm db:import ./todox-export-2026-08-18.json demo
 *
 * A script rather than an upload endpoint, deliberately: taking a file from a
 * browser and writing rows from it is a security surface with nothing to gain
 * here — the person doing this owns the database, is already at a shell, and
 * `db:migrate` and `seed` set the precedent.
 *
 * ADDITIVE, never destructive. Nothing is deleted and nothing is overwritten:
 * a project whose slug is taken is imported under the next free one. Importing
 * the same file twice gives you two copies, which is visible and undoable —
 * unlike a merge, which is neither.
 */
import "./env";

import { readFileSync } from "node:fs";

import { all, one, run } from "../lib/db/client";
import * as projects from "../lib/repositories/projects";
import * as users from "../lib/repositories/users";

type Row = Record<string, unknown>;

type Bundle = {
  format?: string;
  version?: number;
  projects?: Row[];
  project_paths?: Row[];
  tasks?: Row[];
  entries?: Row[];
  task_events?: Row[];
  contexts?: Row[];
  refs?: Row[];
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** Old id -> new id, per table. The file's ids are the source instance's. */
type IdMap = Map<number, number>;

function usage(): never {
  console.error("usage: pnpm db:import <export.json> <username>");
  process.exit(1);
}

async function main() {
  const [file, username] = process.argv.slice(2);
  if (!file || !username) usage();

  const bundle = JSON.parse(readFileSync(file, "utf8")) as Bundle;
  if (bundle.format !== "todox-export")
    throw new Error(`${file} is not a todox export (no "format": "todox-export")`);
  // Refused rather than guessed at. A future version may move a column, and
  // importing it as if nothing changed is how a restore quietly loses a field.
  if (bundle.version !== 1)
    throw new Error(`this build reads export version 1, and that file is version ${bundle.version}`);

  const user = await users.byUsername(username);
  if (!user) throw new Error(`no account called ${username} on this instance`);

  const projectIds: IdMap = new Map();
  const taskIds: IdMap = new Map();
  const contextIds: IdMap = new Map();

  for (const p of bundle.projects ?? []) {
    // Through `nextFreeSlug` rather than the stored slug: `slug` is unique per
    // account, and importing into an account that already has one of that name
    // has to land somewhere rather than fail halfway.
    const slug = await projects.nextFreeSlug(user.id, String(p.slug ?? p.name ?? "imported"));
    const row = await one<{ id: number }>(
      `INSERT INTO projects (user_id, slug, name, root_path, summary, archived, created_at, share_log)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [user.id, slug, p.name, p.root_path ?? null, p.summary ?? null, p.archived ?? 0,
       p.created_at, p.share_log ?? 0],
    );
    projectIds.set(num(p.id), row!.id);
  }

  for (const pp of bundle.project_paths ?? []) {
    const projectId = projectIds.get(num(pp.project_id));
    if (!projectId) continue;
    // `UNIQUE (user_id, path)`: the same checkout may already be registered to
    // another project here, and that is the account's existing answer to "where
    // is this repo". The import does not get to overrule it.
    await run(
      `INSERT INTO project_paths (project_id, user_id, path, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [projectId, user.id, pp.path, pp.created_at],
    );
  }

  for (const t of bundle.tasks ?? []) {
    const projectId = projectIds.get(num(t.project_id));
    if (!projectId) continue;
    const row = await one<{ id: number }>(
      `INSERT INTO tasks (project_id, title, body, status, priority, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [projectId, t.title, t.body ?? null, t.status, t.priority, t.created_at, t.updated_at,
       t.closed_at ?? null],
    );
    taskIds.set(num(t.id), row!.id);
  }

  for (const c of bundle.contexts ?? []) {
    // `project_id` is nullable and means account-wide, so a missing map entry
    // is only a problem when the file said there was a project.
    const projectId = c.project_id == null ? null : projectIds.get(num(c.project_id));
    if (c.project_id != null && !projectId) continue;
    const row = await one<{ id: number }>(
      `INSERT INTO contexts (user_id, project_id, kind, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [user.id, projectId, c.kind, c.title, c.body, c.created_at, c.updated_at],
    );
    contextIds.set(num(c.id), row!.id);
  }

  for (const e of bundle.entries ?? []) {
    const taskId = taskIds.get(num(e.task_id));
    if (!taskId) continue;
    // `user_id` stays null: the export carries no account ids, and inventing
    // one here would attribute somebody else's writing to whoever imported it.
    // `author` survives, which is the part that says agent or human.
    await run(
      `INSERT INTO entries (task_id, kind, body, author, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [taskId, e.kind, e.body, e.author ?? "agent", e.model ?? null, e.created_at],
    );
  }

  for (const v of bundle.task_events ?? []) {
    const taskId = taskIds.get(num(v.task_id));
    if (!taskId) continue;
    // Without these every duration in every report on the imported copy would
    // be zero, and a report that is confidently wrong is worse than one that
    // says it has nothing.
    await run(
      `INSERT INTO task_events (task_id, from_status, to_status, at, actor, model)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [taskId, v.from_status ?? null, v.to_status, v.at, v.actor ?? "agent", v.model ?? null],
    );
  }

  for (const r of bundle.refs ?? []) {
    const taskId = r.task_id == null ? null : taskIds.get(num(r.task_id));
    const contextId = r.context_id == null ? null : contextIds.get(num(r.context_id));
    if (!taskId && !contextId) continue;
    // Hashes come across as they were. The server has never seen these files
    // and cannot recompute them; dropping them would make every restored note
    // read "not checked" until an agent looked at every one again.
    await run(
      `INSERT INTO refs (task_id, context_id, path, note, hash, linked_at, hash_seen, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [taskId, contextId, r.path, r.note ?? null, r.hash ?? null, r.linked_at,
       r.hash_seen ?? null, r.checked_at ?? null],
    );
  }

  const counts = await all<{ label: string; n: string }>(
    `SELECT 'projects' AS label, COUNT(*) AS n FROM projects WHERE user_id = ?
     UNION ALL SELECT 'tasks', COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.user_id = ?
     UNION ALL SELECT 'entries', COUNT(*) FROM entries e JOIN tasks t ON t.id = e.task_id
       JOIN projects p ON p.id = t.project_id WHERE p.user_id = ?
     UNION ALL SELECT 'contexts', COUNT(*) FROM contexts WHERE user_id = ?`,
    [user.id, user.id, user.id, user.id],
  );

  console.log(`imported into @${username}:`);
  console.log(`  projects ${projectIds.size} · tasks ${taskIds.size} · contexts ${contextIds.size}`);
  console.log(`  the account now holds: ${counts.map((c) => `${c.label} ${c.n}`).join(" · ")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
