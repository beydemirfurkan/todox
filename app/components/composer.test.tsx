import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Composer } from "./composer";

/**
 * The trigger and the form are wired by id and nothing else: no script
 * opens this. The wiring is what a test can hold.
 */
describe("Composer", () => {
  const html = renderToStaticMarkup(
    <Composer id="new-note" label="New note" action={async () => {}}>
      <input name="title" autoFocus />
    </Composer>,
  );

  it("targets the popover from the trigger", () => {
    // React writes the attribute camel-cased; HTML attribute names are
    // case-insensitive, so the browser reads it as `popovertarget`.
    expect(html).toMatch(/<button[^>]*popover[tT]arget="new-note"/);
    expect(html).toMatch(/<div[^>]*id="new-note"[^>]*popover="auto"/);
  });

  it("names the glyph for a screen reader and hides the glyph itself", () => {
    expect(html).toMatch(/<button[^>]*aria-label="New note"/);
    expect(html).toContain('<span aria-hidden="true">+</span>');
  });

  it("puts the fields in a form inside the popover, not in the trigger", () => {
    expect(html.indexOf("<form")).toBeGreaterThan(html.indexOf("</button>"));
    expect(html).toMatch(/<form[^>]*>.*<input[^>]*autofocus/);
  });
});
