import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OPEN_STATUSES } from "@/lib/constants";
import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import * as entriesRepo from "@/lib/repositories/entries";
import * as tasksRepo from "@/lib/repositories/tasks";
import { bySharedToken } from "@/lib/services/sharing";
import { KIND_COLOR, kindLabel, statusLabel } from "../../kinds";
import { Blob, Chip, Counter, Empty, Panel, StatusDot } from "../../components";

export const dynamic = "force-dynamic";

/** Shared links are unlisted, not secret. Keep them out of search engines. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SharedProjectPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const { t } = await getT();
  const project = await bySharedToken(token);
  if (!project) notFound();

  const all = await tasksRepo.listByProject(project.id, "all");
  const open = all.filter((x) => OPEN_STATUSES.includes(x.status));
  const closed = all.filter((x) => !OPEN_STATUSES.includes(x.status));
  const withLog = project.share_log === 1;

  // Only the log is optional here; file paths and project context are never
  // included in a share, whatever the owner picked.
  const logs = withLog
    ? await entriesRepo.listByTasks(open.map((x) => x.id))
    : new Map<number, never[]>();

  return (
    <div className="space-y-6">
      <div className="pop prose">
        <Chip color="var(--k-handoff)" tilt={-2}>
          {t("sharedReadOnly")}
        </Chip>
        <h1 className="display mt-2 text-[33px] leading-[1.1] font-bold">
          {project.name}
        </h1>
        <p className="mt-1.5 text-[14.5px] text-muted">
          {project.summary ?? t("sharedIntro")}
        </p>
        {!withLog && <p className="mt-1 text-[13.5px] text-muted">{t("sharedNoLog")}</p>}
      </div>

      <Panel
        delay={60}
        title={t("queued")}
        right={<Counter n={open.length} label={t("queued")} />}
      >
        <ul className="space-y-2">
          {open.length === 0 && <Empty mood="happy">{t("allClear")}</Empty>}
          {open.map((task) => {
            const entries = logs.get(task.id) ?? [];
            return (
              <li key={task.id} className="sticker-flat p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <StatusDot status={task.status} t={t} />
                  <span className="mono text-[12px] text-faint">#{task.id}</span>
                  <span className="text-[15px] font-medium">{task.title}</span>
                  <Chip>{statusLabel(t, task.status)}</Chip>
                  {task.priority === 1 && (
                    <Chip color="var(--accent)" tilt={-3}>
                      p1
                    </Chip>
                  )}
                  <span className="mono ml-auto text-[11px] text-faint">
                    {ago(task.updated_at, t)}
                  </span>
                </div>
                {task.body && (
                  <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
                    {task.body}
                  </p>
                )}
                {entries.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-dashed border-rule pt-2.5">
                    {entries.map((e) => (
                      <li key={e.id} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 size-3 shrink-0 rounded-full border-[1.5px] border-line"
                          style={{ background: KIND_COLOR[e.kind], borderColor: "var(--edge-dark)" }}
                        />
                        <span className="min-w-0">
                          <span className="display text-[13px] font-bold">
                            {kindLabel(t, e.kind)}
                          </span>
                          <span className="mono ml-2 text-[11px] text-faint">
                            {ago(e.created_at, t)}
                          </span>
                          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
                            {e.body}
                          </p>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      {closed.length > 0 && (
        <Panel
          delay={120}
          title={t("doneDropped")}
          right={<Counter n={closed.length} label={t("doneDropped")} />}
        >
          <ul className="space-y-1">
            {closed.slice(0, 40).map((task) => (
              <li
                key={task.id}
                className="flex items-center gap-2.5 px-1.5 py-1 text-[14px] text-muted"
              >
                <StatusDot status={task.status} t={t} />
                <span className="mono text-[12px]">#{task.id}</span>
                <span className="truncate line-through decoration-1">{task.title}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Blob mood="sleep" size={36} fill="var(--inset)" stroke="var(--ink)" />
        <p className="text-[13px] text-muted">todox — {t("tagline")}</p>
      </div>
    </div>
  );
}
