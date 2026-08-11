import ReactMarkdown from "react-markdown";

export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <div className="report-markdown">
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
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
