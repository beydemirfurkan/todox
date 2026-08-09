import type { ContextKind, EntryKind, Status } from "./constants";

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
  summary: string | null;
  archived: number;
  created_at: string;
  share_token: string | null;
  share_log: number;
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
  created_at: string;
};

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
};

export type RefStatus = "fresh" | "changed" | "missing" | "unknown";
