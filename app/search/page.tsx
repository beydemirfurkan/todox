import type { Metadata } from "next";
import Link from "next/link";

import { ago, type Key } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import { search } from "@/lib/services/search";
import { Chip, Counter, Empty, Panel } from "../components";
import { privatePageMetadata } from "../metadata-shared";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleSearch"));
}


export const dynamic = "force-dynamic";

const TYPE_COLOR: Record<string, string> = {
  task: "var(--accent)",
  entry: "var(--k-handoff)",
  context: "var(--k-decision)",
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const user = await requireUser();
  const { t } = await getT();
  const { q: raw } = await searchParams;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const hits = query ? await search(user.id, query) : [];

  return (
    <div className="space-y-6">
      <div className="pop prose">
        <h1 className="display text-[33px] leading-[1.1] font-bold">
          {query ? <>&ldquo;{query}&rdquo;</> : t("searchTitle")}
        </h1>
        {/* Only before there is anything to read.
            It explains what this page searches and how to phrase a query,
            which is worth saying to somebody looking at an empty page and is
            noise above their results -- the same rule the home page's pitch
            follows since it started fading at the first project: a sentence
            that is true in every state tells you nothing about the one you
            are in, and it crowds the thing that does. */}
        {!query && (
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t("searchIntro")}</p>
        )}
      </div>

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
