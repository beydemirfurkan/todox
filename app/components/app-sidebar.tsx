import Link from "next/link";
import { Suspense } from "react";

import type { T } from "@/lib/i18n";
import type { PublicUser } from "@/lib/types";

import { accountProjects } from "../account-projects";
import { AccountMenu } from "../features/account-menu";
import { Notifications } from "../features/notifications";
import { SearchBox } from "../features/search-box";
import { SidebarLink } from "../features/sidebar-link";
import { Icon } from "./icons";
import { LogoMark } from "./logo-mark";
import { projectColor } from "./project-color";

/**
 * The signed-in app's way around, from `md` up: the three places, every
 * project with its open count, then search and the account at the bottom.
 * On a phone it is hidden and the tab bar does the same job.
 */
export function AppSidebar({ user, t }: { user: PublicUser; t: T }) {
  return (
    <nav aria-label={t("sidebarLabel")} className="app-sidebar">
      <div className="flex items-center gap-2 px-3">
        <Link href="/" className="brand flex min-w-0 flex-1 items-center gap-2.5">
          <LogoMark size={26} />
          <span className="display text-[18px] leading-none">todox</span>
        </Link>
        <Suspense>
          <Notifications userId={user.id} />
        </Suspense>
      </div>

      <div className="flex flex-col gap-0.5">
        <SidebarLink href="/">
          <Icon name="sun" size={18} />
          <span className="flex-1">{t("navToday")}</span>
        </SidebarLink>
        <SidebarLink href="/report">
          <Icon name="chart" size={18} />
          <span className="flex-1">{t("navReport")}</span>
        </SidebarLink>
        <SidebarLink href="/me">
          <Icon name="brain" size={18} />
          <span className="flex-1">{t("navBrain")}</span>
        </SidebarLink>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5">
        <h2 className="px-3 pb-2 text-meta font-semibold tracking-[0.04em] text-faint uppercase">
          {t("sidebarProjects")}
        </h2>
        <Suspense fallback={null}>
          <SidebarProjects userId={user.id} t={t} />
        </Suspense>
      </div>

      <div className="flex flex-col gap-1.5">
        <Suspense>
          <SearchBox
            placeholder={t("sidebarSearch")}
            label={t("searchLabel")}
            clearLabel={t("searchClear")}
          />
        </Suspense>
        <AccountMenu
          name={user.name}
          username={user.username}
          initial={initial(user)}
          labels={{
            open: t("accountMenuOpen"),
            account: t("accountTitle"),
            brain: t("navBrain"),
            signOut: t("signOut"),
            signingOut: t("signingOut"),
          }}
        />
      </div>
    </nav>
  );
}

function initial(user: PublicUser): string {
  return (user.name.trim() || user.username).charAt(0).toUpperCase();
}

/** Its own boundary: two queries the rest of the sidebar does not wait for. */
async function SidebarProjects({ userId, t }: { userId: number; t: T }) {
  const { projects, counts } = await accountProjects(userId);
  if (!projects.length) {
    return <p className="px-3 text-meta leading-relaxed text-faint">{t("sidebarNoProjects")}</p>;
  }
  return (
    <ul className="sidebar-projects flex min-h-0 flex-1 flex-col gap-0.5">
      {projects.map((project) => {
        const count = counts.map.get(project.id);
        const open = count ? count.todo + count.doing + count.blocked : 0;
        return (
          <li key={project.id}>
            <SidebarLink href={`/p/${project.slug}`} title={project.name}>
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: projectColor(project.id) }}
              />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {open > 0 && (
                <span className="text-meta text-faint">
                  <span className="sr-only">{open === 1 ? t("sidebarOpenCountOne") : t("sidebarOpenCount", { n: open })}</span>
                  <span aria-hidden="true">{open}</span>
                </span>
              )}
            </SidebarLink>
          </li>
        );
      })}
    </ul>
  );
}
