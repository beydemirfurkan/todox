import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Group } from "./group";

/**
 * The project page is six of these, and what makes the page as long as what
 * is open is markup: which groups carry `open`, and that the heading and the
 * details are wired to each other so a screen reader names the group it lands
 * on. Both are assertable without a browser.
 */
const render = (props: Partial<Parameters<typeof Group>[0]> = {}) =>
  renderToStaticMarkup(
    <Group id="in-flight" title="In flight" count={9} countLabel="tasks" {...props}>
      <p>body</p>
    </Group>,
  );

describe("Group", () => {
  it("is folded unless told otherwise", () => {
    expect(render()).toMatch(/<details[^>]*>/);
    expect(render()).not.toMatch(/<details[^>]* open/);
  });

  it("opens when asked, as markup rather than script", () => {
    expect(render({ open: true })).toMatch(/<details[^>]* open/);
  });

  it("labels the details with its own heading", () => {
    const html = render();
    expect(html).toContain('aria-labelledby="in-flight"');
    expect(html).toMatch(/<h2[^>]*id="in-flight"[^>]*>In flight<\/h2>/);
  });

  it("puts the heading and the count in the summary, the children below it", () => {
    const html = render();
    const summary = html.indexOf("<summary");
    const summaryEnd = html.indexOf("</summary>");
    expect(html.indexOf("<h2")).toBeGreaterThan(summary);
    expect(html.indexOf("tasks")).toBeGreaterThan(summary);
    expect(html.indexOf("tasks")).toBeLessThan(summaryEnd);
    expect(html.indexOf("<p>body</p>")).toBeGreaterThan(summaryEnd);
  });

  it("carries a fact beside the count when given one", () => {
    expect(render({ right: <span>1 stuck</span> })).toContain("1 stuck");
  });

  it("keeps the action outside the details, and out of the summary", () => {
    // A button in a summary is nested interactive content; Safari toggles
    // the group instead of pressing it. The "+" is drawn over the header
    // but is a sibling of the details.
    const html = render({ action: <button type="button">+</button> });
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf("</details>"));
    expect(html).toMatch(/<summary[^>]*pr-14/);
  });
});
