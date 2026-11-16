# Accessibility (WCAG 2.1 AA)

The goal is level AA on the main pages (landing, login/registration, client area, legal pages, admin).

**Rules when you write a page**
- Text on the dark pages: never `text-gray-500/600` for readable text; use `text-hint` (4.5:1 on black). The admin light theme redefines `--color-hint` in `admin-light.css`. Large text and components need 3:1.
- Every page has ONE `<main id="main">` (the skip link goes there), one `<h1>` and no skipped heading levels. Nav landmarks carry an `aria-label`.
- Every field has a label (`<label htmlFor>` or an `sr-only` label), the right `type` and `autoComplete`, `required`, and its error in an element with `role="alert"` linked by `aria-describedby`. After a failed submit the focus goes to the first field to fix.
- Icon-only buttons need an `aria-label` from the translations (never a fixed English text); decorative images get `alt=""`. Toggles use `aria-expanded` / `aria-pressed`; the current page uses `aria-current`.
- Menus and dialogs: focus moves in, Tab stays inside, Esc closes, focus returns to the opener (`useModalFocus`).
- Never remove an outline without a replacement: the global rule in `index.css` draws a ring on any `outline-none` control that has no ring/border of its own. Touch targets are at least 44x44 px.
- Motion: `prefers-reduced-motion` switches animations and transitions off globally. Do not set `user-scalable=no`.
- Every text exists in ES/EN/CA (admin ES/EN): `src/i18n/i18n.test.js` fails otherwise. `<html lang>` is set by `public/lang-init.js` before the first paint and kept in sync by `LanguageSync` / `useDocumentLanguage`.

**Checks**
- `npm run test:a11y`: vitest + jsdom + axe on login/registration, focus handling, keyboard use of a menu and a dialog. jsdom has no layout, so contrast is not checked there.
- Real browser audit (contrast included): build with `tests/a11y/vite.config.mjs` (replaces `firebase/auth` with a stub), start `tests/a11y/backend_server.py`, serve the build with `node tests/csp-server.mjs --axe <axe.min.js> --api http://127.0.0.1:8000`, then run `axe.run()` on each page (`?as=client` / `?as=admin` choose the test user). Known and accepted: the Elfsight reviews widget (third party) has low contrast.
