import Link from "next/link";

/**
 * Tabs, as links.
 *
 * Deliberately not `role="tab"`. A real tablist owes the reader arrow-key
 * movement and a roving tabindex, which needs JavaScript and a focus manager;
 * these are navigations, and the app already speaks that dialect twice — the
 * project's status filters and the report's period switch are the same shape
 * with `aria-current="page"`. Being links also means the choice survives a
 * refresh, can be sent to somebody, and works with scripting off.
 *
 * The selected look comes from `.seg`, which reads `aria-current`, so a tab
 * that forgets to say which one it is renders as unselected rather than
 * looking right while announcing nothing.
 */
export type Tab = {
  id: string;
  label: string;
  href: string;
  /** Shown beside the label. Omit rather than pass zero for an empty section. */
  count?: number;
};

export function Tabs({
  tabs,
  current,
  label,
}: {
  tabs: Tab[];
  current: string;
  /** Names the group for anyone who cannot see it, e.g. "Account sections". */
  label: string;
}) {
  return (
    <nav aria-label={label} className="pop flex flex-wrap gap-1.5">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === current ? "page" : undefined}
          className="pill seg"
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="mono ml-1.5 opacity-70">{tab.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/** Picks the asked-for tab, falling back to the first rather than to nothing. */
export function currentTab(tabs: Tab[], asked: string | string[] | undefined) {
  const want = Array.isArray(asked) ? asked[0] : asked;
  return tabs.some((x) => x.id === want) ? want! : tabs[0].id;
}
