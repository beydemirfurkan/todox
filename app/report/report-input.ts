import { getTz } from "@/lib/lang";
import { resolve } from "@/lib/services/project-resolver";
import { resolvePeriod, type PeriodName } from "@/lib/util/time";

const PERIODS: PeriodName[] = ["today", "yesterday", "week", "last_week", "month", "last_30_days"];

/**
 * The pills, and nothing else.
 *
 * `"all"` used to be accepted here while being left out of `PERIODS`, so it had
 * no button and was still one URL edit away. `resolvePeriod` turns it into
 * `new Date(0)`, and the read behind it is a four-way join with no LIMIT whose
 * every decision, dead end and question body then goes into the response --
 * an account's entire history, on a `force-dynamic` page, out of a pool of ten.
 *
 * Not capped instead, deliberately: a report's numbers have to be right, and a
 * truncated input makes "you closed five tasks" a guess. The window is the
 * thing to bound, so an unbounded one is simply not offered. `activity_report`
 * still takes `all` for an agent that asks for it on purpose.
 */
export const REPORT_PERIODS: readonly PeriodName[] = PERIODS;

const isPeriod = (v: unknown): v is PeriodName =>
  typeof v === "string" && (PERIODS as string[]).includes(v);

export interface ReportInput {
  period: PeriodName;
  projectRef?: string;
  window: ReturnType<typeof resolvePeriod>;
  projectId?: number;
}

/**
 * What the page and the markdown route both read from a query string. `null`
 * means a project reference that does not resolve for this reader, which both
 * answer with a 404.
 *
 * `mustResolve` would throw for an unknown reference, which is the right
 * answer to an agent and the wrong one to a browser: a bookmark pointing at a
 * renamed project rendered "Application error: a server-side exception has
 * occurred".
 */
export async function readReportInput(
  userId: number,
  query: { period?: string | null; project?: string | null },
): Promise<ReportInput | null> {
  const period: PeriodName = isPeriod(query.period) ? query.period : "today";
  const projectRef = query.project || undefined;
  const window = resolvePeriod(period, { tz: await getTz() });
  if (!projectRef) return { period, window };
  const project = await resolve(userId, projectRef);
  if (!project) return null;
  return { period, projectRef, window, projectId: project.id };
}

/** Where the markdown for the same report is served. */
export function markdownHref(input: ReportInput): string {
  const qs = new URLSearchParams({ period: input.period });
  if (input.projectRef) qs.set("project", input.projectRef);
  return `/report/markdown?${qs}`;
}
