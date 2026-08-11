"use client";

import { useEffect, useRef, useState } from "react";

import { Blob, type Mood } from "../components";

type State = "resting" | "typing" | "shy" | "worried";

/**
 * Todd, holding the card.
 *
 * He was a 64px decoration floating above the form. Here he stands behind it
 * with his hands over the top edge and his feet under the bottom one, which
 * costs nothing and makes the page look like somebody built it.
 *
 * He also reacts, and one reaction is the point: focus the password field and
 * he covers his eyes. That is the product's claim about itself, said by the
 * only part of the page that can say it without a paragraph.
 *
 * He learns all of this by watching, not by being told. The events bubble to
 * this container, so `AuthForm` needs no props, no callbacks and no idea that
 * any of this exists -- and the forms keep working with scripting off, where
 * none of this renders and nothing depends on it.
 *
 * Decorative throughout: `aria-hidden`, `pointer-events: none`, and nothing
 * here is the only place any information appears.
 */
export function AuthMascot({
  mood = "happy",
  fill = "var(--accent)",
  shyLabel,
  children,
}: {
  /** How he stands when nothing is happening. */
  mood?: Mood;
  fill?: string;
  /** The one line he says, while a password field has focus. Omitted on the
   *  pages that have no password to look away from. */
  shyLabel?: string;
  children: React.ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("resting");

  useEffect(() => {
    const root = stage.current;
    if (!root) return;

    const isSecret = (el: EventTarget | null) =>
      el instanceof HTMLInputElement && el.type === "password";
    // Anything the server marked wrong, or a message it sent back.
    const broken = () => Boolean(root.querySelector('[aria-invalid="true"], [role="alert"]'));

    const settle = () => setState(broken() ? "worried" : "resting");

    const onFocusIn = (e: FocusEvent) => {
      if (isSecret(e.target)) setState("shy");
      else if (e.target instanceof HTMLInputElement) setState("typing");
    };
    const onFocusOut = (e: FocusEvent) => {
      // Moving between two fields fires out before in; let the next one win.
      if (!root.contains(e.relatedTarget as Node)) settle();
      else if (!isSecret(e.relatedTarget)) setState(broken() ? "worried" : "typing");
    };

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);

    // Errors arrive from a server action, so they change the DOM without any
    // event this could have listened for.
    const watch = new MutationObserver(() => {
      if (broken()) setState((s) => (s === "shy" ? s : "worried"));
    });
    watch.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-invalid"],
    });

    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      watch.disconnect();
    };
  }, []);

  const wearing: Mood =
    state === "worried" ? "worried" : state === "typing" ? "happy" : mood;

  return (
    <div className="auth-stage" ref={stage} data-state={state}>
      <div className="auth-mascot" aria-hidden="true">
        <Blob mood={wearing} size={116} fill={fill} className="auth-blob" />
        {/* Only while his eyes are covered, and only as flavour: the field it
            refers to is labelled, so nothing is lost by hiding it here. */}
        {shyLabel && <span className="auth-bubble">{shyLabel}</span>}
      </div>

      {/* Behind the card, so they read as feet rather than as decoration
          sitting on top of it. */}
      <Foot side="l" />
      <Foot side="r" />

      <div className="sticker auth-card">{children}</div>

      {/* In front, because a hand that grips has to be over the thing it
          grips. They travel up to his eyes when the password field has focus,
          which is why they live out here and not inside the card. */}
      <Hand side="l" />
      <Hand side="r" />
    </div>
  );
}

function Hand({ side }: { side: "l" | "r" }) {
  return (
    <svg
      className={`auth-hand auth-hand--${side}`}
      width="34"
      height="26"
      viewBox="0 0 34 26"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 24V9a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v15"
        fill="var(--card)"
        stroke="var(--edge-dark)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Two knuckles. Any more and it stops reading as a hand at this size. */}
      <path
        d="M13 8v9M21 8v9"
        stroke="var(--edge-dark)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function Foot({ side }: { side: "l" | "r" }) {
  return (
    <svg
      className={`auth-foot auth-foot--${side}`}
      width="40"
      height="20"
      viewBox="0 0 40 20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 2v8a8 8 0 0 0 8 8h20a8 8 0 0 0 8-8V2"
        fill="var(--card)"
        stroke="var(--edge-dark)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
