# Design system (phase 1)

Tokens in `src/index.css` (`@theme`) and base components in `src/components/ui/`. It is a **refactor, not a redesign**: every token has the value of the class it replaces, and a page that moves to the components looks exactly as before (checked by comparing the computed styles of every element before and after: see "How a page is migrated").

The brand does not change here: logo, the green, the dark look and the colour of the main button of the hero and the pricing are decisions of the studio owner. The landing keeps its own theme layer (it comes from the editable content).

## Tokens
| Token | Value | Replaces |
|---|---|---|
| `--color-accent` | oklch(76.5% .177 163.223) | `emerald-400`: solid button, focus ring, active tab |
| `--color-accent-hover` | emerald-300 | `hover:bg-emerald-300` of the solid button |
| `--color-accent-text` | emerald-300 | `text-emerald-300`: eyebrows, links on dark |
| `--color-accent-soft` / `-line` | emerald-400 at 10 % / 40 % | `bg-emerald-400/10`, `border-emerald-400/40` |
| `--color-danger` (`-hover`, `-text`, `-soft`, `-line`) | red-500 / red-400 / red-300 / red-400 at 10 % / 25 % | solid dangerous button, error text and notices |
| `--color-warn` (`-text`, `-soft`, `-line`) | amber-400 / amber-300 / 10 % / 25 % | warning states |
| `--color-info` (`-text`, `-soft`, `-line`) | sky-400 / sky-300 / 10 % / 25 % | information states |
| `--color-line` | white at 10 % | `border-white/10`: cards, dividers |
| `--color-line-strong` | white at 20 % | `border-white/20`: buttons and fields. `/15` and `/25` map here |
| `--radius-control` | .75rem | `rounded-xl`: buttons, fields |
| `--radius-card` | 1.5rem | `rounded-3xl`: cards |
| `--radius-card-sm` | 1rem | `rounded-2xl`: small cards, panels |
| `--radius-pill` | 9999px | `rounded-full`: badges, tabs |
| `--text-display` (`-lg` from md up) | 3rem (3.75rem) | `text-5xl md:text-6xl`: title of a page (Bebas Neue) |
| `--text-h1` | 2.25rem | `text-4xl`: title of a modal |
| `--text-h2`, `--text-h3` | 1.5rem, 1.25rem | `text-2xl`, `text-xl` |
| `--text-eyebrow` | .75rem | `text-xs`: the small line over a title |

Shadows and spacing: no clear pattern yet, so no tokens (the modal keeps `shadow-2xl`).
Use them as utilities: `border-line`, `bg-accent-soft`, `rounded-card`, `text-display`, `text-accent-text`.

## Components (`import { Button, … } from '../components/ui'`)
```jsx
<Button variant="primary" size="lg" loading={busy} onClick={save}>Save</Button>
<Button as={Link} to="/profile" variant="secondary">Profile</Button>            {/* a link that looks like a button */}
<Button variant="light" size="form" radius="none" type="submit">Sign in</Button>  {/* the wide uppercase button of the forms */}
<Button variant="plain" size="none" role="tab" className="…">Tab</Button>        {/* tabs and toggles: behaviour only */}
```
- **Button**: variants `primary` (green), `light` (solid white), `secondary` (outlined), `outline` (outlined, fills white on hover), `ghost`, `danger` (solid red), `plain`. Sizes `sm`, `md`, `lg`, `form`, `none`; every size except `form` and `none` has a 44 px minimum height. `loading`: spinner, `aria-busy`, disabled and it ignores clicks. `disabled`: half opacity and `not-allowed`. Rendered as a link with `as`: it gets `aria-disabled` and no navigation while blocked. Focus ring on every variant.
- **Card**: `radius` `lg` (default) / `sm`, `highlight` (an unread message), `plain` (no tint: a frame around a form), `as`.
- **Badge**: tones `success`, `warn`, `danger`, `info`, `neutral`; sizes `sm` (small caps) and `md`.
- **PageHeader**: eyebrow, title (Bebas Neue), subtitle, `actions`. `tone="muted"` is the quieter variant some pages still use; it exists only so migrating does not change the look.
- **EmptyState**: text, optional title / icon / action; `role="alert"` for an error.
- **Skeleton**, `SkeletonLine`, `SkeletonCard`, `SkeletonList`: pulse; the global `prefers-reduced-motion` rule stops them.
- **Modal**: wraps `useModalFocus` (focus trapped, Esc, focus returns); title, description, actions, `size` `md`/`lg`, `role` (`alertdialog` by default), `busy` (cannot be closed while sending). Used by `ConfirmModal`; the other 14 dialogs are not migrated yet.
- **Fields**: `FormField` (label, error, help) + `Input` / `Select` (same corners, border, height and focus; the select has its own chevron).

## Rules
- A new button is a `<Button>`. No raw `<button>` in a migrated page.
- No `border-white/10|15|20|25` (use `border-line` / `border-line-strong`) and no `rounded-3xl` / `rounded-2xl` on new cards (use `<Card>`).
- A new select is `<Select>` inside a `<FormField>`: the label is always visible.
- The guard `src/designSystem.test.js` checks the migrated files (list `MIGRATED`) for a raw `<button>` / `<select>` and the old classes. Add a file to the list when you migrate it.

## How a page is migrated (without breaking the site)
1. Snapshot the computed styles and the boxes of every element of the page (390 and 768 px, each state: normal, errors, expanded, empty).
2. Replace buttons, cards, headers and fields with the components. Keep the same classes where a variant has none.
3. Take the snapshot again and compare: only the differences listed under "Known differences" may remain.
4. Add the file to `MIGRATED`.

## Status
| | |
|---|---|
| **Migrated** | Login, Register, public 404, Client messages (and `MessageCard`, `ConfirmModal`), Training request, Profile |
| **Not done: no password-recovery screen exists** | the app has no "forgot password" page |
| **Pending (client)** | Dashboard, My sessions (+ session modal and calendar), Trial session, Reschedule response, Trial confirm, Legal pages, ChangePassword, MyData, TempPasswordNotice |
| **Pending (landing)** | everything; it has its own theme layer from the editable content (decision of the studio owner) |
| **Pending (admin)** | everything; the admin has its own kit (`src/admin/ui.jsx`: Button, Card, Badge, Drawer…) with its own look (hover shadow, press effect). Merging the two is a later decision. The admin 404 already uses that kit and was left as it is |
| **Pending (dialogs)** | the other 14 dialogs and drawers |

## Known differences of the migration (all minimal)
- Inactive tabs, the filter group, "Mark all as read" and the pagination had `border-white/15` or `/25`: now `/20`.
- The bordered buttons of the Profile were 46 px high and the solid ones 44 px (next to each other): now all 44 px.
- On the 404 the second button had a 16 px text and the first 14 px: both 14 px.
- The registration button when the policy is not accepted: `not-allowed` at 50 % (it was `wait` at 60 %, which is for "sending").
- Training request (the one page harmonised on purpose): eyebrow, title and subtitle like the other pages, labels like the other forms, selects with the corners of the other fields.
