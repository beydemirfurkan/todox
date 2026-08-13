"use client";

import { useState } from "react";

import { rotateShareAction, setSharingAction } from "../actions";
import { SubmitButton } from "./submit";

export type ShareStrings = {
  off: string;
  on: string;
  enable: string;
  disable: string;
  rotate: string;
  includeLog: string;
  copy: string;
  copied: string;
  scopeNote: string;
  reachNote: string;
  apply: string;
  blocked: string;
  /** What every button here says while its action is in flight. */
  working: string;
};

export function SharePanel({
  projectId,
  token,
  includeLog,
  origin,
  canShare,
  s,
}: {
  projectId: number;
  token: string | null;
  includeLog: boolean;
  /** Unverified accounts may stop sharing but not start it. */
  canShare: boolean;
  /** Resolved server-side from the request host, so the rendered link is
   *  absolute on first paint and there is nothing to hydrate. */
  origin: string;
  s: ShareStrings;
}) {
  const [copied, setCopied] = useState(false);

  const path = token ? `/s/${token}` : "";
  const url = `${origin}${path}`;

  if (!token) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-muted">{s.off}</p>
        {!canShare && (
          <p
            className="sticker-flat px-3 py-2 text-[13.5px]"
            style={{ borderColor: "var(--k-question)" }}
          >
            {s.blocked}
          </p>
        )}
        <form action={setSharingAction} className="space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="enabled" value="1" />
          <label className="flex items-start gap-2 text-[13.5px] text-muted">
            <input
              type="checkbox"
              name="include_log"
              className="mt-0.5"
            />
            <span>{s.includeLog}</span>
          </label>
          <SubmitButton disabled={!canShare} pendingLabel={s.working}>
            {s.enable}
          </SubmitButton>
        </form>
        <p className="text-[13px] text-muted">{s.scopeNote}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-muted">{s.on}</p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={path}
          className="mono sticker-flat min-w-0 flex-1 truncate px-2.5 py-2 text-[12.5px] underline decoration-dotted underline-offset-2"
        >
          {url}
        </a>
        <button
          type="button"
          className="btn btn-quiet text-small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              /* clipboard blocked -- the link is visible and selectable anyway */
            }
          }}
        >
          {copied ? s.copied : s.copy}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? s.copied : ""}
      </p>

      <form action={setSharingAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="enabled" value="1" />
        {/* `min-w-0` beside `flex-1`: the basis is zero, so without it this
            label squeezes to one word per line instead of letting the row
            wrap. */}
        <label className="flex min-w-0 flex-1 items-start gap-2 text-[13.5px] text-muted">
          <input
            type="checkbox"
            name="include_log"
            defaultChecked={includeLog}
            className="mt-0.5"
          />
          <span>{s.includeLog}</span>
        </label>
        <SubmitButton className="btn btn-quiet text-small" pendingLabel={s.working}>
          {s.apply}
        </SubmitButton>
      </form>

      <div className="flex flex-wrap gap-2">
        <form action={rotateShareAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <SubmitButton className="link-more" pendingLabel={s.working}>
            {s.rotate}
          </SubmitButton>
        </form>
        <form action={setSharingAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="enabled" value="0" />
          <SubmitButton className="link-more" pendingLabel={s.working}>
            {s.disable}
          </SubmitButton>
        </form>
      </div>

      <p className="text-[13px] text-muted">
        {s.scopeNote} {s.reachNote}
      </p>
    </div>
  );
}
