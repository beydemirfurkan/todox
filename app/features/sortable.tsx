"use client";

import { useRef, useState, useTransition } from "react";

export interface SortableItem {
  id: number;
  name: string;
  node: React.ReactNode;
}

interface Drag {
  id: number;
  pointerId: number;
}

/**
 * A list a person can put in their own order: by mouse, by finger, by keyboard.
 *
 * Each row gets a grip. Pressing the grip and moving -- mouse or touch alike,
 * through pointer events -- lifts the row, and a line shows where it will land.
 * The grip is `touch-action: none`, so on a phone dragging it moves the row
 * instead of scrolling the page, while the rest of the row still scrolls and
 * its link still opens. Focused, the grip moves its row one place with the
 * arrow keys.
 *
 * The rows stay server-rendered; this holds only their order. A new order
 * shows at once and goes to the server whole. If the server refuses, the old
 * order comes back. Without script the grips do nothing and the account's
 * projects tab has the same moves as plain forms.
 *
 * HTML5 drag and drop did the sidebar's folders first. It has no touch support
 * at all, which is why this exists.
 */
export function Sortable({
  items,
  onReorder,
  labels,
  container,
  className,
}: {
  items: SortableItem[];
  onReorder: (orderedIds: number[]) => Promise<void>;
  labels: { handle: string; moved: string };
  /** `ul` when the rows are list items, `div` for anything else. */
  container: "ul" | "div";
  className?: string;
}) {
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const containerRef = useRef<HTMLElement | null>(null);

  // A server render that changed the set (an item added, removed, moved away)
  // wins over the local order; the same set in a new order is ours.
  const byId = new Map(items.map((item) => [item.id, item]));
  const isSameSet = order.length === items.length && order.every((id) => byId.has(id));
  const shown = isSameSet ? order : items.map((item) => item.id);

  function commit(next: number[], movedId: number) {
    if (next.every((id, index) => id === shown[index])) return;
    const previous = shown;
    setOrder(next);
    setAnnouncement(
      labels.moved.replace("{name}", byId.get(movedId)?.name ?? "").replace("{n}", String(next.indexOf(movedId) + 1)),
    );
    startTransition(async () => {
      try {
        await onReorder(next);
      } catch (error) {
        console.error("saving the new order failed", error);
        setOrder(previous);
      }
    });
  }

  /** Where the dragged row would go: before the first row whose middle is below the pointer. */
  function insertionIndex(clientY: number, movingId: number): number {
    const others = shown.filter((id) => id !== movingId);
    const index = others.findIndex((id) => {
      const box = rowRefs.current.get(id)?.getBoundingClientRect();
      return box ? clientY < box.top + box.height / 2 : false;
    });
    return index === -1 ? others.length : index;
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>, id: number) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, pointerId: event.pointerId });
    setDropAt(shown.indexOf(id));
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    scrollNearEdge(event.clientY, containerRef.current);
    const at = insertionIndex(event.clientY, drag.id);
    if (at !== dropAt) setDropAt(at);
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const others = shown.filter((id) => id !== drag.id);
    const at = insertionIndex(event.clientY, drag.id);
    endDrag();
    commit([...others.slice(0, at), drag.id, ...others.slice(at)], drag.id);
  }

  function endDrag() {
    setDrag(null);
    setDropAt(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, id: number) {
    if (event.key === "Escape" && drag) {
      endDrag();
      return;
    }
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const from = shown.indexOf(id);
    const to = from + step;
    if (to < 0 || to >= shown.length) return;
    const next = [...shown];
    [next[from], next[to]] = [next[to], next[from]];
    commit(next, id);
  }

  /** Where the line is drawn: above the row now at that place, or below the last. */
  const others = drag ? shown.filter((id) => id !== drag.id) : shown;
  const lineBefore = drag && dropAt !== null && dropAt < others.length ? others[dropAt] : null;
  const lineAfterLast = drag && dropAt !== null && dropAt >= others.length ? others[others.length - 1] : null;

  const Row = container === "ul" ? "li" : "div";
  const Container = container;
  return (
    <>
      <Container
        className={className ? `sortable ${className}` : "sortable"}
        ref={(element: HTMLElement | null) => {
          containerRef.current = element;
        }}
      >
        {shown.map((id) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <Row
              key={id}
              ref={(element: HTMLElement | null) => {
                if (element) rowRefs.current.set(id, element);
                else rowRefs.current.delete(id);
              }}
              className="sortable-item"
              data-lifted={drag?.id === id ? "" : undefined}
              data-drop={lineBefore === id ? "before" : lineAfterLast === id ? "after" : undefined}
            >
              <button
                type="button"
                className="sort-handle"
                aria-label={labels.handle.replace("{name}", item.name)}
                title={labels.handle.replace("{name}", item.name)}
                onPointerDown={(event) => onPointerDown(event, id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={endDrag}
                onKeyDown={(event) => onKeyDown(event, id)}
              >
                <svg aria-hidden="true" width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                  <circle cx="2.5" cy="3" r="1.4" />
                  <circle cx="7.5" cy="3" r="1.4" />
                  <circle cx="2.5" cy="8" r="1.4" />
                  <circle cx="7.5" cy="8" r="1.4" />
                  <circle cx="2.5" cy="13" r="1.4" />
                  <circle cx="7.5" cy="13" r="1.4" />
                </svg>
              </button>
              <div className="sortable-body">{item.node}</div>
            </Row>
          );
        })}
      </Container>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/**
 * Dragging near the top or bottom edge scrolls, so a long list can be crossed:
 * the nearest box that scrolls (the sidebar's project list is one), or the
 * page when there is none.
 */
function scrollNearEdge(clientY: number, from: HTMLElement | null) {
  const edge = 56;
  const box = scrollingAncestor(from);
  const top = box ? box.getBoundingClientRect().top : 0;
  const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight;
  const by = clientY < top + edge ? -12 : clientY > bottom - edge ? 12 : 0;
  if (!by) return;
  if (box) box.scrollBy(0, by);
  else window.scrollBy(0, by);
}

function scrollingAncestor(from: HTMLElement | null): HTMLElement | null {
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}
