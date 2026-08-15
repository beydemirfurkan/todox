## Summary

<!-- One or two sentences: what was done, and why it needed doing. -->

## Type

<!-- Feature | Bug | Refactor | Chore | Docs | Test -->

## Changes

<!-- One line per file or area: what changed, and why. The diff already shows what. -->

-

## Acceptance Criteria

- [ ]

## Testing

<!-- Which commands, and what came back. "Ran the tests" is not an answer. -->

```
pnpm lint
pnpm test
pnpm build
pnpm exec tsc --noEmit
```

## Checks

- [ ] **Two-source rule.** If this touched the domain rules, the "Domain rules"
      section of `AGENTS.md` and "The rules the codebase actually follows" in
      `CONTRIBUTING.md` say the same thing. The duplication is deliberate —
      Codex and Cursor do not follow a cross-file reference — so a change to
      one is a change to the other.
- [ ] **Both dictionaries.** Every new user-facing string is in `lib/i18n/en.ts`
      *and* `lib/i18n/tr.ts`, with the placeholders matching. Turkish is the
      default language; it is written, not machine-translated.
- [ ] **The agent surface is defined once.** A new or changed tool went through
      `mcp/tools.ts` and `pnpm smoke:mcp` was run against a live server — it is
      the only thing that proves a tool works through *both* transports, and
      the only job that starts the stdio process at all.
- [ ] **SQL.** No `?` inside a string literal, no hand-built `SET` clause
      (`setClause` with its allow-list), and writes that must agree share one
      `tx()`. Two of those rules exist because of a live injection.
- [ ] **Ownership.** Checked in `lib/services/ownership.ts`, not inlined at the
      call site. A row belonging to somebody else answers 404.

## Notes

<!-- Trade-offs, debt to revisit, known limits. "None" if empty. -->
