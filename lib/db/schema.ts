import { exec } from "./client";
import { FTS_INDEXES } from "./fts";

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
-- case-insensitive uniqueness: "Ada" and "ada" are the same account
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

-- Collaborators keep a user-local route slug. A person can therefore join two
-- projects whose owners both called them "website" without making /p/website
-- ambiguous in that person's account.
CREATE TABLE IF NOT EXISTS project_memberships (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_slug   TEXT NOT NULL,
  root_path     TEXT,
  invited_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (project_id, user_id),
  UNIQUE (user_id, access_slug)
);
CREATE INDEX IF NOT EXISTS idx_project_memberships_user
  ON project_memberships (user_id, project_id);

-- Invitation links contain a random secret and only its hash reaches the
-- database. Accepted and revoked rows remain as a small audit trail.
CREATE TABLE IF NOT EXISTS project_invitations (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  invited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  accepted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_invitations_email
  ON project_invitations (lower(email), expires_at);
CREATE INDEX IF NOT EXISTS idx_project_invitations_project
  ON project_invitations (project_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_invitations_pending
  ON project_invitations (project_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- The one place that tells an account something happened while it was not
-- looking. Deliberately a table rather than a query over invitations and
-- memberships: "read" has to survive, and a badge that cannot be cleared stops
-- being a notification and becomes decoration.
-- actor_id is SET NULL rather than CASCADE for the same reason the log is:
-- somebody deleting their account should cost the notice its name, not its
-- existence.
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- The only handle on somebody who has no account yet: the invited address.
  detail     TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id) WHERE read_at IS NULL;

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
-- The order every list of tasks is read in, so a bounded read can stop early
-- instead of sorting the project's whole backlog to show the top of it.
--
-- Worth nothing on its own, and that was measured rather than assumed: without
-- a LIMIT the planner ignores it, correctly, because every matching row has to
-- be read anyway. With one it is the difference between 33.5ms and 0.16ms on a
-- project holding 20,500 tasks. The status column is deliberately not in it:
-- the open filter matches several statuses at once, and an index ordered
-- inside each one cannot satisfy an ORDER BY that spans them.
CREATE INDEX IF NOT EXISTS idx_tasks_project_rank
  ON tasks (project_id, priority, updated_at DESC);

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

-- How a question stops being open.
--
-- \`question\` had no way to close. It came back in every briefing and every
-- report window for ever, and the three ways out were all bad: delete_entry is
-- forbidden by its own description, closing the task hides it as a side effect
-- rather than a mechanism, and writing the answer beside it left both in every
-- briefing with nothing connecting them.
--
-- A column on the *answer* rather than a status on the question, because this
-- table is the append-only half of todox and a resolved_at would have been the
-- first mutation in it. Nothing is rewritten: a new row says what settled an
-- older one, which also keeps the pairing that until now existed only in the
-- prose of two entries that happened to sit near each other.
--
-- SET NULL rather than CASCADE: deleting an answer must not delete the
-- question, it must reopen it.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS answers_entry_id INTEGER
  REFERENCES entries(id) ON DELETE SET NULL;

-- The briefing asks "does anything answer this?" once per open task, so the
-- lookup goes the other way round from every other index on this table.
CREATE INDEX IF NOT EXISTS idx_entries_answers ON entries (answers_entry_id)
  WHERE answers_entry_id IS NOT NULL;

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
-- Files in play. \`hash\` is what the file looked like when it was linked;
-- \`hash_seen\` is what the agent last found on disk. Both are computed where
-- the code actually lives -- this server has no copy of the repository, so it
-- stores them and compares them, and never reads a file itself.
CREATE TABLE IF NOT EXISTS refs (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  context_id INTEGER REFERENCES contexts(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  note       TEXT,
  hash       TEXT,
  linked_at  TEXT NOT NULL,
  hash_seen  TEXT,
  checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refs_task ON refs (task_id);
CREATE INDEX IF NOT EXISTS idx_refs_context ON refs (context_id);
-- \`path\` was write-only: every read went in by task_id, context_id or id, and
-- the two unique indexes below lead on those columns, so neither can serve a
-- lookup that starts from the path. That left the one question a coding agent
-- actually asks -- "what do we already know about the file I am editing?" --
-- unanswerable over data todox had all along.
-- A plain btree, and equality is all it needs: \`get_file_context\` folds a path
-- to its repo-relative form and expands it back across every root the project
-- is known by, so the comparison is \`= ANY(...)\` rather than a prefix or a
-- LIKE. Nothing depends on it existing -- a migration is a separate deploy step
-- (see \`db:migrate\` above), so until it runs the same query is correct and
-- slower, which is the only thing an index may ever be allowed to change.
CREATE INDEX IF NOT EXISTS idx_refs_path ON refs (path);


-- Existing installs predate the two columns above. Postgres makes this
-- idempotent, so it belongs inline rather than in a migration history.
-- A project used to be identified by where it sat on one laptop, which means
-- nothing on the next machine, in CI, or to anybody else. The remote is the
-- name it has everywhere.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_url TEXT;

-- Looking a project up by its remote, which is the point of the column above.
-- Not unique: two projects may share a remote on purpose -- separate worktrees
-- of one repo, kept apart because their logs are about different work.
CREATE INDEX IF NOT EXISTS idx_projects_repo ON projects (user_id, repo_url);

-- The same repository sits at a different absolute path on every machine, so
-- one \`projects.root_path\` cannot identify it. It stays as the first path seen
-- (every read already projects it, including the member CASE in ACCESS_SELECT);
-- each further machine adds a row here and resolution looks at both.
--
-- \`user_id\` rather than project alone, for the same reason
-- \`project_memberships\` carries its own root_path: a path is a fact about
-- somebody's machine, and a collaborator's checkout must not answer a lookup
-- made by the owner.
--
-- UNIQUE (user_id, path) is the invariant that makes the split unrepeatable:
-- one directory cannot belong to two projects for one person.
CREATE TABLE IF NOT EXISTS project_paths (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  path        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, path)
);
CREATE INDEX IF NOT EXISTS idx_project_paths_project
  ON project_paths (project_id, user_id);

ALTER TABLE refs ADD COLUMN IF NOT EXISTS hash_seen  TEXT;
ALTER TABLE refs ADD COLUMN IF NOT EXISTS checked_at TEXT;

-- Who wrote it. \`author\` only ever said 'human' or 'agent', which is enough
-- in an account of one and useless in a shared project: two people and their
-- agents all wrote 'human' and 'agent'.
-- SET NULL, not CASCADE: a collaborator who deletes their account must not
-- take the project's log with them. The signature goes, the entry stays, and
-- the row falls back to the author column it already had.
ALTER TABLE entries     ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Last MCP client to use this token. The stdio path reads the parent's
-- TODOX_CLIENT_NAME at startup, the HTTP path catches the initialize message
-- from the JSON-RPC body, and both write through recordClientInfo. The
-- get_context tool then surfaces it so the agent hears client-specific
-- advice (edit ~/.claude/CLAUDE.md on Claude Code, edit AGENTS.md on
-- OpenCode, and so on). Last-write-wins: one token shared across a laptop
-- and CI sees the most recent user's client, which is the right trade-off
-- because the wrong note is louder than the right note, and the user can
-- read the mismatch themselves.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS last_client_name    TEXT;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS last_client_version TEXT;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS last_client_seen_at TEXT;

-- Linking the same file to the same task twice was allowed, and \`link_files\`
-- is described to agents as safe to call again. Every repeat added a row: the
-- briefing listed the file N times, the agent re-hashed it N times, and once a
-- task passed 500 refs the write-back stopped fitting in its own limit.
-- The oldest row wins the de-duplication, because its \`hash\` is the baseline
-- the note was actually written against.
DELETE FROM refs a USING refs b
 WHERE a.id > b.id
   AND a.path = b.path
   AND a.task_id IS NOT DISTINCT FROM b.task_id
   AND a.context_id IS NOT DISTINCT FROM b.context_id;

-- Partial: a ref belongs to a task or to a context, and NULLs would otherwise
-- compare as distinct and let the duplicates straight back in.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refs_task ON refs (task_id, path)
  WHERE task_id IS NOT NULL;
-- The other half. Only task refs were covered, so a context could still
-- collect the same path twice: \`refs.link\` guards with NOT EXISTS, which two
-- concurrent calls both pass. That left the DELETE above as the only thing
-- clearing them, which made a migration into a repair job -- it ran on every
-- deploy and quietly tidied duplicates that should never have been insertable.
-- With both indexes in place that statement is what it reads as: a one-time
-- backfill for databases that predate them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refs_context ON refs (context_id, path)
  WHERE context_id IS NOT NULL;

-- What search reads, and the reason it can afford to.
--
-- These were written once before and taken straight back out, because
-- \`EXPLAIN\` showed a sequential scan with them in place: the substring arm of
-- the search sat in the same \`OR\` as the full-text one, and a single
-- non-indexable branch makes the whole disjunction non-indexable. The indexes
-- were right and the query was wrong. \`services/search.ts\` now asks the two
-- questions separately and unions the ids, which is what lets these be used --
-- so the shape of that query is not a style choice, and changing it back
-- silently un-indexes search without failing anything.
--
-- Built from \`db/fts.ts\`, which \`search.ts\` also builds its \`WHERE\` from.
-- An expression index that does not match the query character for character is
-- ignored in silence, so the expression has exactly one definition.
${FTS_INDEXES}
`;

/**
 * The HTTP driver refuses multiple commands in one request, so the schema is
 * split and issued statement by statement. Everything is IF NOT EXISTS, so a
 * partial run simply resumes on the next attempt.
 *
 * Safe to split naively on `;` because none of the statements above contain a
 * semicolon inside a string literal — and none of the *comments* do either,
 * which matters just as much: `--` lines are stripped after the split, not
 * before, so a semicolon in prose cuts the comment in half and the tail of the
 * sentence arrives at Postgres as the start of a statement. That is a syntax
 * error at position 1 on a word from the middle of an explanation, which is a
 * confusing way to spend ten minutes.
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
