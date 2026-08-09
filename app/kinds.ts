import type { ContextKind, EntryKind, Status } from "@/lib/constants";
import type { Key, T } from "@/lib/i18n";

export const KIND_COLOR: Record<EntryKind, string> = {
  note: "var(--k-note)",
  decision: "var(--k-decision)",
  dead_end: "var(--k-dead_end)",
  question: "var(--k-question)",
  handoff: "var(--k-handoff)",
};

/* Labels live in the dictionary, so every kind reads naturally in both
   languages. These helpers keep the key-building in one place. */
export const kindLabel = (t: T, k: EntryKind) => t(`k_${k}` as Key);
export const kindHint = (t: T, k: EntryKind) => t(`kh_${k}` as Key);
export const kindPlaceholder = (t: T, k: EntryKind) => t(`kp_${k}` as Key);
export const contextKindLabel = (t: T, k: ContextKind) => t(`c_${k}` as Key);
export const statusLabel = (t: T, s: Status) => t(`st_${s}` as Key);
