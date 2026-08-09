"use client";

import { useId, useState } from "react";

import { ENTRY_KINDS, type EntryKind } from "@/lib/constants";
import { KIND_COLOR } from "../kinds";

export type KindStrings = Record<
  EntryKind,
  { label: string; hint: string; placeholder: string }
>;

/**
 * The entry form teaches the vocabulary: picking a kind rewrites the
 * placeholder and shows what that kind is for. Nobody has to read a legend.
 *
 * Implemented as a real radio group so arrow keys work and the selection is
 * announced, with the visible pills driven off :checked.
 */
export function LogComposer({
  taskId,
  action,
  strings,
  groupLabel,
  bodyLabel,
  submitLabel,
}: {
  taskId: number;
  action: (fd: FormData) => void;
  strings: KindStrings;
  groupLabel: string;
  bodyLabel: string;
  submitLabel: string;
}) {
  const [kind, setKind] = useState<EntryKind>("note");
  const hintId = useId();
  const bodyId = useId();

  return (
    <form
      action={action}
      className="mt-1 space-y-2.5 border-t border-dashed border-rule pt-3.5"
    >
      <input type="hidden" name="task_id" value={taskId} />

      <fieldset className="border-0 p-0">
        <legend className="sr-only">{groupLabel}</legend>
        <div className="flex flex-wrap gap-1.5">
          {ENTRY_KINDS.map((k) => (
            <label key={k} className="cursor-pointer">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="peer sr-only"
              />
              <span
                className="display inline-block rounded-full border-[1.5px] border-line px-2.5 pt-[2px] pb-[3px] text-[12.5px] leading-none font-bold transition peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
                style={
                  kind === k
                    ? {
                        background: KIND_COLOR[k],
                        color: "var(--on-fill)",
                        boxShadow: "3px 3px 0 var(--ink)",
                      }
                    : { background: "var(--inset)", color: "var(--muted)" }
                }
              >
                {strings[k].label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p id={hintId} className="text-[13.5px] leading-snug text-muted">
        <span
          aria-hidden="true"
          className="mr-1.5 inline-block size-2.5 translate-y-px rounded-full border-[1.5px] border-line"
          style={{ background: KIND_COLOR[kind], borderColor: "var(--edge-dark)" }}
        />
        {strings[kind].hint}
      </p>

      <label htmlFor={bodyId} className="sr-only">
        {bodyLabel}
      </label>
      <textarea
        id={bodyId}
        name="body"
        aria-describedby={hintId}
        placeholder={strings[kind].placeholder}
        required
      />
      <button className="btn">{submitLabel}</button>
    </form>
  );
}
