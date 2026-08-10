---
name: i18n-strings
description: Use when adding, changing or removing any user-facing string in todox, or when a component needs a label. Covers the two-dictionary rule, placeholder parity, and why the translator cannot cross into a client component.
---

# Strings

Every visible string comes from `lib/i18n/`. There is no library and no
`next-intl`: a cookie, a lookup table, and a function.

## The two dictionaries

- `lib/i18n/en.ts` is the source. Its keys are the type `Key`.
- `lib/i18n/tr.ts` is `Record<Key, string>`, so **a missing translation fails
  the build.** Add to both, in the same commit.
- **Turkish is the default language** (`DEFAULT_LANG` in `lib/i18n/index.ts`)
  and this is a Turkish developer's tool first. Write the Turkish properly —
  full orthography, real diacritics. Do not machine-translate it.
- Keep a new key next to the ones it belongs with; both files are grouped by
  area (`/* chrome */`, `/* auth */`, …) and in the same order.

## Placeholders

`translator()` substitutes `{name}` from a `vars` object:

```ts
t("minutesAgo", { n: 5 })   // "5m ago" / "5dk önce"
```

The type system guarantees the *key* exists in both languages. It says nothing
about what is inside it, so a translation that drops `{n}` loses the number
silently. `lib/i18n/index.test.ts` asserts placeholder parity — if you add a key
with a placeholder, that test already covers it.

## `t` cannot enter a client component

`getT()` (`lib/lang.ts`) reads the cookie through `next/headers`, so it is
server-only, and `t` is a function — functions are not serialisable across the
boundary. Passing it to a `"use client"` component is a runtime error, not a
compile error.

**Translate on the server, pass strings as props.** The pattern is everywhere:

- `app/features/auth-form.tsx` — takes `submitLabel`, `successLabel`, a
  pre-translated `messages` record.
- `app/features/token-form.tsx`, `app/features/lang-button.tsx` — same.

Server components call `const { t } = await getT()` directly.

## Where the language comes from

Cookie `todox_lang` → `getLang()` → `translator(lang)`. It is set by
`setLangAction` in `app/actions.ts`, which writes the cookie and calls
`revalidatePath("/", "layout")`. The cookie is `httpOnly`; nothing on the client
reads it, and nothing should start.

## Related

- Status, kind and priority labels: `app/kinds.ts`.
- Relative time and durations: `ago()` / `duration()` in `lib/i18n/index.ts`.
- Report markdown is rendered with a translator too — `mcp/server.ts` passes
  `lang` through for `activity_report`.
- **Colour never carries meaning alone**: every badge and status needs a text
  equivalent. See [CONTRIBUTING.md](../../../CONTRIBUTING.md).
