# Jonas: three sessions, zero bytes of memory. It costs little and gave me nothing.

## Who I am and what I tried
I maintain `tidyfs` and self-host todox over stdio. s1: fix issue #12, the symlink-loop hang, with a test. s2: add `--json`, and first remind me in two lines why the s1 fix works. s3: show me what todox recorded about tidyfs and delete the noise.

## What worked
- **The fixes were fine.** s1 used a `realpath` seen-set plus an `ELOOP`/`ENOENT` skip, with a regression test, and the tests pass 2/2 (`jonas-s1/diff.patch`, transcript line 23). s2's `--json` works (`jonas-s2/diff.patch`). That is the model's work, not todox's.
- **Low overhead.** todox calls per session: 3 of 11, 2 of 10, 5 of 5. Tool results came to 3.4 KB, 32 B and 1.5 KB. The server instructions add about 4.8 KB to every system prompt (`mcp/tools.ts` lines 57-137). Each session cost $0.06-0.08 in total. todox's share of that is small. It is still not zero, and it bought nothing.
- **Refusals were cheap.** s1 first called `get_context({})` because the schema was deferred. The error named the fix, "pass either `project` or `cwd`" (s1 line 3), and the retry worked.
- **s3 was honest.** "Nothing to clean up, because todox has recorded nothing about tidyfs." It also refused to delete the empty project: "deleting something that is harmless and empty isn't cleanup" (s3 line 14). Correct.
- **Self-hosting is covered.** `docker-compose.yml` runs with no public DB port, the migration is a separate step, and the README explains why. The stdio client defaults to `http://localhost:3000`, not todox.dev (`mcp/rpc-client.ts:61`), so a missing env var cannot send my data to someone else's server. Good default.
- **`docs/mcp.md` is the best privacy text I have read in a dev tool this year.** Observation fields are listed and the plugin hooks are tabulated. The server counter is "a method name, how many calls, how many were refused … no parameters, no bodies, no paths". The off-switch is one env var.

## What got in my way
- **blocker: the "why" of the symlink fix was never recorded, and the protocol made that the right call.** s1 closed with "I didn't log a todox task, since this was finished in the session." (s1 line 26). The server instructions call "a task for something you are finishing now" noise (`mcp/tools.ts:61-62`). `log_entry` requires `task_id` (`lib/services/rpc-schemas.ts:363`). So a decision made on work finished in-session has nowhere to go. `session_status` then returned `"yours": [], "hint": ""` (s1 line 25) and asked for nothing. Most of my sessions are a two-minute fix, so todox has no slot for most of what I do.
- **blocker: s2 got its recall from git, not from todox.** `search("symlink loop walk")` returned `[]` (s2 line 14). The explanation came from `git show HEAD -- src/walk.js` (s2 line 11). Worse, the two-line reminder I asked for only appears in a thinking block (s2 line 31) and never reached me: the final answer is only about `--json` (s2 line 44). That last part is the model's fault. The empty search is todox's.
- **painful: s2 never called `get_context`.** It loaded the schema through ToolSearch (s2 line 6) and then skipped it. That is mostly the model. But the lab starts Claude Code with no user CLAUDE.md (`scripts/lab/run.ts`, `--setting-sources project`), so the server instructions are the only nudge, and here they were not enough.
- **painful: the stdio observer missed a session that left two dirty files.** `docs/mcp.md` says observations exist for "the session that ends without a handoff". s1 was exactly that: 17 s long, `src/walk.js` and `test/walk.test.js` modified. `state.json` still shows `"observations": 0` after every session. The reason is `THROTTLE_MS = 60_000` (`mcp/observer.ts:51`). The first look came at `get_context`, when the tree was still clean. `session_status` came about 10 s later, inside the interval, and was skipped. There is no flush on exit (no `process.on` in `mcp/observer.ts` or `mcp/server.ts`). Any session shorter than a minute is invisible.
- **annoying: the briefing is all nags.** A first-run briefing carrying no data was 2.9 KB of hints (scores.md). They asked for a project summary, a profile note, a `~/.claude/CLAUDE.md` snippet, and a `.mcp.json` note for "a teammate" (s1 line 8). I have no teammate. s3 got the same block word for word (s3 line 6).
- **annoying: `list_projects` hides the one project I have.** It returned `"projects": [], "empty_projects_omitted": 1` (s3 line 13), and the agent had to guess the omitted project was tidyfs.

## What is missing
- **A list of everything the stdio process sends on normal tool calls.** `docs/mcp.md` lists the observation fields. It does not say that every `get_context` sends my absolute `cwd`, or that the server keeps it. The web app shows it back: "on this machine: /Users/…/todox-lab/jonas/tidyfs" (`shots/jonas-tidyfs.png`). That is my home directory name on the server. Fine on my own box, but it belongs in the promise. `/privacy` covers the hosted instance (Hostinger, Resend) and does not mention paths, remotes or observations at all (`shots/jonas-privacy.png`).
- **A place for a decision without a task.** I expected `log_entry(kind:'decision')` to work on a project, because the instructions present it as the way to record "why it is this way".
- **A pinned install in the docs.** The documented stdio config is `npx -y …/releases/latest/download/todox-mcp.tgz` (README, "Optional: local mode"). That runs whatever is newest, at every session start. A self-hoster pins. The versioned tarball is mentioned, but the example should use it.

## Better than a CLAUDE.md?
No, not on this evidence. Three sessions put zero entries, tasks, notes or observations into todox (`jonas-s{1,2,3}/state.json`). The one recall question was answered by `git show`. A one-line commit body, "walk: dedupe dirs by realpath so link loops terminate; skip ELOOP/ENOENT", would have answered s2 in one `git log` call. The lab commits read "Session 1", which is a harness artefact. The README's real arguments for todox (two machines, several agents, shared projects) do not apply to one maintainer on one laptop with one agent.

## The web app
I opened it once. Dashboard: four zeros and "Nothing in flight in any project" (`shots/jonas-home.png`). Project page: an empty kanban (`shots/jonas-tidyfs.png`). It is honest and clean. I would not open it again; there is nothing in it, and I read my logs in a terminal anyway.

## Would I keep using it?
No. One change would flip that: give in-session work somewhere to put its "why". Let `log_entry(kind:'decision'|'dead_end')` take a project, or a file through `link_files`, instead of a task. Have `session_status` in local mode look at the dirty tree and ask "you changed src/walk.js; any decision or dead end worth one line?" before it says nothing. Until then it is a dependency with an empty table behind it.

## Findings

| id | title | severity | area | evidence | suggested fix |
|---|---|---|---|---|---|
| jonas-1 | Work finished in-session has nowhere to put its "why"; the protocol tells the agent to write nothing | blocker | tools | s1 line 26 "I didn't log a todox task, since this was finished in the session"; `rpc-schemas.ts:363` `task_id` required; `tools.ts:61-62` | Allow project- or file-scoped `decision`/`dead_end` entries; reword the noise line so it does not discourage decisions |
| jonas-2 | `session_status` is silent on a session that changed files but touched no task | blocker | briefing | s1 line 25 `"yours": [], "hint": ""` with 2 dirty files | In stdio mode, use the workspace's dirty or committed files to ask for one decision/dead end, or to state explicitly that nothing is needed |
| jonas-3 | Recall in s2 came from git; todox search returned `[]` | painful | agent behaviour | s2 lines 11, 14 | Follows from jonas-1; nothing to recall |
| jonas-4 | Observer misses any session under 60 s and never flushes on exit | painful | tools | `observer.ts:51` `THROTTLE_MS`; s1 17 s, dirty tree, `observations: 0` in all `state.json` | Always look on `session_status` and on stdin close / SIGTERM; throttle only repeated writes |
| jonas-5 | s2 skipped `get_context` after loading it; reminder only in thinking, never shown | painful | agent behaviour | s2 lines 6, 31, 44 | Model issue mostly; consider a `get_context` tool description that says "call first, even if you plan to search" |
| jonas-6 | Empty briefing is 2.9 KB of setup nags, repeated every session | annoying | briefing | s1 line 8, s3 line 6; scores.md "brief KB 2.9" | Show each setup hint once per project, or only when the client is unknown; drop the teammate `.mcp.json` hint for single-member projects |
| jonas-7 | Privacy promise omits that absolute `cwd`/`root_path` and the repo URL are stored | annoying | privacy | `docs/mcp.md` has no such line; `shots/jonas-tidyfs.png` shows the local path; `/privacy` omits it | Add a "what every tool call sends" table to `docs/mcp.md` and a line to `/privacy` |
| jonas-8 | Documented stdio install runs the unpinned `latest` tarball at every start | annoying | docs | README "Optional: local mode" `npx -y …/latest/…` | Show the `todox-mcp-<version>.tgz` form first; mention `latest` second |
| jonas-9 | `list_projects` returns `[]` and omits the user's only project | annoying | tools | s3 line 13 `"empty_projects_omitted": 1` | Do not omit when that leaves the list empty, or name the omitted slugs |
