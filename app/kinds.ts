import { PROJECT_CONTEXT_KINDS } from "@/lib/constants";
import type { ContextKind, EntryKind, Status } from "@/lib/constants";
import type { Key, T } from "@/lib/i18n";

export const KIND_COLOR: Record<EntryKind, string> = {
  note: "var(--k-note)",
  decision: "var(--k-decision)",
  dead_end: "var(--k-dead_end)",
  question: "var(--k-question)",
  handoff: "var(--k-handoff)",
};

/**
 * A note's kind, as a fill.
 *
 * Every context note used to wear the decision blue whatever it was, so the
 * one thing a reader wants from a list of standing notes -- is this a trap
 * or a rule -- had to be read off the chip's text. The four fills are the
 * ones the log's kinds already mean: a gotcha is the colour of a dead end,
 * a decision is a decision, a convention is the colour of a handoff (what
 * one session tells the next), a preference is the quiet grey of a note.
 * All four are bright, so `Chip`'s dark-on-fill text rule holds.
 */
export const CONTEXT_KIND_COLOR: Record<ContextKind, string> = {
  gotcha: "var(--k-dead_end)",
  decision: "var(--k-decision)",
  convention: "var(--k-handoff)",
  preference: "var(--k-note)",
  // The developer's own notes: who (the accent), what with (the green of
  // done), how (the amber a question wears -- the ones an agent asks about).
  profile: "var(--accent)",
  stack: "var(--ok)",
  workflow: "var(--k-question)",
};

/* Labels live in the dictionary, so every kind reads naturally in both
   languages. These helpers keep the key-building in one place. */
export const kindLabel = (t: T, k: EntryKind) => t(`k_${k}` as Key);
export const kindHint = (t: T, k: EntryKind) => t(`kh_${k}` as Key);
export const kindPlaceholder = (t: T, k: EntryKind) => t(`kp_${k}` as Key);
export const contextKindLabel = (t: T, k: ContextKind) => t(`c_${k}` as Key);
export const statusLabel = (t: T, s: Status) => t(`st_${s}` as Key);

/* Option lists for `Picker`, so no page has to know how the labels are keyed. */

export const priorityOptions = (t: T) => [
  { value: "1", label: t("p1"), colour: "var(--accent)" },
  { value: "2", label: t("p2") },
  { value: "3", label: t("p3"), colour: "var(--k-note)" },
];

/** The picker's choices; a project note cannot be one of the developer's kinds. */
export const kindOptions = (t: T, kinds: readonly ContextKind[] = PROJECT_CONTEXT_KINDS) =>
  kinds.map((k) => ({
    value: k,
    label: contextKindLabel(t, k),
    colour: CONTEXT_KIND_COLOR[k],
  }));
