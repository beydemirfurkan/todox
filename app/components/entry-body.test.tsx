import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntryBody, entryExcerpt } from "./entry-body";

const render = (body: string) =>
  renderToStaticMarkup(<EntryBody body={body} more="show more" less="show less" />);

describe("entryExcerpt", () => {
  it("leaves a short entry untouched", () => {
    expect(entryExcerpt("Short and useful.")).toBe("Short and useful.");
  });

  it("cuts long text at a word boundary", () => {
    const excerpt = entryExcerpt("word ".repeat(140));

    expect(excerpt.length).toBeLessThanOrEqual(481);
    expect(excerpt).toMatch(/word…$/);
  });

  it("caps a record made from many short lines", () => {
    const excerpt = entryExcerpt(
      ["one", "two", "three", "four", "five", "six", "seven"].join("\n"),
    );

    expect(excerpt).toBe("one\ntwo\nthree\nfour\nfive\nsix…");
  });
});

describe("EntryBody", () => {
  it("keeps the headline visible and renders Markdown structure", () => {
    const html = render("DECISION\n\n- keep **one** path\n- run `pnpm test`");

    expect(html).toContain("<h3");
    expect(html).toContain("DECISION");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>one</strong>");
    expect(html).toContain("<code>pnpm test</code>");
    expect(html).not.toContain("show more");
  });

  it("shows a compact preview for a long record", () => {
    const body = `HANDOFF\n\n${"working context ".repeat(80)}FINAL SENTINEL`;
    const html = render(body);

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("show more");
    expect(html).not.toContain("FINAL SENTINEL");
  });

  it("does not execute HTML or load remote images", () => {
    const html = render("<script>alert('no')</script>\n\n![tracking](https://example.com/pixel.png)");

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
});
