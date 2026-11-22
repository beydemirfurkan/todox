import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";

import { userForSession } from "./services/auth";
import type { PublicUser } from "./types";
import { SESSION_COOKIE, SESSION_DAYS } from "./util/tokens";

/**
 * The real access check lives here, at the data boundary. Middleware only
 * redirects on a missing cookie for the sake of UX -- it runs before the
 * database is reachable and must never be treated as the gate.
 */
/**
 * Once per request. The layout asks, then the page, then its metadata, and
 * each used to send the same session lookup; `cache` hands them one answer.
 */
export const currentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await userForSession(token)) ?? null;
});

export async function requireUser(): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  return token;
}
