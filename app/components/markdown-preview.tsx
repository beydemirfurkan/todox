import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";

function EntryHeading({ children }: { children?: ReactNode }) {
  return <h4>{children}</h4>;
}

export function MarkdownPreview({
  markdown,
  variant = "report",
}: {
  markdown: string;
  variant?: "report" | "entry";
}) {
  return (
    <div className={variant === "report" ? "report-markdown" : "entry-markdown"}>
      <ReactMarkdown
        skipHtml
        components={{
          // Reports can contain agent-written Markdown. Do not turn an image
          // URL in a task body into an unexpected third-party request.
          img: () => null,
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer">
              {children}
            </a>
          ),
          ...(variant === "entry"
            ? { h1: EntryHeading, h2: EntryHeading, h3: EntryHeading }
            : {}),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
