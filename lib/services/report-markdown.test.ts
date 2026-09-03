import { describe, expect, it } from "vitest";

import { translator } from "../i18n";
import { renderMarkdown } from "./report-markdown";
import type { ActivityReport, ReportEntry } from "./reports";

const t = translator("en");

const entry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
  task_id: 7,
  task: "Ship the report",
  project_slug: "todox",
  body: "one line",
  truncated: false,
  at: "2026-09-03T09:00:00.000Z",
  ...over,
});

const report = (over: Partial<ActivityReport> = {}): ActivityReport => ({
  period: {
    from: "2026-09-03T00:00:00.000Z",
    to: "2026-09-03T23:59:59.999Z",
    label: "today",
    tz: "UTC",
  },
  generated_at: "2026-09-03T12:00:00.000Z",
  totals: {
    created: 0,
    completed: 0,
    dropped: 0,
    touched: 1,
    entries: 1,
    decisions: 0,
    dead_ends: 0,
    questions: 0,
    active_ms: 0,
  },
  by_project: [],
  by_model: [],
  completed: [],
  in_progress: [],
  decisions: [],
  dead_ends: [],
  open_questions: [],
  ...over,
});

/**
 * These bodies are paragraphs, and a paragraph inside a `- ` item is where
 * this file used to break: the second line was not indented, so the list ended
 * there and the rest of the body was re-parsed as top-level Markdown. The
 * assertions are about the shape of the output rather than one helper, because
 * that is what a paste into a status update actually depends on.
 */
describe("renderMarkdown", () => {
  it("keeps a multi-paragraph body inside its list item", () => {
    const md = renderMarkdown(
      report({
        decisions: [
          entry({
            body: "Chose Postgres FTS.\n\nEmbeddings lost on cost.",
          }),
        ],
      }),
      t,
    );

    const lines = md.split("\n");
    const at = lines.findIndex((l) => l.startsWith("- **Ship the report**"));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at]).toBe("- **Ship the report** — Chose Postgres FTS.");
    // The blank line stays blank: two spaces here is trailing whitespace, and
    // an editor stripping it on save would look like a change nobody made.
    expect(lines[at + 1]).toBe("");
    expect(lines[at + 2]).toBe("  Embeddings lost on cost.");
  });

  it("does not let a body's own markup escape into the report's structure", () => {
    const md = renderMarkdown(
      report({
        dead_ends: [
          entry({ body: "Tried the hook.\n\n## Not a heading\n\n- not a top-level item" }),
          entry({ task: "Second task", body: "still a list item" }),
        ],
      }),
      t,
    );

    const lines = md.split("\n");
    // A `##` at column zero would become a heading and split the section in
    // two; indented, it is text inside the item that carries it.
    expect(lines).not.toContain("## Not a heading");
    expect(lines).toContain("  ## Not a heading");
    expect(lines).toContain("  - not a top-level item");
    // And the section is still one list: the item after the long body is there.
    expect(lines).toContain("- **Second task** — still a list item");
  });

  it("marks a summarised body as cut", () => {
    const md = renderMarkdown(
      report({ open_questions: [entry({ body: "Which carrier", truncated: true })] }),
      t,
    );

    expect(md).toContain("- **Ship the report** — Which carrier…");
  });

  it("indents the bodies listed under a completed task too", () => {
    const md = renderMarkdown(
      report({
        completed: [
          {
            id: 7,
            title: "Ship the report",
            body: null,
            project_slug: "todox",
            project_name: "todox",
            status: "done",
            priority: 2,
            importance: "normal",
            created_at: "2026-09-01T09:00:00.000Z",
            models: [],
            authors: [],
            entry_counts: { note: 0, decision: 1, dead_end: 0, question: 0, handoff: 0 },
            decisions: ["Cut the body.\n\nThe entry is one click away."],
            dead_ends: [],
            open_questions: [],
            last_handoff: null,
            started_at: "2026-09-01T10:00:00.000Z",
            closed_at: "2026-09-03T10:00:00.000Z",
            lead_ms: 0,
            active_ms: 0,
            partial: false,
            active_ms_in_period: 0,
          },
        ],
      }),
      t,
    );

    const lines = md.split("\n");
    expect(lines).toContain("- Cut the body.");
    expect(lines).toContain("  The entry is one click away.");
  });
});
