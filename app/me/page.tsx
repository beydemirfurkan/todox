import type { Metadata } from "next";
import Link from "next/link";

import { DEVELOPER_KINDS, isDeveloperKind, type DeveloperKind } from "@/lib/constants";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import * as contexts from "@/lib/repositories/contexts";
import { requireUser } from "@/lib/session";
import { BRAIN_MAP_DAYS, brainMapProjects } from "@/lib/services/brain-map";
import { developerBrief, renderDeveloper } from "@/lib/services/developer";
import type { Context } from "@/lib/types";
import {
  addContextAction,
  deleteContextAction,
  setContextPublicAction,
  setContextPinnedAction,
  updateContextAction,
} from "../actions";
import {
  BrainMap,
  Composer,
  Empty,
  Field,
  IconTile,
  NoteGroups,
  Panel,
  StatBadges,
} from "../components";
import { BRAIN_MAP_NODES, type BrainNode } from "../components/brain-map";
import { Picker } from "../features/picker";
import { SubmitButton } from "../features/submit";
import { CONTEXT_KIND_COLOR, KIND_COLOR, kindOptions } from "../kinds";
import { privatePageMetadata } from "../metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleBrain"));
}

const SECTION_COPY: Record<DeveloperKind, { title: "brainProfile" | "brainStack" | "brainWorkflow"; hint: "brainProfileHint" | "brainStackHint" | "brainWorkflowHint" }> = {
  profile: { title: "brainProfile", hint: "brainProfileHint" },
  stack: { title: "brainStack", hint: "brainStackHint" },
  workflow: { title: "brainWorkflow", hint: "brainWorkflowHint" },
};

const NOTE_ACTIONS = {
  remove: deleteContextAction,
  update: updateContextAction,
  publish: setContextPublicAction,
  pin: setContextPinnedAction,
};

/**
 * The developer's own brain: what every agent reads about this person before
 * it starts, and the one place a person can see it, correct it, and choose
 * what goes on their public profile.
 *
 * One round of reads. The notes come in full (the page is for the owner, and
 * there are few of them); the map is counts only; the agent's view is
 * rendered from the same brief `get_developer` returns, so what this page
 * says an agent reads is what an agent reads.
 */
export default async function BrainPage() {
  const user = await requireUser();
  const { t } = await getT();
  const [accountNotes, mapProjects, brief] = await Promise.all([
    contexts.listByProject(user.id, null),
    brainMapProjects(user.id),
    developerBrief(user.id),
  ]);

  const developerNotes = accountNotes.filter((n) => isDeveloperKind(n.kind));
  const rules = accountNotes.filter((n) => !isDeveloperKind(n.kind));

  return (
    <div className="space-y-6">
      <header className="pop flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <IconTile name="brain" color="var(--accent)" className="!size-12" />
          <h1 className="display text-[clamp(28px,4vw,38px)] leading-[1.05]">{t("brainTitle")}</h1>
        </div>
        <p className="max-w-[70ch] text-[15px] leading-relaxed text-muted">{t("brainLede")}</p>
        <StatBadges
          label={t("brainTitle")}
          stats={[
            { label: t("brainNotesCount"), value: developerNotes.length, mark: "var(--accent)" },
            { label: t("brainRulesCount"), value: rules.length, mark: "var(--k-handoff)" },
          ]}
        />
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {DEVELOPER_KINDS.map((kind, i) => (
          <DeveloperSection
            key={kind}
            kind={kind}
            notes={developerNotes.filter((n) => n.kind === kind)}
            delay={40 + i * 40}
            t={t}
          />
        ))}
      </div>

      <Panel
        title={t("brainMapTitle")}
        right={<span className="text-small font-normal text-muted">{mapProjects.length}</span>}
        delay={160}
      >
        <div className="space-y-4 p-4">
          <p className="max-w-[72ch] text-small text-muted">{t("brainMapSub", { n: BRAIN_MAP_DAYS })}</p>
          {mapProjects.length === 0 ? (
            <Empty>{t("brainMapEmpty", { n: BRAIN_MAP_DAYS })}</Empty>
          ) : (
            <>
              <BrainMap nodes={mapProjects} centre={t("brainYou")} />
              <BrainProjectList projects={mapProjects} t={t} />
            </>
          )}
        </div>
      </Panel>

      <Panel title={t("brainRules")} delay={200}>
        <div className="relative space-y-3 p-4">
          <p className="pr-11 text-small text-muted">{t("brainRulesSub")}</p>
          <Composer id="new-rule" label={t("addGlobalNote")} action={addContextAction}>
            <Field label={t("title")}>
              <input name="title" autoFocus required />
            </Field>
            <Field label={t("noteBodyPh")}>
              <textarea name="body" required />
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("globalContext")} className="w-full min-w-0 sm:w-40">
                <Picker name="kind" value="convention" options={kindOptions(t)} label={t("globalContext")} />
              </Field>
              <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
            </div>
          </Composer>
          {rules.length === 0 ? (
            <Empty>{t("globalEmpty")}</Empty>
          ) : (
            <NoteGroups notes={rules} t={t} actions={NOTE_ACTIONS} />
          )}
        </div>
      </Panel>

      <Panel title={t("brainAgentView")} delay={240}>
        <div className="space-y-3 p-4">
          <p className="text-small text-muted">{t("brainAgentViewSub")}</p>
          <details className="disclosure sticker-flat">
            <summary className="mono p-3 text-meta text-accentInk">get_developer</summary>
            <pre className="mono overflow-x-auto px-3 pb-3 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-muted">
              {renderDeveloper(brief)}
            </pre>
          </details>
        </div>
      </Panel>
    </div>
  );
}

const BRAIN_LIST_ROWS = BRAIN_MAP_NODES;

/**
 * The map's projects as rows: the name, then only the counts that are not
 * zero, each a word in its kind's colour. It was two columns of mono text
 * printing five numbers per project, zeros included, and read as a log dump.
 */
function BrainProjectList({ projects, t }: { projects: BrainNode[]; t: T }) {
  const shown = projects.slice(0, BRAIN_LIST_ROWS);
  return (
    <>
      <ul className="flex flex-col">
        {shown.map((p) => (
          <li key={p.slug} className="border-t border-rule first:border-t-0">
            <Link href={`/p/${p.slug}`} className="brain-row">
              <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{p.name}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
                {p.open > 0 && <BrainCount color="var(--accent)" text={countText(t, "Open", p.open)} />}
                {p.decisions > 0 && (
                  <BrainCount color={KIND_COLOR.decision} text={countText(t, "Decisions", p.decisions)} />
                )}
                {p.deadEnds > 0 && (
                  <BrainCount color={KIND_COLOR.dead_end} text={countText(t, "DeadEnds", p.deadEnds)} />
                )}
                {p.questions > 0 && (
                  <BrainCount color={KIND_COLOR.question} text={countText(t, "Questions", p.questions)} />
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {projects.length > shown.length && (
        <p className="px-3 text-small text-muted">{t("brainMapMore", { n: projects.length - shown.length })}</p>
      )}
    </>
  );
}

type BrainStat = "Open" | "Decisions" | "DeadEnds" | "Questions";

function countText(t: T, stat: BrainStat, n: number): string {
  return n === 1 ? t(`brainStat${stat}One`) : t(`brainStat${stat}`, { n });
}

function BrainCount({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted">
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

/**
 * One of the three things an agent should know about a person, as a card:
 * every note of the kind in full, each one editable, and a form to add one.
 */
function DeveloperSection({
  kind,
  notes,
  delay,
  t,
}: {
  kind: DeveloperKind;
  notes: Context[];
  delay: number;
  t: T;
}) {
  const copy = SECTION_COPY[kind];
  return (
    <section className="sticker pop flex flex-col" style={{ animationDelay: `${delay}ms` }}>
      <header className="flex items-start gap-2.5 border-b border-dashed border-rule p-4">
        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: CONTEXT_KIND_COLOR[kind] }} />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink-head">{t(copy.title)}</h2>
          <p className="text-small text-muted">{t(copy.hint)}</p>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {notes.length === 0 ? (
          <p className="text-small text-faint">{t("brainSectionEmpty")}</p>
        ) : (
          <NoteGroups notes={notes} t={t} actions={NOTE_ACTIONS} />
        )}
        <details className="mt-auto">
          <summary className="link-more inline-flex text-meta">{t("brainAdd")}</summary>
          <form action={addContextAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="kind" value={kind} />
            <label className="flex flex-col gap-1 text-meta text-faint">
              {t("title")}
              <input name="title" required maxLength={500} />
            </label>
            <label className="flex flex-col gap-1 text-meta text-faint">
              {t("noteBodyPh")}
              <textarea name="body" required rows={4} />
            </label>
            <div>
              <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
            </div>
          </form>
        </details>
      </div>
    </section>
  );
}
