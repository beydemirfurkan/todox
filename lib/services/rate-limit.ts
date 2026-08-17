import { createHash } from "node:crypto";

import * as repo from "../repositories/rate-limits";

/**
 * Rate limiting policy, in one table so the numbers can be argued about
 * without hunting through call sites.
 *
 * Login counts only *failures*, so somebody legitimately signing in on ten
 * devices is never locked out by their own success. Everything else counts
 * attempts, because the attempt itself is the cost (an email sent, a row
 * written, a hash computed).
 *
 * The counters live in Postgres, so the limits hold across every instance
 * rather than per process.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const POLICIES = {
  loginPerIdentity: { limit: 8, windowMs: 15 * MINUTE },
  loginPerIp: { limit: 40, windowMs: 15 * MINUTE },
  registerPerIp: { limit: 5, windowMs: HOUR },
  resetPerIp: { limit: 8, windowMs: HOUR },
  resetPerEmail: { limit: 3, windowMs: HOUR },
  verifyResendPerUser: { limit: 5, windowMs: HOUR },
  // Each one sends two emails -- a verification and a warning to the old
  // address -- and nobody changes their address five times an hour.
  emailChangePerUser: { limit: 5, windowMs: HOUR },
  invitePerUser: { limit: 20, windowMs: HOUR },
  invitePerRecipient: { limit: 5, windowMs: HOUR },
  badTokenPerIp: { limit: 20, windowMs: 15 * MINUTE },
  /**
   * Everything an authenticated agent does, per token.
   *
   * Presenting a valid token used to buy unlimited calls, which made a leaked
   * one an unmetered way to run `ILIKE '%…%'` scans over somebody's whole log.
   * The ceiling is set well above real work -- a busy session is tens of calls,
   * not hundreds -- so it should only ever be met by a loop that has come off
   * its rails.
   */
  agentPerToken: { limit: 600, windowMs: 15 * MINUTE },
  /**
   * Views of a share link, per address.
   *
   * The only page that answers without a session, and it reads a project's
   * tasks and their log on every hit. The lists are capped now, but a capped
   * read is still a read, and nothing was counting them -- a crawler that
   * ignores the noindex, or anyone who kept the URL, could ask as often as it
   * liked. Set high enough that a person reading a shared project and following
   * its links never notices.
   */
  sharePerIp: { limit: 120, windowMs: 15 * MINUTE },
} as const;

export type PolicyName = keyof typeof POLICIES;

export type Verdict = { allowed: true } | { allowed: false; retryAfterSec: number };

/** Identifiers can be emails; hash them so the table holds no personal data. */
const key = (policy: PolicyName, subject: string) =>
  `${policy}:${createHash("sha256").update(subject.toLowerCase()).digest("base64url").slice(0, 22)}`;

/** Check-and-count. Call before doing the work. */
export async function consume(policy: PolicyName, subject: string): Promise<Verdict> {
  const { limit, windowMs } = POLICIES[policy];
  const w = await repo.bump(key(policy, subject), windowMs);
  if (Number(w.count) <= limit) return { allowed: true };
  return { allowed: false, retryAfterSec: retryIn(w.reset_at) };
}

/** Check without counting. Use when only failures should count. */
export async function check(policy: PolicyName, subject: string): Promise<Verdict> {
  const { limit } = POLICIES[policy];
  const w = await repo.peek(key(policy, subject));
  if (!w || Number(w.count) < limit) return { allowed: true };
  return { allowed: false, retryAfterSec: retryIn(w.reset_at) };
}

export const penalise = (policy: PolicyName, subject: string) =>
  repo.bump(key(policy, subject), POLICIES[policy].windowMs);

/** A success wipes the slate, so one typo does not haunt the next hour. */
export const forgive = (policy: PolicyName, subject: string) =>
  repo.clear(key(policy, subject));

const retryIn = (resetAt: string) =>
  Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000));

export const sweep = repo.purgeExpired;
