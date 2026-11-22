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
| `.sticker` / `.sticker-flat` | the white card on its layered shadow, and the quieter well inside it |
| `.btn` / `.btn-quiet` | the graphite capsule (the action), and its outline twin (the second action) |
| `.pill` | nav, report period and language pills |
| `.link-more` | the wavy-underline text button |
| `.lift` | hover raise |
| `.pop` | entry animation, staggered with an inline `animationDelay` |
| `.row-action` | an action that appears on hover **and on touch** |
| `.searchbox` | the search field frame |
| `.on-fill` | dark text on a bright fill |
| `.display` / `.mono` | Fraunces for headlines only; DM Mono for ids and paths. Body, controls and labels are Geist |
| `.marker` | one phrase under the orange marker, inline in a heading |
| `.tone-panel` + `.tone-mint` / `-butter` / `-sky` / `-apricot` / `-lilac` / `-sand` | a pastel surface: a panel behind a picture of the product, a stat tile |
| `.frame` | a screenshot or a drawing of a screen set into a panel |
| `.dot-grid` / `.scrap` | graph-paper background and a torn-edge scrap, for a collage |
| `.site-band` (+ `.band-link`, `.band-label`) | the graphite band every page ends on |
| `.board-col` + `data-drop-status` | a board column, washed by its status, and a drop target |
| `.prose` | 68ch measure for body copy |

Components: `app/components/` (`Panel`, `Empty`, `Chip`, `Counter`, `Field`,
`StatusDot`, `Blob`, and the decorative stickers) via the barrel
`app/components/index.ts`. Client-side pieces: `app/features/`. The board's
drag-and-drop is `app/p/[slug]/board-dnd.tsx`.

## The look, in six rules

A calm reading room with a scrapbook on the desk (tasks #809 and #811): a
warm canvas, white cards that float, graphite ink, colour only where it means
"look here".

- **Pictures before paragraphs.** On a page somebody reads to decide -- the
  landing, an empty state, the dashboard summary -- say it with a drawing of
  the screen (markup in a `.frame`, so it follows theme and language) or a
  number on a tile, and keep the sentence under it short.
- **The panel is for people.** Agents never look at it. Every state a
  person needs to act on is visible without opening anything, and everything
  an agent can do to a task a person can do too -- the board's cards move by
  drag *and* by a menu of plain forms.
- **Orange is the one accent, and it is two tokens.** `--accent` is the
  marker: a fill, a stroke, a highlight. Orange *text* is `--accent-ink`
  (`text-accentInk`); an error in words is `--danger-ink`.
- **Pastels are surfaces, never signals.** `--tone-*` colour a panel or a
  tile with ink on it. A status or kind is a `Chip` (a dot and a pale wash,
  ink text) or a `StatusDot` with its word -- colour never alone.
- **Actions are a graphite capsule.** `.btn` is filled; the second action
  beside it is `.btn-quiet`. Selected is the graphite pill
  (`.seg[aria-current]`). Matte: no `backdrop-filter`, shadows from
  `--shadow*` only, never a hard offset.
- **Both themes.** Light is the default; `prefers-color-scheme: dark` swaps
  the `:root` tokens, the pastels included (they go deep, so the cream ink
  still reads). A literal colour gets neither theme.

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

The page is light now, so the WCAG ratio means what it says. What to hold:
`under12px` is empty; any row that is a sentence (not `.mono`) reads at 6:1 or
better against the card, metadata in `--faint` at 4.5:1 or better; orange and
red text never use the fill tokens. The surface steps are deliberately small
on cream — a card is cut out by its `--line` hairline and its soft shadow,
not by a lighter fill — so `stepCardOverPaper` is not a target any more.

**Run it twice**, once per theme: in Playwright, `page.emulateMedia({
colorScheme: "dark" })` and the same script again. The dark tokens are a
separate set, and a pair that passes on cream can fail on brown.

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
