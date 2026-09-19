import type { Metadata } from "next";
import Link from "next/link";

import { Chip } from "../../components";
import { OrganizationJsonLd } from "../../components/organization-json-ld";
import { pageOpenGraph } from "../../metadata-shared";

/**
 * A post, written once, in one language, on one date.
 *
 * Deliberately not in the dictionaries: `en.ts`/`tr.ts` hold the strings the
 * UI says in both languages to whoever is reading, and this is not that. It
 * is an article with a date on it and measurements in it -- translating it
 * would make a second article that has to be kept true separately, and a
 * post that is silently "updated" when a dictionary changes is the kind of
 * note this product exists to flag. It renders in English whichever language
 * the visitor's browser asks for, and says so nowhere, because a dated post
 * in one language is the normal shape of a post.
 */

export const dynamic = "force-dynamic";

const PATH = "/blog/six-weeks-on-our-own-log";
const TITLE = "Six weeks on our own log";
const DESCRIPTION =
  "We built a memory server for coding agents and pointed it at ourselves: what the agents wrote, what they never closed, and the feature we were proudest of that nobody called.";

export function generateMetadata(): Metadata {
  return {
    title: { absolute: `${TITLE} — todox` },
    description: DESCRIPTION,
    alternates: { canonical: PATH },
    openGraph: { ...pageOpenGraph(PATH), type: "article", publishedTime: "2026-09-19" },
  };
}

/** One measured figure, as a tile. */
function Stat({ n, label, color }: { n: string; label: React.ReactNode; color?: string }) {
  return (
    <div className="sticker p-3.5">
      <b className="mono block text-[26px] leading-none font-medium tabular-nums" style={{ color }}>
        {n}
      </b>
      <span className="mt-1.5 block text-[13px] leading-snug text-muted">{label}</span>
    </div>
  );
}

function Heading({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <h2 className="display mt-11 mb-2.5 text-[24px] leading-tight font-bold text-balance">
      {n && <span className="mono mb-1 block text-[12px] tracking-[.08em] text-faint">{n}</span>}
      {children}
    </h2>
  );
}

export default function SixWeeksOnOurOwnLog() {
  return (
    <article className="prose pop mx-auto text-[16.5px] leading-relaxed [&>ol]:mb-4 [&>p]:mb-4 [&>ul]:mb-4">
      <OrganizationJsonLd />
      <p className="mono mb-3 text-[12.5px] text-faint">
        <Link href="/blog" className="link-more">
          blog
        </Link>{" "}
        · 19 September 2026
      </p>
      <h1 className="display text-[34px] leading-[1.08] font-bold text-balance sm:text-[44px]">
        {TITLE}
      </h1>
      <p className="mt-3 text-[19px] leading-snug text-muted text-pretty">{DESCRIPTION}</p>
      <p className="mono mt-3 text-[12.5px] text-faint">
        measured 1–18 September 2026 on one account · 31 repositories, 2 machines, 4 models
      </p>

      <p className="mt-8">
        todox is an MCP server. An agent calls <code>get_context</code> at the start of a session
        and gets a briefing: the standing rules, the open tasks, the decisions behind them, the
        approaches that failed, and where the last session stopped. While it works it writes entries
        — <code>decision</code>, <code>dead_end</code>, <code>question</code>,{" "}
        <code>handoff</code> — and before it stops it is supposed to leave the log in a state a
        stranger can resume from.
      </p>
      <p>
        &ldquo;Supposed to&rdquo; is the part this post is about. We have been the only serious user for
        six weeks: one account, 31 repositories, a laptop and a desktop, four Claude models. The
        instructions were four lines in the memory file every agent reads. Here is what the data says
        they did with them.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Six measured figures">
        <Stat n="330" label="entries in 18 days — about 18 a day" />
        <Stat n="31" label="dead ends, 9% of the log" color="var(--k-dead_end)" />
        <Stat n="78 / 29" label="tasks opened / closed" />
        <Stat n="5,430 h" label={<>&ldquo;active&rdquo; time the report summed, in 18 days</>} color="var(--k-dead_end)" />
        <Stat n="0" label={<>calls to <code>link_files</code> from the agents</>} color="var(--k-decision)" />
        <Stat n="1" label={<><code>question</code> entry in the month</>} color="var(--k-handoff)" />
      </div>
      <p className="mono mt-2 mb-7 text-[12.5px] text-faint">
        From activity_report and get_context over the todox MCP, 2026-09-18. Every number below comes
        from the same place.
      </p>

      <Heading n="FINDING 1">Capture works, and dead ends get written</Heading>
      <p>
        The fear with a curated log — one where the agent decides what is worth keeping, rather than
        a transcript dump — is that nothing gets kept. It did not happen. Eighteen entries a day
        across a working month, and 82 of them decisions with the alternative that lost named in the
        body.
      </p>
      <p>
        The one we cared about most is the <code>dead_end</code>: the approach that looked right, cost
        an afternoon and failed for a reason nobody writes down. Thirty-one of those. Some are one
        line (&ldquo;Playwright <code>context.route()</code> for blocking images <em>increases</em> proxy
        bandwidth 3–11×, measured — do not&rdquo;). They are the entries that stop the next session
        repeating the afternoon, and agents write them when the kind exists to write them into. A note
        in a file has no such kind, so the failed approach goes into the same paragraph as everything
        else, or nowhere.
      </p>

      <Heading n="FINDING 2">Closure does not, and the report lied about it</Heading>
      <p>
        Seventy-eight tasks were opened in the window and twenty-nine were closed. That alone is fine
        — work is open. What was not fine: tasks had been set to <code>doing</code> by a session that
        then ended, and stayed there. Sixteen days. Twenty-three. Thirty-one. Every one of those days
        sat on the activity report as time worked, because the report summed every hour a task spent
        in <code>doing</code>. One project showed 1,316 hours of work in an 18-day window. The account
        showed 5,430.
      </p>
      <blockquote
        className="my-6 border-l-4 py-1 pl-4 text-[20px] leading-snug font-medium text-balance"
        style={{ borderColor: "var(--accent)" }}
      >
        A duration that can only grow is not a measurement. The status column is a claim; the log
        is the evidence.
      </blockquote>
      <p>
        The instructions had said, clearly, &ldquo;before you finish, set every task you touched to its
        true status.&rdquo; Every agent read that at the start of every session. The rule was never the
        problem. The <em>list</em> was: an agent at the end of a long session does not remember which
        tasks it moved, and a rule cannot tell it. So we did two things.
      </p>
      <ul className="list-disc space-y-2 pl-6">
        <li>
          <strong>The report stopped trusting the status column.</strong> A <code>doing</code> span
          shorter than a day is counted whole — the status change that closed it is proof somebody
          was there. Past a day, only the stretches around signs of life count: the moment it was
          set, every entry written inside it, the change that ended it, four hours either side. The
          rest is reported as <em>unattended, not counted</em>, on the headline and on the task line,
          with a note saying why. The 5,430 hours became a figure we can stand behind, and the report
          says what it left out rather than folding it in.
        </li>
        <li>
          <strong>The agent got the list.</strong> A read-only tool, <code>session_status</code>,
          answers &ldquo;what did I touch this session, and did I write it up&rdquo; from the two tables that
          record activity — they carry the user the token resolved to, so it is a query. It returns
          the tasks this session changed, whether each has a handoff since the last thing it did
          there, and the tasks an earlier session left <code>doing</code> for a week. Read-only, so
          the client never asks permission at the one moment the habit gets dropped. The wrap-up
          rule now begins &ldquo;call session_status&rdquo;.
        </li>
      </ul>

      <Heading n="FINDING 3">The feature we were proudest of was never called</Heading>
      <p>
        todox can link files to a task with their hash. The agent hashes the file (the server has no
        checkout), and the next briefing says whether a note describes code that has since moved on
        — &ldquo;this note may be lying&rdquo; — or, until somebody has actually looked, &ldquo;not checked&rdquo;,
        rather than claiming to be fresh. We wrote about it on the landing page. It is the thing a
        note in a file cannot do.
      </p>
      <p>
        Zero calls. Every task in the month had <code>files: []</code>. The reference ids on the
        whole instance, smoke tests included, had not reached forty.
      </p>
      <p>
        Two reasons, one embarrassing. The instructions said the agent <em>could</em> link files;
        they never said <em>which</em>. Meanwhile every task body pointed at the thing that actually
        drove the work — a plan file under <code>~/.claude/plans</code>, a claude.ai artifact — and
        nothing said that those were exactly what to link. The embarrassing one: a path linked from
        Windows was stored with backslashes and compared, on lookup, against a path folded to forward
        slashes. Equality never held. The few links that existed could not be found again, on the
        machine that made them or any other. The smoke test failed on Windows at precisely that step,
        and we had only ever run it on Linux.
      </p>
      <p>
        Now the instruction is concrete — &ldquo;put the plan a task follows in <code>files</code>,
        wherever it lives; todox warns when it moves on&rdquo; — a URL is accepted and kept as written,
        and paths are folded on the way in.
      </p>

      <Heading n="FINDING 4">Connected is not used</Heading>
      <p>
        This one we had measured before and it is worth repeating, because it applies to every MCP
        server. An MCP server can send <code>instructions</code> at <code>initialize</code>. Ours
        did: the whole protocol, when to call what. In a fresh project, with the server connected the
        entire time, the agent never called it once. The server&rsquo;s instructions are background
        reading; a skill or a rule in the agent&rsquo;s own memory file is an instruction. When they
        disagree, the server loses.
      </p>
      <p>
        The fix is four lines in the file the agent actually obeys, and an installer that writes
        them. This week it is also a Claude Code plugin — the same four lines, installed rather than
        pasted, with one sentence injected at session start by a hook, which is the one channel a
        session cannot skim past.
      </p>

      <Heading n="FINDING 5">The briefing grows with what nobody closes</Heading>
      <p>
        The briefing every session opens with is capped in rows and in bytes, and it reports what the
        caps left out rather than trimming in silence. On the busiest project it left out 48 log
        bodies and 16 task bodies. Most of the tasks paying for those bodies had not been touched in
        weeks, so we added a tier: a task idle for fourteen days comes back as a line — title, status,
        days idle, the last handoff&rsquo;s first line — outside every budget. On a bench corpus with
        six idle tasks the briefing went from 37.9 KB to 25.6 KB and the live log arrived whole.
      </p>
      <p>
        On the busiest project it moved one task. Eighteen of its nineteen open tasks had been
        touched in the last two weeks, nine of them still <code>doing</code>. Its problem is not an
        idle tail; it is that live work does not get closed. That is Finding 2 again, and the honest
        thing to say is that the tier helps projects with a long idle tail and{" "}
        <code>session_status</code> is what helps this one.
      </p>

      <Heading n="FINDING 6">Two small ones</Heading>
      <p>
        <strong>The <code>question</code> kind is nearly unused</strong> — one entry in the month —
        and it is not a failure. Questions get asked and answered inside the session; the kind is for
        the one that has to wait for a human across sessions, and that is rare by nature. We stopped
        counting it as a metric.
      </p>
      <p>
        <strong>Search is language-locked, and its snippet was bolding &ldquo;of&rdquo;.</strong> An
        English question did not find the Turkish decision note that answered it — full text stems,
        it does not translate, and the tool description now says to ask in the language the log is
        written in. The snippet was a real bug: the match was made on the stopword-stripped query, but
        the highlight was made on the raw one with a configuration that has no stopword list, so it
        bolded every &ldquo;of&rdquo; in the document and picked the fragment densest in them. A two-letter
        query, stripped to nothing, was matching every row containing those letters. Both fixed at
        the source of the query text.
      </p>

      <hr className="my-10 border-0 border-t-[1.5px] border-line" />

      <Heading>If you write an MCP server</Heading>
      <ol className="list-decimal space-y-2 pl-6">
        <li>
          <strong>Your instructions are background reading.</strong> Put the rule where the agent
          obeys — its memory file, a skill, a session hook — and measure whether the tools get called,
          by method. &ldquo;Connected&rdquo; is not a number.
        </li>
        <li>
          <strong>If a status can be set and forgotten, your reports will lie.</strong> Count
          evidence, not claims. A span of &ldquo;in progress&rdquo; with nothing else in the log to show
          anyone was there is not work; say how much you discounted, rather than folding it into the
          headline.
        </li>
        <li>
          <strong>The list beats the rule.</strong> &ldquo;Write up every task you touched&rdquo; is a rule
          the agent cannot follow at the end of a long session. A tool that answers &ldquo;what do I
          still owe&rdquo; is something it can act on. Make it read-only so the client never asks
          permission at that moment.
        </li>
        <li>
          <strong>Tell the agent what to link, not that it can.</strong> A capability with no
          concrete instruction is a capability with zero calls.
        </li>
        <li>
          <strong>Run the smoke on the platform your users have.</strong> Ours failed on Windows at
          a step we had only ever proven on Linux, and the failing step was the feature we
          advertised.
        </li>
      </ol>

      <div className="sticker mt-8 p-4">
        <p className="mono mb-2 text-[12px] tracking-[.08em] text-faint uppercase">
          What changed this week
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="mono text-left text-[11.5px] tracking-[.06em] text-faint uppercase">
                <th className="py-1.5 pr-3 font-medium">Finding</th>
                <th className="py-1.5 pr-3 font-medium">Change</th>
                <th className="py-1.5 font-medium">Measured</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-t border-rule">
                <td className="py-2 pr-3">2</td>
                <td className="py-2 pr-3">Attended time; <code>discounted_ms</code> on the headline, task lines and the report page</td>
                <td className="mono py-2 whitespace-nowrap">5,430 h → what the log supports</td>
              </tr>
              <tr className="border-t border-rule">
                <td className="py-2 pr-3">2</td>
                <td className="py-2 pr-3"><code>session_status</code>, read-only; wrap-up rule begins with it</td>
                <td className="mono py-2 whitespace-nowrap">live, both transports</td>
              </tr>
              <tr className="border-t border-rule">
                <td className="py-2 pr-3">3</td>
                <td className="py-2 pr-3">Paths folded on link; URLs kept; &ldquo;link the plan&rdquo; in the instructions</td>
                <td className="mono py-2 whitespace-nowrap">Windows smoke passes the step</td>
              </tr>
              <tr className="border-t border-rule">
                <td className="py-2 pr-3">5</td>
                <td className="py-2 pr-3">Idle tier in the briefing (14 days)</td>
                <td className="mono py-2 whitespace-nowrap">37.9 → 25.6 KB on the bench</td>
              </tr>
              <tr className="border-t border-rule">
                <td className="py-2 pr-3">6</td>
                <td className="py-2 pr-3">Snippet on the stripped query; substring arm off under 3 characters</td>
                <td className="mono py-2 whitespace-nowrap">&ldquo;of&rdquo; → 0 hits</td>
              </tr>
              <tr className="border-t border-rule">
                <td className="py-2 pr-3">4</td>
                <td className="py-2 pr-3">Claude Code plugin: server + skill + session-start reminder</td>
                <td className="mono py-2 whitespace-nowrap">2 commands to install</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <footer className="mt-10 text-[14.5px] text-muted">
        <p>
          todox is MIT and runs as one container beside a Postgres:{" "}
          <a href="https://github.com/beydemirfurkan/todox" className="link-more" rel="noreferrer">
            the code
          </a>
          , <Link href="/" className="link-more">the hosted one</Link>. Every figure here is from{" "}
          <code>activity_report</code> and <code>get_context</code> on our own account, and the pull
          requests behind the changes are #129–#136 in the repository. If your agent already remembers
          things — Claude Code has written its own notes since February — this is not a replacement
          for that. It is the log that crosses the lines that memory stops at: two machines, every
          agent, the people.
        </p>
        <p className="mt-3 flex flex-wrap gap-2">
          <Chip color="var(--k-decision)">decision</Chip>
          <Chip color="var(--k-dead_end)">dead end</Chip>
          <Chip color="var(--k-question)">question</Chip>
          <Chip color="var(--k-handoff)">handoff</Chip>
        </p>
      </footer>
    </article>
  );
}
