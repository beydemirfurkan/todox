import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExpandableText } from "./expandable-text";

const render = (text: string) =>
  renderToStaticMarkup(<ExpandableText text={text} more="show more" less="show less" />);

describe("ExpandableText", () => {
  it("leaves a short note as a plain paragraph", () => {
    const html = render("Chose Postgres FTS.");

    expect(html).not.toContain("<details");
    expect(html).not.toContain("show more");
    // Still the two classes every render of written text needs.
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("break-words");
  });

  it("gives a long note a control that reveals the rest", () => {
    const html = render("word ".repeat(120));

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("show more");
    expect(html).toContain("show less");
    // The clamp and the class that lifts it have to travel together: either
    // one alone is a note that cannot be read in full.
    expect(html).toContain("line-clamp-4");
    expect(html).toContain("group-open:line-clamp-none");
  });

  it("counts lines, not just characters", () => {
    // Five short lines is under any character threshold and still taller than
    // a four-line clamp.
    const html = render(["one", "two", "three", "four", "five"].join("\n"));

    expect(html).toContain("<details");
  });

  it("puts the control after the text it reveals", () => {
    // `<summary>` must be the first child for the parser, so the order is a
    // layout concern -- without `order-2` the control reads before the note.
    const html = render("word ".repeat(120));

    expect(html.indexOf("<summary")).toBeLessThan(html.indexOf("<p"));
    expect(html).toContain("order-2");
  });
});
