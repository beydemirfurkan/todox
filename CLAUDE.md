@AGENTS.md
@CONTRIBUTING.md

The rules in CONTRIBUTING.md are not style preferences — breaking them causes
bugs that are hard to see in review. They apply before you change anything here.

`.claude/skills/` carries the flows that span several files and go wrong
quietly:

- `add-rpc-method` — a new agent capability, and the six files it touches
- `i18n-strings` — the two dictionaries, and why `t` cannot cross into a client
  component
- `db-change` — the SQL rules, two of which exist because of a real injection
- `ui-conventions` — the CSS helpers, and the mobile rules each bug taught us
