"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The signed-out header's one button. On the sign-in page it offers the
 * other way in: a "Sign in" button above a sign-in form only repeats it.
 */
export function HeaderAuthLink({ signIn, signUp }: { signIn: string; signUp: string }) {
  const isOnLogin = usePathname() === "/login";
  return (
    <Link href={isOnLogin ? "/register" : "/login"} className="btn btn-quiet">
      {isOnLogin ? signUp : signIn}
    </Link>
  );
}
