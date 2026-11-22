"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Drag a card to another column and its status changes.
 *
 * The board itself stays server-rendered: this only listens. A card carries
 * `data-drag-id` and a column `data-drop-status`, and the events bubble up
 * to here, so the cards keep their server-side translations and no task
 * crosses into the client as data. The drop calls the same server action as
 * the card's menu, which revalidates the page; until it answers, the card is
 * marked as moving and the column it is going to stays lit.
 *
 * Dragging is a mouse affordance. Touch and keyboard users have the menu on
 * every card, which is a plain form and works without this file at all.
 */
export function BoardDnd({
  children,
  moveAction,
  labels,
}: {
  children: React.ReactNode;
  moveAction: (fd: FormData) => Promise<void>;
  labels: { moving: string; statusNames: Record<string, string> };
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  useStatusMenus(rootRef);

  function onDragStart(event: React.DragEvent) {
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-drag-id]");
    if (!card?.dataset.dragId) return;
    event.dataTransfer.setData("text/plain", card.dataset.dragId);
    event.dataTransfer.effectAllowed = "move";
    card.setAttribute("data-lifted", "");
    setDraggingId(card.dataset.dragId);
  }

  function onDragOver(event: React.DragEvent) {
    const zone = dropZoneOf(event);
    if (!zone || !draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (overStatus !== zone.status) setOverStatus(zone.status);
  }

  function onDrop(event: React.DragEvent) {
    const zone = dropZoneOf(event);
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    endDrag();
    if (!zone || !id || zone.status === zone.from(id)) return;
    event.preventDefault();
    move(id, zone.status);
  }

  function move(id: string, status: string) {
    const fd = new FormData();
    fd.set("task_id", id);
    fd.set("status", status);
    setMovingId(id);
    cardOf(id)?.setAttribute("data-pending", "");
    setAnnouncement(
      labels.moving.replace("{id}", id).replace("{status}", labels.statusNames[status] ?? status),
    );
    startTransition(async () => {
      try {
        await moveAction(fd);
      } catch (error) {
        console.error("moving a card failed", error);
      } finally {
        cardOf(id)?.removeAttribute("data-pending");
        setMovingId(null);
      }
    });
  }

  function endDrag() {
    if (draggingId) cardOf(draggingId)?.removeAttribute("data-lifted");
    setDraggingId(null);
    setOverStatus(null);
  }

  return (
    <div
      ref={rootRef}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={endDrag}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverStatus(null);
      }}
      data-dragging={draggingId ?? undefined}
      data-over={overStatus ?? undefined}
      data-moving={movingId ?? undefined}
      className="board-dnd min-w-0"
    >
      {children}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/**
 * The card menus are `<details>`, which open without a script but sit inside
 * a column that scrolls, so an open one was cut off at the column's edge.
 * With a script, an open menu is lifted out of that box: placed against the
 * viewport under its button (or above it, near the bottom), one open at a
 * time, and closed by Escape, a click elsewhere or a scroll.
 */
function useStatusMenus(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const openMenus = () => [...root.querySelectorAll<HTMLDetailsElement>("details.status-menu[open]")];
    const closeAll = (except?: Element) =>
      openMenus().forEach((menu) => {
        if (menu !== except) menu.open = false;
      });

    const onToggle = (event: Event) => {
      const menu = event.target as HTMLDetailsElement;
      if (!menu.matches?.("details.status-menu") || !menu.open) return;
      closeAll(menu);
      placeMenu(menu);
    };
    const onPointerDown = (event: PointerEvent) => {
      const inside = (event.target as Element).closest?.("details.status-menu[open]");
      closeAll(inside ?? undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = openMenus()[0];
      if (!open) return;
      open.open = false;
      open.querySelector("summary")?.focus();
    };
    const onScroll = () => closeAll();

    root.addEventListener("toggle", onToggle, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      root.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [rootRef]);
}

function placeMenu(menu: HTMLDetailsElement) {
  const button = menu.querySelector("summary");
  const panel = menu.querySelector<HTMLElement>(".status-menu-panel");
  if (!button || !panel) return;
  const at = button.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const below = at.bottom + 4 + height <= window.innerHeight - 8;
  panel.style.position = "fixed";
  panel.style.top = `${below ? at.bottom + 4 : Math.max(8, at.top - 4 - height)}px`;
  panel.style.left = `${Math.min(Math.max(8, at.right - width), window.innerWidth - width - 8)}px`;
  panel.style.right = "auto";
  panel.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
}

function cardOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-drag-id="${CSS.escape(id)}"]`);
}

/** The column under the pointer, and a way to ask which column a card is in. */
function dropZoneOf(event: React.DragEvent) {
  const zone = (event.target as HTMLElement).closest<HTMLElement>("[data-drop-status]");
  const status = zone?.dataset.dropStatus;
  if (!zone || !status) return null;
  return {
    status,
    from: (id: string) =>
      cardOf(id)?.closest<HTMLElement>("[data-drop-status]")?.dataset.dropStatus,
  };
}
