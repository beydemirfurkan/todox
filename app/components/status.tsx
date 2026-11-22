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
      {/* A ring for work not started, a solid dot for everything else. */}
      <span
        className="inline-block size-3 shrink-0 rounded-full"
        style={
          status === "todo"
            ? { boxShadow: "inset 0 0 0 2px var(--faint)" }
            : { background: STATUS_COLOR[status] }
        }
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
