"use client";

import { useState, useTransition } from "react";

export interface FolderOrderItem {
  id: number;
  name: string;
  node: React.ReactNode;
}

type Place = "before" | "after";

/**
 * Drag a folder in the sidebar to put it somewhere else.
 *
 * The folders stay server-rendered -- each arrives as a finished node -- and
 * this only holds their order, so it can show the new order at once and send
 * the whole of it to the server. If the server refuses (a folder made in
 * another tab, say), the order snaps back and the next render brings the real
 * one.
 *
 * Dragging is a mouse affordance. Keyboard, touch and no-script users reorder
 * with the up and down buttons on the account's projects tab, which are plain
 * forms.
 */
export function FolderOrder({
  items,
  reorderAction,
  labels,
}: {
  items: FolderOrderItem[];
  reorderAction: (orderedIds: number[]) => Promise<void>;
  labels: { moved: string; hint: string };
}) {
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const [dragging, setDragging] = useState<number | null>(null);
  const [target, setTarget] = useState<{ id: number; place: Place } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();

  // A new render from the server (a folder added or deleted) replaces the
  // local order, unless it is the same set in another order mid-drag.
  const byId = new Map(items.map((item) => [item.id, item]));
  const isSameSet = order.length === items.length && order.every((id) => byId.has(id));
  const shown = isSameSet ? order : items.map((item) => item.id);

  function placeOf(event: React.DragEvent<HTMLElement>): Place {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? "before" : "after";
  }

  function drop(onto: number, place: Place) {
    const moving = dragging;
    reset();
    if (moving === null || moving === onto) return;
    const without = shown.filter((id) => id !== moving);
    const at = without.indexOf(onto) + (place === "after" ? 1 : 0);
    const next = [...without.slice(0, at), moving, ...without.slice(at)];
    if (next.every((id, index) => id === shown[index])) return;
    const previous = shown;
    setOrder(next);
    setAnnouncement(
      labels.moved.replace("{name}", byId.get(moving)?.name ?? "").replace("{n}", String(next.indexOf(moving) + 1)),
    );
    startTransition(async () => {
      try {
        await reorderAction(next);
      } catch (error) {
        console.error("reordering folders failed", error);
        setOrder(previous);
      }
    });
  }

  function reset() {
    setDragging(null);
    setTarget(null);
  }

  return (
    <>
      {shown.map((id) => (
        <div
          key={id}
          draggable
          title={labels.hint}
          className="folder-drag"
          data-lifted={dragging === id ? "" : undefined}
          data-folder-drop={target?.id === id && dragging !== id ? target.place : undefined}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(id));
            setDragging(id);
          }}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const place = placeOf(event);
            if (target?.id !== id || target.place !== place) setTarget({ id, place });
          }}
          onDrop={(event) => {
            event.preventDefault();
            drop(id, placeOf(event));
          }}
          onDragEnd={reset}
        >
          {byId.get(id)?.node}
        </div>
      ))}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
