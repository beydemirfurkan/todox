import { exec } from "./client";

/**
 * One idempotent schema, applied by `pnpm db:migrate`.
 *
 * Deliberately not run on cold start: DDL on every serverless invocation is a
 * race waiting to happen, and a deploy step is the honest place for it.
 *
 * The SQLite-era column backfills are gone. Postgres is a clean start, and
 * anyone coming from the old local file goes through `scripts/import-sqlite.ts`
 * rather than dragging a migration history nobody else ever had.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  username          TEXT NOT NULL,
  email             TEXT NOT NULL,
  name              TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  email_verified_at TEXT
);
-- case-insensitive uniqueness: "Furkan" and "furkan" are the same account
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email    ON users (lower(email));

-- Single-use secrets for password reset and email verification. Only the hash
-- is stored, and it dies once used.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose);

-- Fixed-window counters. On Postgres these are shared by every instance, so
-- the limits finally hold across a horizontally scaled deployment.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket   TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits (reset_at);

CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens (user_id);

CREATE TABLE IF NOT EXISTS projects (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  root_path    TEXT,
  summary      TEXT,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  -- public read-only sharing: null token means not shared
  share_token  TEXT UNIQUE,
  share_log    INTEGER NOT NULL DEFAULT 0,
  -- slugs are per account: two people may both have a "todox"
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  status     TEXT NOT NULL DEFAULT 'todo',
  priority   INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id, status);

-- The work log. This is the part no issue tracker has: an append-only record
-- of what was decided, what was tried and failed, and what the last session
-- left behind. A cold agent reads this instead of asking the human.
CREATE TABLE IF NOT EXISTS entries (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT 'agent',
  model      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_task ON entries (task_id, id);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries (created_at);

-- Every status transition, so reports can answer "how long did this take"
-- without guessing from updated_at.
CREATE TABLE IF NOT EXISTS task_events (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'agent',
  model       TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events (task_id, id);
CREATE INDEX IF NOT EXISTS idx_events_at ON task_events (at);

-- project_id NULL means "account-wide", so the owner is tracked here directly
-- rather than borrowed from the project.
CREATE TABLE IF NOT EXISTS contexts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts (project_id);
CREATE INDEX IF NOT EXISTS idx_contexts_user ON contexts (user_id);

-- Files in play, hashed at link time so we can tell the agent when a note it
-- is about to trust describes code that has since moved on.
CREATE TABLE IF NOT EXISTS refs (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  context_id INTEGER REFERENCES contexts(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  note       TEXT,
  hash       TEXT,
  linked_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refs_task ON refs (task_id);
`;

/**
 * The HTTP driver refuses multiple commands in one request, so the schema is
 * split and issued statement by statement. Everything is IF NOT EXISTS, so a
 * partial run simply resumes on the next attempt.
 *
 * Safe to split naively on `;` because none of the statements above contain a
 * semicolon inside a string literal.
 */
export function statements(): string[] {
  return SCHEMA.split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

export async function migrate() {
  for (const statement of statements()) await exec(statement);
}
