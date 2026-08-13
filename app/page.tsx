import type { Metadata } from "next";
import Link from "next/link";

import { CONTEXT_KINDS } from "@/lib/constants";
import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import * as contexts from "@/lib/repositories/contexts";
import * as memberships from "@/lib/repositories/project-memberships";
import * as projects from "@/lib/repositories/projects";
import * as tasks from "@/lib/repositories/tasks";
import { addContextAction, createProjectAction, deleteContextAction } from "./actions";
import { Explainer, FirstRun } from "./features/explainer";
import { Landing } from "./features/landing";
import { Picker } from "./features/picker";
import { SubmitButton } from "./features/submit";
import { contextKindLabel, kindOptions } from "./kinds";
import { Blob, Chip, Counter, Empty, Field, Panel } from "./components";
import { pageOpenGraph } from "./metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: t("metaTitleHome"),
    description: t("metaDescription"),
    alternates: { canonical: "/" },
    openGraph: pageOpenGraph("/"),
  };
}

const TILTS = [-0.6, 0.5, -0.4, 0.7];

export default async function Home() {
  const { t } = await getT();
  const user = await currentUser();
  // The one page with two audiences. Signed out this is the only description
  // of the product anyone can reach; signed in it is the dashboard.
  if (!user) return <Landing t={t} />;
  // One counts query for the whole page instead of one per project card.
  const [allProjects, globalContext, counts] = await Promise.all([
    projects.list(user.id),
    contexts.listByProject(user.id, null),
    tasks.countsByProject(user.id),
  ]);
  // One grouped query for every card, not one per card.
  const teamSizes = await memberships.countsByProjects(allProjects.map((p) => p.id));

  return (
    <div className="space-y-8">
      <div className="pop prose">
        <h1 className="display text-[28px] leading-[1.1] font-bold sm:text-[36px]">
          {t("heroTitle")}
        </h1>
        <p className="mt-2 text-[15.5px] leading-relaxed text-muted">{t("heroBody")}</p>
      </div>

      <Explainer t={t} />

      <h2 className="display pop pt-1 text-[25px] font-bold">{t("projects")}</h2>

      {allProjects.length === 0 && <FirstRun t={t} />}

      <div className="grid gap-4 sm:grid-cols-2">
        {allProjects.map((p, i) => {
          const c = counts.map.get(p.id) ?? counts.empty;
          return (
            <Link
              key={p.id}
              href={`/p/${p.slug}`}
              className="sticker lift pop block p-4"
              style={{
                animationDelay: `${60 + i * 55}ms`,
                rotate: `${TILTS[i % TILTS.length]}deg`,
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="display text-[20px] font-bold">{p.name}</h3>
                <span className="mono text-[12px] text-faint">{p.slug}</span>
                {/* Somebody else's project, or one of yours that is not only
                    yours. Two cards used to look identical either way. */}
                {p.access_role === "member" && p.owner_name ? (
                  <Chip color="var(--k-handoff)">
                    {t("sharedBy", { name: p.owner_name })}
                  </Chip>
                ) : (
                  (teamSizes.get(p.id) ?? 0) > 0 && (
                    <Chip color="var(--k-handoff)">
                      {t("memberCount", { n: (teamSizes.get(p.id) ?? 0) + 1 })}
                    </Chip>
                  )
                )}
              </div>
              {p.summary && (
                <p className="mt-1.5 line-clamp-2 text-[14px] text-muted">{p.summary}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {c.doing > 0 && (
                  <Chip color="var(--accent)" tilt={-2}>
                    {c.doing} {t("countInFlight")}
                  </Chip>
                )}
                {c.blocked > 0 && (
                  <Chip color="var(--k-dead_end)" tilt={2}>
                    {c.blocked} {t("countStuck")}
                  </Chip>
                )}
                <Chip>
                  {c.todo} {t("countQueued")}
                </Chip>
                {c.done > 0 && (
                  <Chip color="var(--ok)">
                    {c.done} {t("countDone")}
                  </Chip>
                )}
              </div>
              {p.root_path && (
                <p className="mono mt-3 truncate text-[12px] text-faint">{p.root_path}</p>
              )}
            </Link>
          );
        })}

        <details className="pop rounded-[14px] border border-dashed border-line p-4 open:border-solid open:border-line open:bg-card">
          <summary className="link-more">{t("newProject")}</summary>
          <form action={createProjectAction} className="mt-3 space-y-2">
            <Field label={t("projectNamePh")}>
              <input name="name" required />
            </Field>
            <Field label={t("projectPathLabel")}>
              <input
                name="root_path"
                placeholder={t("projectPathPh")}
                className="mono text-small"
              />
            </Field>
            <Field label={t("projectSummaryPh")}>
              <textarea name="summary" />
            </Field>
            <SubmitButton pendingLabel={t("working")}>{t("create")}</SubmitButton>
          </form>
        </details>
      </div>

      <Panel
        delay={220}
        headingId="global-context"
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            {t("globalContext")}
            <span className="text-[13px] font-normal text-muted">
              {t("globalContextSub")}
            </span>
          </span>
        }
        right={<Counter n={globalContext.length} label={t("globalContext")} />}
      >
        <div className="space-y-3">
          {globalContext.length === 0 && <Empty>{t("globalEmpty")}</Empty>}
          {globalContext.map((c) => (
            <div key={c.id} className="sticker-flat group p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip color="var(--k-decision)" tilt={-2}>
                  {contextKindLabel(t, c.kind)}
                </Chip>
                <span className="display min-w-0 text-[15.5px] font-bold break-words">
                  {c.title}
                </span>
                <span className="mono ml-auto shrink-0 text-[11px] text-faint">
                  {ago(c.updated_at, t)}
                </span>
                <form action={deleteContextAction}>
                  <input type="hidden" name="context_id" value={c.id} />
                  <SubmitButton
                    className="link-more row-action text-meta"
                    pendingLabel={t("working")}
                  >
                    {t("delete")}
                    <span className="sr-only"> — {c.title}</span>
                  </SubmitButton>
                </form>
              </div>
              {/* `break-words`: bodies carry paths, urls and commit hashes, and
                  `pre-wrap` alone will not break an unbroken run. The
                  `overflow-x: clip` net in globals.css hides the overflow by
                  cutting the text off, which is worse than a wrap. */}
              <p className="mt-1.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-muted">
                {c.body}
              </p>
            </div>
          ))}

          <details>
            <summary className="link-more">{t("addGlobalNote")}</summary>
            <form action={addContextAction} className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Field label={t("globalContext")} className="w-40">
                  <Picker
                    name="kind"
                    value={CONTEXT_KINDS[0]}
                    options={kindOptions(t)}
                    label={t("globalContext")}
                  />
                </Field>
                <Field label={t("title")} className="min-w-40 flex-1">
                  <input name="title" required />
                </Field>
              </div>
              <Field label={t("noteBodyPh")}>
                <textarea name="body" required />
              </Field>
              <SubmitButton className="btn btn-quiet" pendingLabel={t("saving")}>
                {t("save")}
              </SubmitButton>
            </form>
          </details>
        </div>
      </Panel>

      <section
        className="pop sticker p-5"
        style={{ animationDelay: "300ms" }}
        aria-labelledby="hook-up"
      >
        <div className="flex items-start gap-4">
          <Blob mood="idle" size={52} fill="var(--k-handoff)" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 id="hook-up" className="display text-[18px] font-bold">
              {t("hookTitle")}
            </h2>
            <p className="mt-1 text-[14px] text-muted">{t("hookBody")}</p>
            <Link href="/account" className="link-more mt-3 inline-block">
              {t("hookCta")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
