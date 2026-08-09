import type { Status } from "@/lib/constants";
import type { T } from "@/lib/i18n";
import type { RefStatus } from "@/lib/types";
import { statusLabel } from "../kinds";
import { Chip } from "./chip";

const STATUS_COLOR: Record<Status, string> = {
  todo: "var(--card)",
  doing: "var(--accent)",
  blocked: "var(--k-dead_end)",
  done: "var(--ok)",
  dropped: "var(--k-note)",
};

/** Colour alone never carries the status -- there is always a text equivalent. */
export function StatusDot({ status, t }: { status: Status; t: T }) {
  return (
    <>
      <span
        className="inline-block size-3.5 shrink-0 rounded-full border-[1.5px] border-line"
        style={{ background: STATUS_COLOR[status], borderColor: "var(--edge-dark)" }}
        aria-hidden="true"
      />
      <span className="sr-only">{statusLabel(t, status)}</span>
    </>
  );
}

export function RefBadge({ status, t }: { status: RefStatus; t: T }) {
  const map: Record<RefStatus, [string, string]> = {
    fresh: [t("ref_fresh"), "var(--ok)"],
    changed: [t("ref_changed"), "var(--k-question)"],
    missing: [t("ref_missing"), "var(--k-dead_end)"],
    unknown: [t("ref_unknown"), "var(--k-note)"],
  };
  const [label, color] = map[status];
  return (
    <Chip color={color} tilt={status === "fresh" ? 0 : -3}>
      {label}
    </Chip>
  );
}
