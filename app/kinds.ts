import { CONTEXT_KINDS, STATUSES } from "@/lib/constants";
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
 * `undefined` means "no fill", which is how a chip gets light text on the dark
 * card. Passing a dark colour here instead would paint dark-on-dark: `Chip`
 * chooses its text colour from whether a fill was given, not from how light
 * the fill is, because a `var(--…)` string cannot be measured at render time.
 */
export const IMPORTANCE_COLOR: Record<"high" | "normal" | "low", string | undefined> = {
  high: "var(--accent)",
  normal: undefined,
  low: "var(--k-note)",
};

/* Labels live in the dictionary, so every kind reads naturally in both
   languages. These helpers keep the key-building in one place. */
export const kindLabel = (t: T, k: EntryKind) => t(`k_${k}` as Key);
export const kindHint = (t: T, k: EntryKind) => t(`kh_${k}` as Key);
export const kindPlaceholder = (t: T, k: EntryKind) => t(`kp_${k}` as Key);
export const contextKindLabel = (t: T, k: ContextKind) => t(`c_${k}` as Key);
export const statusLabel = (t: T, s: Status) => t(`st_${s}` as Key);

/* Option lists for `Picker`. Built here so a status carries the same dot it
   has everywhere else, and so no page has to know how the labels are keyed. */

const STATUS_COLOUR: Record<Status, string> = {
  todo: "var(--card)",
  doing: "var(--accent)",
  blocked: "var(--k-dead_end)",
  done: "var(--ok)",
  dropped: "var(--k-note)",
};

export const statusOptions = (t: T) =>
  STATUSES.map((s) => ({ value: s, label: statusLabel(t, s), colour: STATUS_COLOUR[s] }));

export const priorityOptions = (t: T) => [
  { value: "1", label: t("p1"), colour: "var(--accent)" },
  { value: "2", label: t("p2") },
  { value: "3", label: t("p3"), colour: "var(--k-note)" },
];

export const kindOptions = (t: T) =>
  CONTEXT_KINDS.map((k) => ({ value: k, label: contextKindLabel(t, k) }));
