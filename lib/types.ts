import type { ContextKind, EntryKind, NotificationKind, Status } from "./constants";

/**
 * Row shapes, in one place so repositories can depend on the data contract
 * rather than on each other.
 */

export type User = {
  id: number;
  username: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
  email_verified_at: string | null;
};

export const AUTH_TOKEN_PURPOSES = ["reset", "verify"] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export type AuthTokenRow = {
  id: number;
  user_id: number;
  purpose: AuthTokenPurpose;
  token_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

/** Everything the UI needs about the signed-in person, minus the secret. */
export type PublicUser = Omit<User, "password_hash">;

export type Session = {
  id: number;
  user_id: number;
  token_hash: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
};

export type ApiToken = {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
};

export type Project = {
  id: number;
  user_id: number | null;
  slug: string;
  name: string;
  root_path: string | null;
  /** Where the repository is for everyone, rather than where it sits on one laptop. */
  repo_url: string | null;
  summary: string | null;
  archived: number;
  created_at: string;
  share_token: string | null;
  share_log: number;
  /** The caller's relationship to this project, when loaded privately. */
  access_role?: "owner" | "member";
  /** Who it belongs to. Only selected on the private reads that join users. */
  owner_name?: string;
};

export type ProjectMembership = {
  id: number;
  project_id: number;
  user_id: number;
  access_slug: string;
  root_path: string | null;
  invited_by: number | null;
  created_at: string;
};

export type ProjectInvitation = {
  id: number;
  project_id: number;
  email: string;
  token_hash: string;
  invited_by: number | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: number | null;
  revoked_at: string | null;
};

export type Task = {
  id: number;
  project_id: number;
  title: string;
  body: string | null;
  status: Status;
  priority: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type Entry = {
  id: number;
  task_id: number;
  kind: EntryKind;
  body: string;
  author: string;
  model: string | null;
  /** Null on everything written before the column existed, and on rows whose
   *  author has since deleted their account. `author` still answers. */
  user_id: number | null;
  /**
   * The `question` this entry settles, and the only way one ever closes.
   *
   * On the answer rather than the question, because this table is the
   * append-only half of todox: nothing is rewritten, a later row simply says
   * what an earlier one resolved. Null on every entry that answers nothing,
   * which is nearly all of them.
   */
  answers_entry_id: number | null;
  created_at: string;
};

/** An entry with its author resolved, from the reads that join `users`. */
export type EntryView = Entry & { author_name: string | null };

export type Context = {
  id: number;
  user_id: number | null;
  project_id: number | null;
  kind: ContextKind;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type Ref = {
  id: number;
  task_id: number | null;
  context_id: number | null;
  path: string;
  note: string | null;
  /** The file as it was when the note was written. */
  hash: string | null;
  linked_at: string;
  /** What the agent last found on disk; null once checked means it is gone. */
  hash_seen: string | null;
  checked_at: string | null;
};

/** One status transition. This is what makes "how long did it take" answerable. */
export type TaskEvent = {
  id: number;
  task_id: number;
  from_status: Status | null;
  to_status: Status;
  at: string;
  actor: string;
  model: string | null;
  user_id: number | null;
};

export type Notification = {
  id: number;
  user_id: number;
  kind: NotificationKind;
  project_id: number | null;
  actor_id: number | null;
  detail: string | null;
  created_at: string;
  read_at: string | null;
};

/** What the bell renders: the row, plus the two names it refers to. */
export type NotificationView = Notification & {
  project_name: string | null;
  project_slug: string | null;
  actor_name: string | null;
};

export type RefStatus = "fresh" | "changed" | "missing" | "unknown";

/**
 * What an agent did, as opposed to what an agent said it did.
 *
 * Written by the stdio process from git while the session runs, so a session
 * that ends without a handoff still leaves the next one something to read.
 * Never an entry: nobody has vouched for this, and the curated log is the
 * part of todox whose worth depends on somebody having done so.
 */
export type Observation = {
  id: number;
  user_id: number;
  project_id: number;
  /** Minted by the carrier at startup. One row per session per project. */
  session_id: string;
  /** Which carrier saw this: stdio today, a Claude Code hook next. */
  source: string;
  client: string | null;
  branch: string | null;
  /** Where HEAD was when the session opened, and where it is now. */
  base_sha: string | null;
  head_sha: string | null;
  commits: number;
  files_changed: number;
  /** Subject lines, newest first, capped by the writer. */
  commit_subjects: string | null;
  started_at: string;
  observed_at: string;
  expires_at: string;
  /** Set once an agent turns this into a real record, and never unset. */
  promoted_at: string | null;
  promoted_as: string | null;
};

/**
 * What a carrier has to supply, and what it may leave out.
 *
 * Only the four that identify the row and carry its point are required. Every
 * nullable column is optional here rather than "required and nullable": the
 * caller is a process reading a checkout that may not answer -- a detached
 * HEAD has no branch, a repository with no origin has no remote -- and making
 * it spell out five nulls to say "I could not tell" is how a carrier ends up
 * writing a plausible value instead.
 *
 * `expires_at` is absent on purpose and cannot be passed: retention is the
 * server's to decide, from the server's clock.
 */
export type NewObservation = {
  user_id: number;
  project_id: number;
  session_id: string;
  commits: number;
  files_changed: number;
  source?: string;
  client?: string | null;
  branch?: string | null;
  base_sha?: string | null;
  head_sha?: string | null;
  commit_subjects?: string | null;
  started_at?: string;
  observed_at?: string;
};

/** The briefing's view: the row without the bookkeeping nobody reading it needs. */
export type BriefingObservation = Omit<
  Observation,
  "user_id" | "project_id" | "session_id" | "expires_at" | "promoted_at" | "promoted_as"
>;
