"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LinkPending } from "./link-pending";

import { Icon, type IconName } from "../components/icons";

export interface Tab {
  href: string;
  label: string;
  icon: IconName;
}

/** Projects and their tasks are reached from Today on a phone. */
function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/p/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The phone's way around the app: five places, always under the thumb.
 *
 * On a phone the header used to be the only navigation, and the report and the
 * brain were two items inside a dropdown -- reachable, but nobody would find
 * them. From `md` up the header has room for everything and this is gone.
 *
 * Labels arrive translated: the translator is a server function and cannot
 * cross into a client component.
 */
export function TabBar({ tabs, label }: { tabs: Tab[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="tab-bar md:hidden">
      {tabs.map((tab) => {
        const active = isActive(tab.href, pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="tab-bar-item"
            aria-current={active ? "page" : undefined}
          >
            <span className="tab-bar-icon"><Icon name={tab.icon} size={21} /></span>
            <span className="tab-bar-label">{tab.label}</span>
            <LinkPending />
          </Link>
        );
      })}
    </nav>
  );
}
