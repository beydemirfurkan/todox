const BODY = `# todox

> Working memory for developers and their coding agents. Projects, tasks, and the log that survives every session.

todox is a small, opinionated workspace for a developer and the agents they work with. It keeps a project, the tasks inside it, and a running log of what each session did — so the next session, human or agent, can pick up where the last one left off.

## What it is

- A project per repository, with the tasks you are working on and the log entries that explain what happened to them.
- A live log per task: doing, blocked, done. Each change is a row, not an edit, so the history is the source of truth.
- A daily and weekly activity report written for whoever is starting their day — the developer or the agent they are about to hand off to.
- An MCP server (/api/mcp) that exposes the same surface to coding agents. The hosted endpoint and the stdio process share one tool list.

## What it is not

- A kanban board. There is no swimlane, no sprint, no Gantt.
- A team chat. Comments live next to the change they describe.
- A wiki. Notes are short and dated.

## Public pages

- https://www.todox.dev/ — landing page and, when signed in, the dashboard with all projects.
- https://www.todox.dev/login — sign in.
- https://www.todox.dev/register — create an account.
- https://www.todox.dev/forgot — request a password-reset link.

Authenticated routes (/p/*, /account, /report, /search) are not listed here. Without a session cookie they redirect to /login, so a link into one will not show you anything.

/s/<token> is the exception and is deliberately public: it is an unlisted read-only snapshot of one project, shown to anybody holding the link. It is noindex, and the token is the only thing protecting it.

## Agent surface

- HTTP MCP endpoint: https://www.todox.dev/api/mcp (Streamable HTTP, bearer token).
- stdio MCP: pnpm mcp in the repository, configured to talk to the hosted endpoint.
- Tools: see mcp/tools.ts in the repository. The hosted endpoint and the stdio process expose the same set; the only difference is where the filesystem questions are answered.

## Open source

- Repository: https://github.com/beydemirfurkan/todox
- License: MIT
- Language: English and Turkish. The page you get is negotiated from Accept-Language; send none and you get English (DEFAULT_LANG in lib/i18n/index.ts). ?lang=en and ?lang=tr set the preference and redirect to the clean URL, so there is one address per page rather than one per language.

## Contact

- Issues: https://github.com/beydemirfurkan/todox/issues
- Security: see SECURITY.md in the repository.
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
