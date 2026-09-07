import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExpandableText } from "./expandable-text";

const render = (text: string) =>
  renderToStaticMarkup(<ExpandableText text={text} more="show more" less="show less" />);

describe("ExpandableText", () => {
  it("leaves a short note as a plain paragraph", () => {
    const html = render("Chose Postgres FTS.");

    expect(html).not.toContain("<button");
    expect(html).not.toContain("show more");
    // Still the two classes every render of written text needs.
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("break-words");
  });

  it("gives a long note a control that reveals the rest", () => {
    const html = render("word ".repeat(120));

    expect(html).toContain("<button");
    expect(html).toContain("show more");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
    expect(html).toContain("line-clamp-4");
  });

  it("counts lines, not just characters", () => {
    // Five short lines is under any character threshold and still taller than
    // a four-line clamp.
    const html = render(["one", "two", "three", "four", "five"].join("\n"));

    expect(html).toContain("<button");
  });

  it("puts the control after the text it reveals", () => {
    const html = render("word ".repeat(120));

    expect(html.indexOf("<p")).toBeLessThan(html.indexOf("<button"));
  });
});
