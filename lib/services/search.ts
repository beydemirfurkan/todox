import { all } from "../db/client";

export type SearchHit = {
  type: "task" | "entry" | "context";
  id: number;
  task_id?: number;
  project_slug: string | null;
  title: string;
  snippet: string;
  created_at: string;
};

type Scored = { rank: number; created_at: string };

/** A hit while it still carries the score that ordered it. */
type Ranked = SearchHit & { rank: number };
type TaskRow = Scored & { id: number; title: string; snippet: string | null; project_slug: string };
type EntryRow = Scored & {
  id: number;
  task_id: number;
  kind: string;
  snippet: string | null;
  title: string;
  project_slug: string;
};
type ContextRow = Scored & {
  id: number;
  kind: string;
  title: string;
  snippet: string | null;
  project_slug: string | null;
};

/**
 * `%` and `_` are wildcards to ILIKE, so a search for either matched
 * everything and a search for a literal one found nothing.
 */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Two configurations, because this log is written in two languages.
 *
 * There is no single one that works. `simple` does not stem at all, so
 * `kararların` does not match `karar` and `deploys` does not match `deploy`.
 * `english` stems the English half and leaves the Turkish alone; `turkish`
 * does the reverse — both ship with Postgres, and picking either would halve
 * the corpus. So each document is indexed under both and a query is asked of
 * both, which is what `pnpm bench:memory` was built to be able to settle.
 *
 * DELIBERATELY NOT INDEXED YET, and the reason is worth knowing before anybody
 * adds one. Six GIN expression indexes were written, applied, and taken back
 * out: `EXPLAIN` showed a sequential scan anyway, because the ILIKE fallback
 * below sits in the same `OR` and one non-indexable arm makes the whole
 * disjunction non-indexable. With that arm removed the planner used them
 * (`BitmapOr` over both configurations), so the indexes were correct and the
 * query shape was wrong.
 *
 * Fixing that properly means splitting the two arms into a union of ids and
 * joining once, with ownership repeated in each branch, and that is a change
 * worth making on its own rather than smuggled in beside this one. Until then
 * this is exactly as fast as what it replaces -- three sequential scans -- and
 * considerably better at answering. Shipping an index nothing can use would
 * have been worse than shipping none: it costs writes and disk, and it tells
 * the next reader that search is indexed when it is not.
 */
const DOC = (...cols: string[]) => cols.map((c) => `coalesce(${c}, '')`).join(` || ' ' || `);
const VEC = (cfg: string, doc: string) => `to_tsvector('${cfg}', ${doc})`;
const MATCHES = (doc: string) => `(${VEC("english", doc)} @@ q.en OR ${VEC("turkish", doc)} @@ q.tr)`;
const RANK = (doc: string) =>
  `greatest(ts_rank(${VEC("english", doc)}, q.en), ts_rank(${VEC("turkish", doc)}, q.tr))`;

/**
 * The query, both ways of asking it, and OR rather than AND.
 *
 * `websearch_to_tsquery` is the parser that understands what a person types:
 * quoted phrases, `or`, and a leading minus. It never raises on malformed
 * input, which `to_tsquery` does — and a search box that can be made to 500 is
 * a search box that will be.
 *
 * What it does not do is answer a question. It joins every term with AND, so
 * "why did we choose scrypt instead of bcrypt" only matches a document holding
 * *all* of `choos`, `scrypt`, `instead`, `bcrypt`, `password` — and the note
 * that answers it contains two of them. Measured: 2 of 22 questions.
 *
 * So the conjunctions are rewritten to disjunctions and `ts_rank` is left to do
 * the ordering, which is what it is for — a document matching four of the terms
 * outranks one matching one. Phrase operators from quoted input are `<->` and
 * are untouched, so "an exact phrase" still means one.
 *
 * Rewritten through `::text` because tsquery has no operator-swapping function.
 * It is a narrow trick and it is safe here: the value being rewritten is the
 * *parser's own output*, not the caller's string, so nothing user-supplied can
 * change the shape of what comes back.
 */
const QUERY = `WITH q AS (
  SELECT replace(websearch_to_tsquery('english', ?)::text, ' & ', ' | ')::tsquery AS en,
         replace(websearch_to_tsquery('turkish', ?)::text, ' & ', ' | ')::tsquery AS tr
)`;

/**
 * `CROSS JOIN q`, last, and never `FROM tasks t, q JOIN projects p`.
 *
 * The comma form parses as `t, (q JOIN p ON …)`, so the join condition is
 * resolved inside a scope `t` is not in and the query fails with "invalid
 * reference to FROM-clause entry". It reads as though it should work, which is
 * the only reason it is worth a comment.
 */

/**
 * How a match is shown: the part of the document the query actually hit.
 *
 * The old snippet was the body's first 240 characters, which for a long
 * handoff routinely contained no occurrence of the search term at all — the
 * agent had to spend a second call to find out why a row matched. `simple`
 * here rather than a stemmed configuration on purpose: a headline's job is to
 * point at the text, and highlighting `karar` inside `kararların` reads as a
 * typo rather than as a match.
 */
const HEADLINE = (doc: string) =>
  `ts_headline('simple', ${doc}, plainto_tsquery('simple', ?),
     'MaxWords=32, MinWords=12, ShortWord=2, MaxFragments=2, FragmentDelimiter= … ')`;

/**
 * Full-text search, with the old substring match kept underneath it.
 *
 * The fallback is not belt-and-braces: `to_tsvector` splits on word
 * boundaries, so `Clause` stops finding `setClause` the moment full-text is
 * the only path — and half of what is searched in an engineering log is an
 * identifier. Keeping ILIKE in the `WHERE` means this is strictly better than
 * what it replaces rather than differently good, and the ranking puts the
 * lexical matches first because those are the ones the query actually
 * understood.
 */
export async function search(userId: number, query: string, limit = 30): Promise<SearchHit[]> {
  const like = `%${escapeLike(query)}%`;

  const taskDoc = DOC("t.title", "t.body");
  const entryDoc = DOC("e.body");
  const contextDoc = DOC("c.title", "c.body");

  const [taskRows, entryRows, contextRows] = await Promise.all([
    all<TaskRow>(
      `${QUERY}
       SELECT id, title, project_slug, rank, created_at,
              ${HEADLINE("doc")} AS snippet
         FROM (
           SELECT t.id, t.title, t.created_at, ${taskDoc} AS doc,
                  CASE WHEN p.user_id = ? THEN p.slug ELSE pm.access_slug END AS project_slug,
                  ${RANK(taskDoc)} AS rank
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
             CROSS JOIN q
            WHERE (p.user_id = ? OR pm.user_id IS NOT NULL)
              AND (${MATCHES(taskDoc)} OR t.title ILIKE ? OR t.body ILIKE ?)
            ORDER BY rank DESC, t.updated_at DESC
            LIMIT ?
         ) hit`,
      [query, query, query, userId, userId, userId, like, like, limit],
    ),
    all<EntryRow>(
      `${QUERY}
       SELECT id, task_id, kind, title, project_slug, rank, created_at,
              ${HEADLINE("doc")} AS snippet
         FROM (
           SELECT e.id, e.task_id, e.kind, e.created_at, t.title, ${entryDoc} AS doc,
                  CASE WHEN p.user_id = ? THEN p.slug ELSE pm.access_slug END AS project_slug,
                  ${RANK(entryDoc)} AS rank
             FROM entries e
             JOIN tasks t ON t.id = e.task_id
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
             CROSS JOIN q
            WHERE (p.user_id = ? OR pm.user_id IS NOT NULL)
              AND (${MATCHES(entryDoc)} OR e.body ILIKE ?)
            ORDER BY rank DESC, e.id DESC
            LIMIT ?
         ) hit`,
      [query, query, query, userId, userId, userId, like, limit],
    ),
    all<ContextRow>(
      `${QUERY}
       SELECT id, kind, title, project_slug, rank, created_at,
              ${HEADLINE("doc")} AS snippet
         FROM (
           SELECT c.id, c.kind, c.title, c.created_at, ${contextDoc} AS doc,
                  CASE WHEN p.user_id = ? THEN p.slug ELSE pm.access_slug END AS project_slug,
                  ${RANK(contextDoc)} AS rank
             FROM contexts c
             LEFT JOIN projects p ON p.id = c.project_id
             LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
             CROSS JOIN q
            WHERE (c.project_id IS NULL AND c.user_id = ?
                OR c.project_id IS NOT NULL AND (p.user_id = ? OR pm.user_id IS NOT NULL))
              AND (${MATCHES(contextDoc)} OR c.title ILIKE ? OR c.body ILIKE ?)
            ORDER BY rank DESC, c.updated_at DESC
            LIMIT ?
         ) hit`,
      [query, query, query, userId, userId, userId, userId, like, like, limit],
    ),
  ]);

  return [
    ...taskRows.map(
      (t): Ranked => ({
        type: "task",
        id: t.id,
        project_slug: t.project_slug,
        title: t.title,
        snippet: cut(t.snippet),
        created_at: t.created_at,
        rank: t.rank,
      }),
    ),
    ...entryRows.map(
      (e): Ranked => ({
        type: "entry",
        id: e.id,
        task_id: e.task_id,
        project_slug: e.project_slug,
        title: `${e.kind} @ ${e.title}`,
        snippet: cut(e.snippet),
        created_at: e.created_at,
        rank: e.rank,
      }),
    ),
    ...contextRows.map(
      (c): Ranked => ({
        type: "context",
        id: c.id,
        project_slug: c.project_slug,
        title: `${c.kind}: ${c.title}`,
        snippet: cut(c.snippet),
        created_at: c.created_at,
        rank: c.rank,
      }),
    ),
  ]
    // Rank first, recency only to break a tie. The old merge sorted the three
    // result sets by `created_at` alone, which meant the answer to the question
    // lost to whatever had been written most recently -- and each sub-query had
    // already taken its own top `limit` by a *different* key, so what survived
    // the cut and what survived the sort were not the same rows.
    .sort((a, b) => b.rank - a.rank || b.created_at.localeCompare(a.created_at))
    // The limit is a limit on the answer, not on each of the three queries.
    // Asking for 100 and receiving 300 is the kind of surprise that fills an
    // agent's context window without anyone deciding to.
    .slice(0, limit)
    .map(({ rank: _rank, ...hit }) => hit);
}

/**
 * `ts_headline` returns the whole document when nothing matched -- which is
 * every row the ILIKE fallback found, since the query it was given never
 * parsed to anything those rows contain. Cutting here is what stops one of
 * those arriving as 100 KB.
 */
const cut = (s: string | null) => (s ?? "").replace(/\s+/g, " ").slice(0, 240);
