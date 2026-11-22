import { duration, type T } from "@/lib/i18n";
import type { ActivityReport } from "@/lib/services/reports";

import { DayBars, Panel } from "../components";
import { KIND_COLOR, kindLabel } from "../kinds";

/**
 * The window day by day: what got finished, how long was spent in `doing`,
 * and what was written to the log, by kind. Three small charts rather than
 * one with two axes, because tasks, hours and entries are different units and
 * a shared axis would make one of them a liar.
 */
export function Daily({ report, t }: { report: ActivityReport; t: T }) {
  const days = report.by_day.map((d) => d.day);
  const column = (pick: (d: ActivityReport["by_day"][number]) => number) => report.by_day.map(pick);
  return (
    <Panel delay={60} title={t("reportDaily")}>
      <div className="grid gap-6 p-1 lg:grid-cols-3">
        <section className="min-w-0 space-y-2">
          <h3 className="text-[14px] font-semibold text-ink">{t("chartDone")}</h3>
          <DayBars
            caption={t("chartDone")}
            days={days}
            series={[
              { key: "completed", label: t("totalsCompleted"), color: "var(--ok)", values: column((d) => d.completed) },
            ]}
          />
        </section>
        <section className="min-w-0 space-y-2">
          <h3 className="text-[14px] font-semibold text-ink">{t("chartActive")}</h3>
          <DayBars
            caption={t("chartActive")}
            days={days}
            format={(n) => duration(n, t)}
            series={[
              { key: "active", label: t("totalsActive"), color: "var(--accent)", values: column((d) => d.active_ms) },
            ]}
          />
        </section>
        <section className="min-w-0 space-y-2">
          <h3 className="text-[14px] font-semibold text-ink">{t("chartWritten")}</h3>
          <DayBars
            caption={t("chartWritten")}
            days={days}
            series={[
              { key: "decision", label: kindLabel(t, "decision"), color: KIND_COLOR.decision, values: column((d) => d.decisions) },
              { key: "dead_end", label: kindLabel(t, "dead_end"), color: KIND_COLOR.dead_end, values: column((d) => d.dead_ends) },
              { key: "question", label: kindLabel(t, "question"), color: KIND_COLOR.question, values: column((d) => d.questions) },
              { key: "handoff", label: kindLabel(t, "handoff"), color: KIND_COLOR.handoff, values: column((d) => d.handoffs) },
              { key: "note", label: kindLabel(t, "note"), color: KIND_COLOR.note, values: column((d) => d.notes) },
            ]}
          />
        </section>
      </div>
    </Panel>
  );
}
