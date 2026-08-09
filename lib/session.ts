import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { userForSession } from "./services/auth";
import type { PublicUser } from "./types";
import { SESSION_COOKIE, SESSION_DAYS } from "./util/tokens";

/**
 * The real access check lives here, at the data boundary. Middleware only
 * redirects on a missing cookie for the sake of UX -- it runs before the
 * database is reachable and must never be treated as the gate.
 */
export async function currentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await userForSession(token)) ?? null;
}

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
