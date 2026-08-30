import { all } from "../db/client";
import { document, vector } from "../db/fts";

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
 * Everything the three queries need, bound once.
 *
 * The user id and the substring pattern live here rather than being repeated
 * as placeholders because each is referenced four or five times across the two
 * arms below, and `lib/db/client.ts` rewrites `?` to `$n` *positionally*: a
 * dozen interchangeable integers in one array is a transposition waiting to
 * happen, and transposing two user ids is not the kind of bug that announces
 * itself. Binding them as columns of a one-row CTE means every query on this
 * page takes the same six parameters in the same order.
 *
 * `q` is joined first in every FROM below so that it is in scope for the joins
 * that reference `q.uid`. The mirror-image mistake -- `FROM tasks t, q JOIN
 * projects p ON …` -- parses as `t, (q JOIN p)` and fails with "invalid
 * reference to FROM-clause entry", which reads as though it should have worked.
 *
 * On the query itself: `websearch_to_tsquery` is the parser that understands
 * what a person types -- quoted phrases, `or`, a leading minus -- and never
 * raises on malformed input, which `to_tsquery` does. A search box that can be
 * made to 500 is a search box that will be.
 *
 * What it does not do is answer a question. It joins every term with AND, so
 * "why did we choose scrypt instead of bcrypt" only matches a document holding
 * *all* of `choos`, `scrypt`, `instead`, `bcrypt` -- and the note that answers
 * it contains two of them. Measured: 2 of 24 questions. So the conjunctions are
 * rewritten to disjunctions and `ts_rank` is left to do the ordering, which is
 * what it is for. Phrase operators from quoted input are `<->` and are
 * untouched, so "an exact phrase" still means one.
 *
 * Rewritten through `::text` because tsquery has no operator-swapping function.
 * It is a narrow trick and it is safe here: the value being rewritten is the
 * *parser's own output*, not the caller's string, so nothing user-supplied can
 * change the shape of what comes back.
 */
const BINDINGS = `WITH q AS (
  SELECT ?::int  AS uid,
         ?::text AS pat,
         replace(websearch_to_tsquery('english', ?)::text, ' & ', ' | ')::tsquery AS en,
         replace(websearch_to_tsquery('turkish', ?)::text, ' & ', ' | ')::tsquery AS tr
)`;

const MATCHES = (doc: string) =>
  `(${vector("english", doc)} @@ q.en OR ${vector("turkish", doc)} @@ q.tr)`;

const RANK = (doc: string) =>
  `greatest(ts_rank(${vector("english", doc)}, q.en), ts_rank(${vector("turkish", doc)}, q.tr))`;

/**
 * How a match is shown: the part of the document the query actually hit.
 *
 * The old snippet was the body's first 240 characters, which for a long
 * handoff routinely contained no occurrence of the search term at all -- the
 * agent had to spend a second call to find out why a row matched. `simple`
 * here rather than a stemmed configuration on purpose: a headline's job is to
 * point at the text, and highlighting `karar` inside `kararların` reads as a
 * typo rather than as a match.
 *
 * It runs in the outer query, after the limit, because it is the most
 * expensive thing on this page and there is no reason to build a fragment for
 * a row nobody will be shown.
 */
const HEADLINE = (doc: string) =>
  `ts_headline('simple', ${doc}, plainto_tsquery('simple', ?),
     'MaxWords=32, MinWords=12, ShortWord=2, MaxFragments=2, FragmentDelimiter= … ')`;

/**
 * What differs between searching tasks, entries and notes. Everything else is
 * the same query.
 */
type Searchable = {
  /** `FROM … WHERE <ownership>`, and the reason it is one string: see below. */
  scoped: string;
  /** The text this row is matched and ranked by, from `db/fts.ts`. */
  doc: string;
  /** The arm full-text cannot answer -- see `buildQuery`. */
  substring: string;
  /** Carried through the union: the id, the recency tie-break, the slug. */
  carried: string;
  /** What the answer needs once the ids are known. */
  columns: string;
  /** How to get from an id back to the row. */
  join: string;
};

/**
 * Full-text search and substring search, asked separately and merged by id.
 *
 * The substring arm is not belt-and-braces. `to_tsvector` splits on word
 * boundaries, so `Clause` stops finding `setClause` the moment full-text is the
 * only path -- and half of what is searched in an engineering log is an
 * identifier. Rows only it found score 0 and sort last, because those are the
 * ones the query was not understood well enough to rank.
 *
 * The two arms are separate *statements* rather than two sides of an `OR`, and
 * that is the whole point of this shape. Postgres cannot use an index for a
 * disjunction unless it can use one for every branch, and no core index answers
 * `ILIKE '%…%'` -- so one un-indexable arm made the full-text arm un-indexable
 * too, and every search built two tsvectors for every row of every table it
 * touched. Split, the full-text arm is a bitmap index scan and the substring
 * arm is a cheap string comparison over the rows the reader owns. Measured on a
 * corpus of 110k rows: 2.5s to 25ms.
 *
 * Written from one description rather than typed twice on purpose. The rule
 * that matters is that **ownership is asserted in both arms** -- leaking
 * nothing either way, since the union feeds a join that re-derives the row, but
 * without it every account's search scans every other account's rows. A rule
 * you have to remember to type twice is a rule that will be typed once.
 */
function buildQuery(t: Searchable): string {
  const arm = (score: string, predicate: string) =>
    `SELECT ${t.carried}, ${score} AS rank ${t.scoped} AND ${predicate}`;

  return `${BINDINGS}, hit AS (
      ${arm(RANK(t.doc), MATCHES(t.doc))}
      UNION ALL
      ${arm("0::real", `(${t.substring})`)}
    ), top AS (
      SELECT id, sort_key, project_slug, max(rank) AS rank
        FROM hit
       GROUP BY id, sort_key, project_slug
       ORDER BY rank DESC, sort_key DESC, id DESC
       LIMIT ?
    )
    SELECT ${t.columns}, top.rank, top.project_slug,
           ${HEADLINE(t.doc)} AS snippet
      FROM top ${t.join}
     ORDER BY top.rank DESC, top.sort_key DESC, top.id DESC`;
}

/**
 * The slug the reader knows this project by: its own, or the one their
 * membership was granted under.
 */
const SLUG = `CASE WHEN p.user_id = q.uid THEN p.slug ELSE pm.access_slug END`;

const TASKS: Searchable = {
  scoped: `FROM q
             CROSS JOIN tasks t
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = q.uid
            WHERE (p.user_id = q.uid OR pm.user_id IS NOT NULL)`,
  doc: document("tasks", "t"),
  substring: `t.title ILIKE q.pat OR t.body ILIKE q.pat`,
  carried: `t.id, t.updated_at AS sort_key, ${SLUG} AS project_slug`,
  columns: `t.id, t.title, t.created_at`,
  join: `JOIN tasks t ON t.id = top.id`,
};

const ENTRIES: Searchable = {
  scoped: `FROM q
             CROSS JOIN entries e
             JOIN tasks t ON t.id = e.task_id
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = q.uid
            WHERE (p.user_id = q.uid OR pm.user_id IS NOT NULL)`,
  doc: document("entries", "e"),
  substring: `e.body ILIKE q.pat`,
  carried: `e.id, e.created_at AS sort_key, ${SLUG} AS project_slug`,
  columns: `e.id, e.task_id, e.kind, e.created_at, t.title`,
  join: `JOIN entries e ON e.id = top.id JOIN tasks t ON t.id = e.task_id`,
};

/**
 * A note with no project is account-wide, so its owner is on the row itself
 * rather than borrowed from a project -- which is why this one ownership test
 * is two tests, and why `p` is joined LEFT.
 */
const CONTEXTS: Searchable = {
  scoped: `FROM q
             CROSS JOIN contexts c
             LEFT JOIN projects p ON p.id = c.project_id
             LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = q.uid
            WHERE (c.project_id IS NULL AND c.user_id = q.uid
                OR c.project_id IS NOT NULL AND (p.user_id = q.uid OR pm.user_id IS NOT NULL))`,
  doc: document("contexts", "c"),
  substring: `c.title ILIKE q.pat OR c.body ILIKE q.pat`,
  carried: `c.id, c.updated_at AS sort_key, ${SLUG} AS project_slug`,
  columns: `c.id, c.kind, c.title, c.created_at`,
  join: `JOIN contexts c ON c.id = top.id`,
};

/**
 * Built once, and exported so `search.test.ts` can assert that the expression
 * these ask for is the one `schema.ts` indexed. That test is the only cheap
 * witness there is: a mismatch does not fail, it just quietly stops using the
 * index.
 */
export const QUERIES = {
  tasks: buildQuery(TASKS),
  entries: buildQuery(ENTRIES),
  contexts: buildQuery(CONTEXTS),
};

export async function search(userId: number, query: string, limit = 30): Promise<SearchHit[]> {
  // The order is the order the placeholders appear in, which is the same for
  // all three because `BINDINGS` is the same for all three. Everything after
  // the CTE reads `q.uid` and `q.pat`; the two loose ones are the limit inside
  // `top` and the query the headline is highlighted against.
  const params = [userId, `%${escapeLike(query)}%`, query, query, limit, query];

  const [taskRows, entryRows, contextRows] = await Promise.all([
    all<TaskRow>(QUERIES.tasks, params),
    all<EntryRow>(QUERIES.entries, params),
    all<ContextRow>(QUERIES.contexts, params),
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
    // Rank first, recency only to break a tie, id only to break that. The old
    // merge sorted the three result sets by `created_at` alone, which meant the
    // answer to the question lost to whatever had been written most recently --
    // and each sub-query had already taken its own top `limit` by a *different*
    // key, so what survived the cut and what survived the sort were not the
    // same rows. The id is last because two rows written in the same second
    // otherwise land in whatever order the merge happened to produce, and a
    // search that returns a different page for the same query is one an agent
    // cannot cache or compare.
    .sort((a, b) => b.rank - a.rank || b.created_at.localeCompare(a.created_at) || b.id - a.id)
    // The limit is a limit on the answer, not on each of the three queries.
    // Asking for 100 and receiving 300 is the kind of surprise that fills an
    // agent's context window without anyone deciding to.
    .slice(0, limit)
    .map(({ rank: _rank, ...hit }) => hit);
}

/**
 * `ts_headline` returns the whole document when nothing matched -- which is
 * every row the substring arm found, since the query it was given never parsed
 * to anything those rows contain. Cutting here is what stops one of those
 * arriving as 100 KB.
 */
const cut = (s: string | null) => (s ?? "").replace(/\s+/g, " ").slice(0, 240);
