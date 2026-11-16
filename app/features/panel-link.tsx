"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** Tailwind's `lg`: the width at which the panel sits beside the board. */
const PANEL_BESIDE_BOARD = "(min-width: 1024px)";

/**
 * A link to a task that opens it in the board's side panel when there is one
 * beside the board, and on its own page when there is not.
 *
 * `href` is the task's page, so this is an ordinary link first: it works with
 * scripting off, opens in a new tab, and is where a phone goes -- below `lg`
 * the panel is stacked under sixty cards, and changing something the reader
 * cannot see is not an answer to a tap. On a wide screen the click is taken
 * over and only the query string changes, without scrolling, so the board
 * stays where it was and the panel beside it changes.
 */
export function PanelLink({
  href,
  panelHref,
  isCurrent = false,
  className,
  children,
}: {
  /** The task's own page. */
  href: string;
  /** The board with this task in its panel. */
  panelHref: string;
  isCurrent?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  function openInPanel(event: React.MouseEvent<HTMLAnchorElement>) {
    const wantsNewTab = event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
    if (wantsNewTab || !window.matchMedia(PANEL_BESIDE_BOARD).matches) return;
    event.preventDefault();
    router.push(panelHref, { scroll: false });
  }

  return (
    <Link
      href={href}
      className={className}
      aria-current={isCurrent ? "true" : undefined}
      onClick={openInPanel}
    >
      {children}
    </Link>
  );
}
