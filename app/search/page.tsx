import type { Metadata } from "next";
import Link from "next/link";

import { CONTEXT_KINDS, ENTRY_KINDS } from "@/lib/constants";
import { ago, type Key } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import * as projectsRepo from "@/lib/repositories/projects";
import { search } from "@/lib/services/search";
import { Chip, Counter, Empty, Field, Panel } from "../components";
import { Picker } from "../features/picker";
import { SubmitButton } from "../features/submit";
import { contextKindLabel, kindLabel } from "../kinds";
import { privatePageMetadata } from "../metadata-shared";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleSearch"));
}


export const dynamic = "force-dynamic";

/**
 * What the `kind` filter offers, in the order the tool description names them.
 *
 * Entry kinds and note kinds in one list, because that is what `search` takes
 * and what a person is actually choosing between -- "has this been tried?" is
 * a dead end whether somebody wrote it on a task or as a standing rule.
 * Tasks have no kind, so picking any of these excludes them, which the service
 * documents and the empty state explains well enough on its own.
 */
const KINDS: string[] = [...new Set([...ENTRY_KINDS, ...CONTEXT_KINDS])];

/** The label for a kind that may come from either list. */
const kindOrContextLabel = (t: (k: Key) => string, kind: string) =>
  (ENTRY_KINDS as readonly string[]).includes(kind)
    ? kindLabel(t, kind as never)
    : contextKindLabel(t, kind as never);

const TYPE_COLOR: Record<string, string> = {
  task: "var(--accent)",
  entry: "var(--k-handoff)",
  context: "var(--k-decision)",
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const user = await requireUser();
  const { t } = await getT();
  const { q: raw, kind: rawKind, project: rawProject } = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const query = one(raw);

  /**
   * The two filters the agent surface has always had and the browser did not.
   *
   * `search`'s own description teaches an agent to reach for these by name --
   * kinds:['dead_end'] for "has this been tried?", project to stop it looking
   * elsewhere -- and a person searching the same log had neither. The service
   * already takes both; nothing here passed them.
   */
  const kind = KINDS.includes(one(rawKind)) ? one(rawKind) : "";
  const slug = one(rawProject);
  const projects = await projectsRepo.list(user.id);
  const scoped = slug ? projects.find((p) => p.slug === slug) : undefined;

  const hits = query
    ? await search(user.id, query, 30, {
        kinds: kind ? [kind] : null,
        // A slug nobody has is not a silent "everything": it is a filter that
        // found nothing, which is what the empty state is for.
        projectId: slug ? (scoped?.id ?? -1) : null,
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="pop prose">
        <h1 className="display text-[33px] leading-[1.1] font-bold">
          {query ? <>&ldquo;{query}&rdquo;</> : t("searchTitle")}
        </h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t("searchIntro")}</p>
      </div>

      {/* A GET form, so a filtered search is a URL somebody can keep. The
          query rides along in a hidden field rather than being retyped. */}
      <form action="/search" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="q" value={query} />
        <Field label={t("searchKind")} className="w-44">
          <Picker
            name="kind"
            value={kind}
            label={t("searchKind")}
            options={[
              { value: "", label: t("searchAnyKind") },
              ...KINDS.map((k) => ({ value: k, label: kindOrContextLabel(t, k) })),
            ]}
          />
        </Field>
        <Field label={t("searchProject")} className="w-56">
          <Picker
            name="project"
            value={slug}
            label={t("searchProject")}
            options={[
              { value: "", label: t("searchAllProjects") },
              ...projects.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />
        </Field>
        <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
          {t("apply")}
        </SubmitButton>
      </form>

      <Panel delay={60} right={<Counter n={hits.length} label={t("resultsCount")} />}>
        <div className="space-y-2.5" aria-live="polite">
          {query && hits.length === 0 && (
            <Empty mood="worried">{t("searchNoResults")}</Empty>
          )}
          {!query && <Empty>{t("searchPrompt")}</Empty>}
          {hits.map((h) => {
            const href =
              h.type === "task"
                ? `/p/${h.project_slug}/t/${h.id}`
                : h.type === "entry"
                  ? `/p/${h.project_slug}/t/${h.task_id}`
                  : h.project_slug
                    ? `/p/${h.project_slug}`
                    : "/";
            return (
              <Link
                key={`${h.type}-${h.id}`}
                href={href}
                className="sticker-flat lift block p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color={TYPE_COLOR[h.type]} tilt={-2}>
                    {/* Was `h.type`, i.e. the raw discriminant, in both languages. */}
                    {t(`hit_${h.type}` as Key)}
                  </Chip>
                  <span className="mono text-[12px] text-faint">
                    {h.project_slug ?? t("globalScope")}
                  </span>
                  <span className="text-[15px] font-medium">{h.title}</span>
                  <span className="mono ml-auto shrink-0 text-[11px] text-faint">
                    {ago(h.created_at, t)}
                  </span>
                </div>
                {h.snippet && (
                  <p className="mt-1 line-clamp-2 text-[14px] text-muted">{h.snippet}</p>
                )}
              </Link>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
