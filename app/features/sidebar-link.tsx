"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LinkPending } from "./link-pending";

/** Today owns "/" only; every other place owns its own subtree. */
export function isCurrentPlace(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A row in the sidebar that knows whether it is the page you are on.
 *
 * The sidebar itself is a server component, because it reads the project
 * list; only the "where am I" bit needs the pathname, so only this is client.
 */
export function SidebarLink({
  href,
  children,
  title,
}: {
  href: string;
  children: React.ReactNode;
  title?: string;
}) {
  const pathname = usePathname();
  const isCurrent = isCurrentPlace(href, pathname);
  return (
    <Link
      href={href}
      title={title}
      className="sidebar-link"
      aria-current={isCurrent ? "page" : undefined}
    >
      {children}
      <LinkPending />
    </Link>
  );
}
