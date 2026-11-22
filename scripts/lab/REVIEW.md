# How a persona reviews todox

Every `persona-*` agent in `.claude/agents/` follows this. The agent file says
who you are; this file says what to look at and what to hand back.

## What you have

- **Your sessions.** `~/todox-lab/runs/<run>/<you>-s{1,2,3}/`:
  - `meta.json`: the prompt, the agent, the model and the duration;
  - `transcript.jsonl`: the agent's whole event stream, every tool call with
    its input and output;
  - `diff.patch` and `diffstat.txt`: what changed in the code;
  - `state.json`: everything your todox account held when the session ended.
- **The scores.** `~/todox-lab/runs/<run>/scores.md` and `scores.json`, from
  `scripts/lab/score.ts`. The column meanings are in that file's header
  comment.
- **Your repositories.** `~/todox-lab/<you>/<project>/`, with `git log`.
- **The web app**, signed in as yourself. Open `http://localhost:3123` with the
  Playwright tools; your username is `lab-<you>` and your password is
  `lab-<you>-password`. Other reviewers share the same browser at the same
  time, so never drive the shared page: do all browsing in one
  `browser_run_code_unsafe` call that opens its own context with
  `page.context().browser().newContext({ viewport })`, signs in, screenshots and
  closes the context at the end.
- **What the product promises.** `README.md`, `docs/mcp.md` and the landing
  page at `/`.

Read only. Do not edit anything in this repository except your own review
file. Do not change your todox data. Do not run the agents again.

## How to work

1. Read your three `meta.json` files: what you asked for, in which order.
2. Read each transcript in order. Follow the todox calls in particular:
   - what the briefing returned;
   - what the agent chose to write;
   - what it was refused;
   - what the next session made of it.
   Quote real lines.
3. Look at your account in the web app the way you actually would (your agent
   file says how). Take screenshots into
   `docs/dogfood/<run>/shots/<you>-*.png`.
4. Judge it as yourself, against your own priorities, not as a QA checklist.
   Things you would not notice are not findings.

## What you hand back

Write `docs/dogfood/<run>/<you>.md`, in your own language (the agent file
says which). Use these sections:

```
# <Name>: <one-line verdict>

## Who I am and what I tried
Three sentences at most.

## What worked
Each point with its evidence: run/session, transcript line or screenshot.

## What got in my way
Each point with its evidence. Mark severity: blocker / painful / annoying.

## What is missing
Things I expected and did not find. Say why I expected them.

## Would I keep using it?
Yes / no / not yet, and the one change that would flip a "no".

## Findings
A table: id (<you>-1, <you>-2…), title, severity, area
(agent behaviour / briefing / tools / web UI / docs / onboarding / privacy),
evidence, suggested fix.
```

Your final message is a five-line summary: the verdict, then your top three
findings with their ids.

## Rules that keep the review honest

- **Evidence or it did not happen.** Every claim needs a path and a line, a
  quoted output or a screenshot.
- **Separate the product from the model.** Some failures are the agent model
  being careless, not todox. Say which you think it is, and why. If better
  tool descriptions or server instructions would have prevented it, that is a
  todox finding.
- **No invented praise and no invented complaints.** "Nothing to report" is a
  valid section.
- **Do not leak.** Never paste a token, or anything from `.secrets/`.
