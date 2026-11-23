import { timingSafeEqual } from "node:crypto";

import { OAUTH_PROVIDERS, type OAuthProvider } from "../repositories/oauth-accounts";

/**
 * The parts of a trip to a provider and back that are plain logic, apart
 * from the route handlers so they can be asserted without a request.
 */

export const isProvider = (value: string): value is OAuthProvider =>
  (OAUTH_PROVIDERS as readonly string[]).includes(value);

const INVITE_NEXT = /^\/invite\?token=([A-Za-z0-9_-]{32,})$/;

export function inviteTokenFromNext(value: string | null | undefined): string | undefined {
  return value ? INVITE_NEXT.exec(value)?.[1] : undefined;
}

/**
 * An agent's connection waiting on the consent page. The path is fixed, so
 * the query cannot point anywhere else, and the page re-checks every
 * parameter in it before doing anything.
 */
const AUTHORIZE_NEXT = /^\/oauth\/authorize\?[A-Za-z0-9\-._~%&=+]{1,4000}$/;

export const isAuthorizeNext = (value: string | null | undefined): boolean =>
  typeof value === "string" && AUTHORIZE_NEXT.test(value);

/**
 * A page a signed-out visitor was in the middle of, which signing in should
 * return them to: an invitation, or an agent waiting for approval.
 */
export function resumablePath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return inviteTokenFromNext(value) || isAuthorizeNext(value) ? value : undefined;
}

/**
 * Where a sign-in may land afterwards. An open redirect on the sign-in path
 * is a phishing kit, so this is an allow-list, not a same-origin check:
 * an invitation being accepted, an agent's connection waiting for approval,
 * or the account page that started a link.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  if (resumablePath(value)) return value;
  if (/^\/account(\?tab=[a-z]+)?$/.test(value)) return value;
  return "/";
}

/** What the start route leaves in its cookie for the callback to check. */
export interface PendingSignIn {
  provider: OAuthProvider;
  state: string;
  codeVerifier: string;
  next: string;
  /** Set only when a signed-in account is linking a new identity. */
  linkGrant?: string;
}

export const encodePending = (pending: PendingSignIn) =>
  Buffer.from(JSON.stringify(pending)).toString("base64url");

export function decodePending(cookie: string | undefined): PendingSignIn | null {
  if (!cookie) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { provider, state, codeVerifier, next, linkGrant } = value as Record<string, unknown>;
    if (typeof provider !== "string" || !isProvider(provider)) return null;
    if (typeof state !== "string" || typeof codeVerifier !== "string") return null;
    return {
      provider,
      state,
      codeVerifier,
      next: safeNext(typeof next === "string" ? next : ""),
      ...(typeof linkGrant === "string" ? { linkGrant } : {}),
    };
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
