"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function HeaderAuthLink({ signIn }: { signIn: string }) {
  if (usePathname() === "/login") return null;
  return (
    <Link href="/login" className="btn btn-quiet">
      {signIn}
    </Link>
  );
}
