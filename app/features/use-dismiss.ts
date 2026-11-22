"use client";

import { useEffect } from "react";

/**
 * Closes an open menu on Escape, which also returns focus to its trigger, or
 * on a press outside it. On a phone the root's own box is the dim behind the
 * sheet, so a press on the root itself counts as outside.
 */
export function useDismiss(input: {
  isOpen: boolean;
  rootRef: React.RefObject<HTMLElement | null>;
  triggerRef: React.RefObject<HTMLElement | null>;
  close: () => void;
}): void {
  const { isOpen, rootRef, triggerRef, close } = input;
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (event.target === root || !root?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, rootRef, triggerRef, close]);
}
