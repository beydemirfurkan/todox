---
name: todox
description: Persistent working memory for this developer's projects over the todox MCP server. Use at the start of a session (get_context), whenever a decision, dead end, question or task worth keeping comes up, and before finishing (handoff). Says which tool to call when, and what to write.
---

<!-- Written by `pnpm install:mcp --write-skill`. The same text the todox
MCP server sends at initialize; re-run after upgrading. -->

todox is the persistent working memory for this developer's projects: what
was decided and why, what was tried and failed, what is still open, and where
the last session stopped. Written agent-to-agent, read by a human over the
shoulder. Not everything is worth keeping: an entry that restates the diff,
or a task for something you are finishing now, is noise the next session
reads past.

START: call get_context with `cwd` (absolute path). It resolves the project,
registers a new repo, and returns the standing rules, decisions, dead ends
and open tasks. Send `focus` -- one sentence on what this session is for --
so the budget is spent on relevant notes rather than the newest; a focus that
matches nothing changes nothing.

LOOK UP: search covers every project. Ask it in words -- the query is
parsed and ranked -- and quote a phrase to require it. kinds:['dead_end'] answers
'has this been tried?', kinds:['decision'] 'why is it like this?'.
BEFORE YOU EDIT A FILE: get_file_context(path) gives the tasks, dead ends and
notes attached to it -- the cheapest call here and the one most worth making.
DO NOT READ list_tasks status:'all' or activity_report period:'all': they
return everything ever, bodies included.

CAPTURE: create_task (pass `cwd`) for anything the developer mentions that
will not finish this session. Registering a NEW project needs `repo_root` or
`repo_url` -- a bare cwd is a directory, not a repository; the refusal names
what to send. Put the plan a task follows in `files`, wherever it lives;
todox warns when it moves on.

WHILE WORKING: update_task to move status -- 'doing' when you actually start,
that is what makes time reports real. log_entry for 'decision' (what and why
it beat the alternative), 'dead_end' (what failed and how -- the highest-value
entry there is), 'question' (something only the developer can settle that
you must leave open; say what you would do unanswered; never for what search
or the diff would answer). When you settle a question, log the answer with
answers_entry_id -- nothing else closes one. add_context for what outlives a
task: a convention, a gotcha, a standing preference; omit project and cwd to
make it account-wide.

WRITE SHORT. One entry says one thing. The briefing shows every entry's
FIRST LINE and pays for whole bodies only while a byte budget lasts, so the
first line is a headline and the body is a screen at most. Measurements,
listings and options nobody chose go in the task body or a note, not the
log. A handoff nobody finishes reading is the failure mode, not a short one.

OBSERVATIONS: a briefing MAY carry `observations` -- what a process saw git
do while an earlier session ran. Evidence, never intent: do not repeat one
to the developer as a recorded decision. Worth keeping? Write the real
record with from_observation_id; otherwise it expires. `handoff_missing`
names tasks that session set 'doing' and never wrote up: continue or reset
them.

Pass `model` (your model id) on create_task, update_task, log_entry; it is
stored on the row so reports can say which model did what.

BEFORE YOU FINISH: call session_status(cwd). It names the tasks you touched
this session and what each still lacks; work through it, in this order:
1. update_task: every task you touched shows its true status. One set to
   'doing' and not finished goes back to 'todo' or 'blocked' -- a task left
   'doing' by a session that ended is the log going stale.
2. log_entry(kind:'dead_end') for each approach that failed, if not logged
   yet.
3. log_entry(kind:'handoff') on every task you touched -- state, next step,
   what to watch -- enough for a fresh session to continue without asking.
Not finished until all three are done.

A REFUSED WRITE names what is missing: send it and retry once. Refused twice
with the same message, stop -- do not reword the call -- and tell the
developer what was refused and why.

REPORTING: activity_report answers 'what got done today / this week' from the
log, with durations and models; format:'markdown' for something to hand on.
