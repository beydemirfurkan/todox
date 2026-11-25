import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translator } from "@/lib/i18n";
import type { Context } from "@/lib/types";

vi.mock("../features/submit", () => ({
  SubmitButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

const { NoteGroups } = await import("./note-list");

/**
 * Pinning is offered where it would be accepted, and where it would not the row
 * says why: a button the server refuses, with nothing on the page to show for
 * it, reads as a button that is broken.
 */
const t = translator("en");
const action = async (): Promise<void> => {};
const note = (id: number, over: Partial<Context> = {}): Context => ({
  id,
  user_id: 7,
  project_id: 1,
  kind: "convention",
  title: `Note ${id}`,
  body: "short",
  is_public: false,
  is_pinned: false,
  created_at: "2026-11-24T00:00:00Z",
  updated_at: "2026-11-24T00:00:00Z",
  ...over,
});
const render = (notes: Context[], mayPin = true): string =>
  renderToStaticMarkup(
    <NoteGroups notes={notes} t={t} actions={{ remove: action, update: action, pin: mayPin ? action : undefined }} />,
  );

describe("pinning a note", () => {
  it("is offered on a short one", () => {
    expect(render([note(1)])).toContain(t("pinNote"));
  });

  it("is not offered to somebody who may not pin, who still sees what is pinned", () => {
    const html = render([note(1, { is_pinned: true })], false);
    expect(html).toContain(t("pinned"));
    expect(html).not.toContain(t("unpinNote"));
  });

  it("can be undone when three are, and says so on the fourth", () => {
    const html = render([1, 2, 3].map((id) => note(id, { is_pinned: true })).concat(note(4)));
    expect(html.split(t("unpinNote"))).toHaveLength(4);
    expect(html).toContain(t("pinFull", { n: 3 }));
    expect(html).not.toContain(t("pinNote"));
  });

  it("says a long note is too long", () => {
    expect(render([note(1, { body: "x".repeat(501) })])).toContain(t("pinTooLong", { n: 500 }));
  });

  it("says nothing on a note every session is shown anyway", () => {
    const html = render([note(1, { project_id: null, kind: "profile" })]);
    expect(html).not.toContain(t("pinNote"));
    expect(html).not.toContain("always");
  });

  it("holds an edit of a pinned note to the limit", () => {
    const limited = /<textarea[^>]*maxlength="500"/i;
    expect(render([note(1, { is_pinned: true })])).toMatch(limited);
    expect(render([note(1)])).not.toMatch(limited);
  });
});
