import { timingSafeEqual } from "node:crypto";

import { OAUTH_PROVIDERS, type OAuthProvider } from "../repositories/oauth-accounts";

/**
 * The parts of a trip to a provider and back that are plain logic, apart
 * from the route handlers so they can be asserted without a request.
 */

export const isProvider = (value: string): value is OAuthProvider =>
  (OAUTH_PROVIDERS as readonly string[]).includes(value);

/**
 * Where a sign-in may land afterwards. An open redirect on the sign-in path
 * is a phishing kit, so this is an allow-list, not a same-origin check:
 * an invitation being accepted, or the account page that started a link.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  if (/^\/invite\?token=[A-Za-z0-9_-]{32,}$/.test(value)) return value;
  if (/^\/account(\?tab=[a-z]+)?$/.test(value)) return value;
  return "/";
}

/** What the start route leaves in its cookie for the callback to check. */
export interface PendingSignIn {
  provider: OAuthProvider;
  state: string;
  codeVerifier: string;
  next: string;
}

export const encodePending = (pending: PendingSignIn) =>
  Buffer.from(JSON.stringify(pending)).toString("base64url");

export function decodePending(cookie: string | undefined): PendingSignIn | null {
  if (!cookie) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { provider, state, codeVerifier, next } = value as Record<string, unknown>;
    if (typeof provider !== "string" || !isProvider(provider)) return null;
    if (typeof state !== "string" || typeof codeVerifier !== "string") return null;
    return { provider, state, codeVerifier, next: safeNext(typeof next === "string" ? next : "") };
  } catch {
    // A cookie that is not ours, or was cut short, is the same as no cookie.
    return null;
  }
}

/** Constant-time, so the state cannot be guessed a character at a time. */
export function stateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
