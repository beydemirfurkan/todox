/**
 * One-way import from a pre-Postgres todox database.
 *
 * todox used to store everything in a local SQLite file. Anyone upgrading --
 * including the person who wrote it -- should not have to abandon their log,
 * so this copies a `~/.todox/todox.db` into the configured Postgres.
 *
 *   pnpm db:import-sqlite [path-to.db]
 *
 * Ids are not preserved: rows are inserted fresh and re-linked through a map,
 * because the target may already contain accounts of its own.
 */
import "./env";

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { one, run } from "../lib/db/client";

const require_ = createRequire(import.meta.url ?? __filename);

type Row = Record<string, unknown>;

const SOURCE =
  process.argv[2] ?? process.env.TODOX_SQLITE ?? join(homedir(), ".todox", "todox.db");

function openSqlite(path: string) {
  try {
    const Database = require_("better-sqlite3");
    return new Database(path, { readonly: true });
  } catch {
    throw new Error(
      "better-sqlite3 is not installed. It was removed when todox moved to " +
        "Postgres; add it back temporarily with `pnpm add -D better-sqlite3` " +
        "to run this import, then remove it again.",
    );
  }
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`no SQLite database at ${SOURCE}`);
    process.exit(1);
  }
  console.log(`importing from ${SOURCE}`);

  const db = openSqlite(SOURCE);
  const read = (table: string): Row[] => {
    try {
      return db.prepare(`SELECT * FROM ${table}`).all() as Row[];
    } catch {
      return []; // table did not exist in that vintage of the schema
    }
  };

  const users = new Map<number, number>();
  const projects = new Map<number, number>();
  const tasks = new Map<number, number>();
  const contexts = new Map<number, number>();

  for (const u of read("users")) {
    const existing = await one<{ id: number }>(
      "SELECT id FROM users WHERE lower(username) = lower(?)",
      [u.username],
    );
    if (existing) {
      users.set(u.id as number, existing.id);
      console.log(`  user @${u.username} already exists, reusing`);
      continue;
    }
    const row = await one<{ id: number }>(
      `INSERT INTO users (username, email, name, password_hash, created_at, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [u.username, u.email, u.name, u.password_hash, u.created_at, u.email_verified_at ?? null],
    );
    users.set(u.id as number, row!.id);
  }

  for (const p of read("projects")) {
    const owner = users.get(p.user_id as number);
    if (!owner) continue; // orphaned rows have nowhere to go
    const row = await one<{ id: number }>(
      `INSERT INTO projects (user_id, slug, name, root_path, summary, archived, created_at, share_token, share_log)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        owner,
        p.slug,
        p.name,
        p.root_path ?? null,
        p.summary ?? null,
        p.archived ?? 0,
        p.created_at,
        p.share_token ?? null,
        p.share_log ?? 0,
      ],
    );
    projects.set(p.id as number, row!.id);
  }

  for (const t of read("tasks")) {
    const project = projects.get(t.project_id as number);
    if (!project) continue;
    const row = await one<{ id: number }>(
      `INSERT INTO tasks (project_id, title, body, status, priority, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        project,
        t.title,
        t.body ?? null,
        t.status,
        t.priority,
        t.created_at,
        t.updated_at,
        t.closed_at ?? null,
      ],
    );
    tasks.set(t.id as number, row!.id);
  }

  for (const c of read("contexts")) {
    const owner = users.get(c.user_id as number);
    if (!owner) continue;
    const row = await one<{ id: number }>(
      `INSERT INTO contexts (user_id, project_id, kind, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        owner,
        c.project_id ? (projects.get(c.project_id as number) ?? null) : null,
        c.kind,
        c.title,
        c.body,
        c.created_at,
        c.updated_at,
      ],
    );
    contexts.set(c.id as number, row!.id);
  }

  for (const e of read("entries")) {
    const task = tasks.get(e.task_id as number);
    if (!task) continue;
    await run(
      `INSERT INTO entries (task_id, kind, body, author, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [task, e.kind, e.body, e.author, e.model ?? null, e.created_at],
    );
  }

  for (const v of read("task_events")) {
    const task = tasks.get(v.task_id as number);
    if (!task) continue;
    await run(
      `INSERT INTO task_events (task_id, from_status, to_status, at, actor, model)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [task, v.from_status ?? null, v.to_status, v.at, v.actor, v.model ?? null],
    );
  }

  for (const r of read("refs")) {
    const task = r.task_id ? tasks.get(r.task_id as number) : null;
    const context = r.context_id ? contexts.get(r.context_id as number) : null;
    if (!task && !context) continue;
    await run(
      `INSERT INTO refs (task_id, context_id, path, note, hash, linked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [task ?? null, context ?? null, r.path, r.note ?? null, r.hash ?? null, r.linked_at],
    );
  }

  db.close();
  console.log(
    `imported ${users.size} user(s), ${projects.size} project(s), ${tasks.size} task(s)`,
  );
  console.log("sessions and API tokens were not copied -- sign in and re-issue them");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
