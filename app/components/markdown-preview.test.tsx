import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownPreview } from "./markdown-preview";

describe("MarkdownPreview", () => {
  it("renders report structure without rendering active HTML or remote images", () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview
        markdown={[
          "# Report",
          "",
          "- **finished** with `model/id`",
          "",
          "<script>alert('no')</script>",
          "",
          "![tracking](https://example.com/pixel.png)",
          "",
          "[unsafe](javascript:alert('no'))",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h1>Report</h1>");
    expect(html).toContain("<strong>finished</strong>");
    expect(html).toContain("<code>model/id</code>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
  });

  it("uses the compact entry treatment without changing report styling", () => {
    const entry = renderToStaticMarkup(
      <MarkdownPreview markdown={"# Nested heading\n\nA short note"} variant="entry" />,
    );
    const report = renderToStaticMarkup(<MarkdownPreview markdown="A report" />);

    expect(entry).toContain('class="entry-markdown"');
    expect(entry).toContain("<h4>Nested heading</h4>");
    expect(entry).not.toContain("<h1>");
    expect(report).toContain('class="report-markdown"');
  });
});
