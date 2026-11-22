---
name: ui-conventions
description: Use when writing or changing any UI in todox — a page, a component, Tailwind classes, or CSS. Covers the helpers to reach for before inventing one, and the layout rules that keep the app usable on a phone.
---

# UI conventions

Tailwind v4, CSS-first: there is no `tailwind.config`. Tokens and helpers live
in `app/globals.css` under `@theme inline`.

## Reach for what exists first

| Helper | For |
| --- | --- |
| `.sticker` / `.paper` / `.sticker-flat` | the card surface (one step up from the page, hairline edge, no shadow), and the quieter well inside it |
| `.btn` / `.btn-quiet` | the filled capsule (the action), and its outline twin (the second action) |
| `.pill` | nav, report period and language pills |
| `.link-more` | the underlined text button |
| `.lift` | hover response on a whole card (a brightness step, never a raise) |
| `.pop` | entry animation, staggered with an inline `animationDelay` |
| `.row-action` | an action that appears on hover **and on touch** |
| `.searchbox` | the search field frame |
| `.on-fill` | dark text on a bright fill |
| `.display` / `.mono` | Geist set heavy and tight for headings; DM Mono for ids, paths, counts and anything a terminal would print |
| `.marker` | the one phrase of a heading in orange |
| `.callout` | a notice that needs a look but is not an error: amber wash and edge, with `IconTile name="alert"` |
| `.tone-panel` + `.tone-mint` / `-butter` / `-sky` / `-apricot` / `-lilac` / `-sand` | a dark-tinted surface behind a drawing of the product (the landing only) |
| `.frame` | a drawing of a screen set into a panel |
| `.site-band` (+ `.band-link`, `.band-label`) | the band every page ends on |
| `.board-col` + `data-drop-status` | a board column (a neutral well, its status as a rule along the top) and a drop target |
| `.stat-badge` | one number as a pill; `StatBadges` lays a row of them out |
| `.prose` | 68ch measure for body copy |

The page backdrop is `public/backdrop.svg`: faint line icons of the trade on
a 480px tile, faded out down the page in `body`. It is an XML file, so its
comment may not contain a double hyphen -- one did, and the file silently
stopped drawing. Check it with `xmllint --noout public/backdrop.svg`.

Components: `app/components/` via the barrel `app/components/index.ts` --
`Panel`, `Empty`, `Chip`, `Counter`, `Field`, `StatusDot`, `StatBadges` (a row
of numbers as badges: dot, mono figure, word), `IconTile` (a line icon on an inset tile,
where a picture helps an empty state or a notice) and `LogoMark` (the prompt
tile; brand only). `BrainMap` draws the developer and their projects as
plain server-side SVG: hidden from assistive tech and below `sm`, always
beside a list that says the same numbers in words -- the pattern for any
drawing of data here. `NoteGroups` takes `actions` (`remove`, `update`, and
`publish` for account-wide notes). Client-side pieces: `app/features/`. The board's
drag-and-drop is `app/p/[slug]/board-dnd.tsx`.

## The look, in six rules

A developer tool, dark only (task #811, 2026-11-22): near-black graphite,
surfaces one step up, hairlines instead of shadows, one orange.

- **Dark is the only theme.** There is no light palette and no
  `prefers-color-scheme` switch; `color-scheme: dark` and the viewport's
  `themeColor` tell the browser so. Mail is the exception and stays light, for
  the reason written above `BRAND` in `lib/services/mail-templates.ts`.
- **Nothing casts a shadow.** Every `--shadow*` token is `none`. A surface is
  told apart by its step in lightness and a 1px `--line` edge; a selected card
  by a 1px `--accent` ring.
- **Orange is the one accent, and it is two tokens.** `--accent` is a fill, a
  stroke, a focus ring; orange *text* is `--accent-ink` (`text-accentInk`); an
  error in words is `--danger-ink`.
- **Colour is a dot, never a fill behind text.** A status or kind is a `Chip`
  or a `StatusDot` with its word; a number in `StatBadges` has a dot beside
  its word. The `--tone-*` tints are for the landing's drawings, not for
  meaning, and colour never says anything alone.
- **Dense, then readable.** 14px titles on cards, `text-meta` mono for ids and
  times, headings in `.display` without `font-bold` (the class sets the
  weight). A number a person scans for is a badge in `StatBadges`, never a big
  tile: a summary costs one line of the screen.
- **The panel is for people.** Agents never look at it. Every state a person
  needs to act on is visible without opening anything, and everything an
  agent can do to a task a person can do too -- the board's cards move by drag
  *and* by a menu of plain forms.

## Mobile rules

These are written down because every one of them was a bug on a real phone.

- **Every flex row that holds more than two controls needs `flex-wrap`.** The
  header, the panel header and the status rows each shipped without it and each
  made the page scroll sideways.
- **`flex-1` is a basis of zero**, so a box with `flex-1 min-w-0` will squeeze
  to one word per line rather than let the row wrap. If it should wrap, give it
  a real `min-w-[…]`. If it should not shrink, give the *siblings* `shrink-0`.
- **No bare fixed widths.** `w-[210px]` belongs behind `sm:`; on a phone use
  `w-full min-w-0` or `flex-1 min-w-0`.
- **Touch targets are 44px.** `.btn`, `.link-more` and `.pill` get `min-height`
  under `max-width: 640px` in `globals.css` — use those classes rather than
  restyling a control from scratch. `min-height` and not padding, because
  several call sites override padding with `!py-[3px]`.
- **Hover is not available.** Anything revealed on `:hover` must also be
  revealed under `(hover: none)`; `.row-action` already is.
- **Inputs are 16px on mobile.** Below that, iOS Safari zooms on focus and does
  not zoom back.
- **Long unbroken text breaks or truncates.** Paths, e-mails, tokens and model
  ids: `truncate` with a `title`, or `break-all`. Prose in a `<pre>` gets
  `break-words`, not `break-all`.
- `html, body { overflow-x: clip }` is in `globals.css` as a net for the entry
  animation's rotation. **It is not a licence to leave an overflow unfixed** —
  find the element and fix it there.

To check a page, at 320px and 390px:

```js
[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
```

It should be empty — with one exception, so nobody "fixes" a correct one.

A deliberately scrollable block (a code sample, a wide table) sits inside an
`overflow-x: auto` box, and the check reports its *content*, because the
content's own rectangle really does reach past the viewport. The box is what
has to stay inside it. When something shows up, measure the wrapper:

```js
const w = el.closest('[class*="overflow-x-auto"]') ?? el.parentElement;
w.getBoundingClientRect().right <= document.documentElement.clientWidth + 1  // in bounds
w.scrollWidth > w.clientWidth                                                // and scrolling
```

Both true means it is working as intended. Either one false is the bug.

## Contrast and the type floor

Two greys: `text-muted` is for sentences, `text-faint` for metadata (a
timestamp, an id, a path, a slug) — and nothing goes under `text-meta`
(12px). Sizes come from the scale (`text-meta`, `text-small`, `text-body`,
`text-lead`), not from `text-[11px]`. The dashboard once had a hundred and
twenty nodes at 11–13px in the metadata grey and read as texture.

To check a page, on the real thing (the tokens are runtime CSS variables, so
the dev server is the same):

```js
const ch=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number);return(c.startsWith('color(')?v:v.map(x=>x/255)).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4)}; // rgb() is 0-255, color(srgb) is 0-1
const lum=c=>{const[r,g,b]=ch(c);return .2126*r+.7152*g+.0722*b};
const okL=c=>{const[r,g,b]=ch(c);const l=.4122214708*r+.5363325363*g+.0514459929*b,m=.2119034982*r+.6806995451*g+.1073969566*b,s=.0883024619*r+.2817188376*g+.6299787005*b;return .2104542553*Math.cbrt(l)+.793617785*Math.cbrt(m)-.0040720468*Math.cbrt(s)};
const cr=(a,b)=>((Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)).toFixed(2);
const bg=e=>getComputedStyle(e).backgroundColor, paper=bg(document.body), card=bg(document.querySelector('.sticker')), row=bg(document.querySelector('.sticker-flat')||document.querySelector('.sticker')), line=getComputedStyle(document.querySelector('.sticker')).borderColor;
const m=new Map();for(const e of document.querySelectorAll('main *')){if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;const s=getComputedStyle(e);const k=s.fontSize+' '+s.color;m.set(k,(m.get(k)||0)+1)}
({stepCardOverPaper:(okL(card)-okL(paper)).toFixed(3), stepRowUnderCard:(okL(card)-okL(row)).toFixed(3), outlineOnPaper:cr(line,paper), under12px:[...m].filter(([k])=>parseFloat(k)<12), rows:[...m].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,n])=>n+'× '+k+' → '+cr(k.slice(k.indexOf(' ')+1),card))})
```

What to hold, measured on the dark palette (2026-11-22): `under12px` is
empty; any row that is a sentence (not `.mono`) reads at 6:1 or better
against the card (`--muted` is 7.5:1), metadata in `--faint` at 4.5:1 or
better (it is 5.2:1); orange and red text never use the fill tokens. The
surface steps are deliberately small -- `stepCardOverPaper` is about 0.04 and
the outline about 1.3:1 -- because a card is told apart by its hairline and
its step together, the way the tools this sits beside do it. Do not let
either drop below those numbers; raising them is fine.

The `--on-fill` rows (dark text on chips) will show a low number against the
card — they sit on a bright fill, not on the card, and are fine.

## Accessibility

- **Colour never carries meaning alone.** Every status, kind and badge has a
  text equivalent — see `StatusDot` and `Chip` for the pattern — and every
  control has a real label.
- A control that is the current state stays focusable. Do not `disabled` it just
  because it is active; `aria-current` says that, and a disabled control gives a
  touch user no feedback at all.
- Anything that changes without a navigation needs `role="status"` and
  `aria-live="polite"` (`app/features/token-form.tsx`).
- Server Actions stay in a real `<form action={…}>` so they work without
  JavaScript; if you need a pending state, split just the button into a client
  component and use `useFormStatus` (`app/features/lang-button.tsx`).

Full rules: [CONTRIBUTING.md](../../../CONTRIBUTING.md).
