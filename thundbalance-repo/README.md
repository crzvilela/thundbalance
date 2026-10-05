# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Landing Page Editor (visual page builder)

A new admin-only feature was added: a Squarespace/Webflow-style visual editor
for the public landing page, available at **`/admin/landing-editor`** (also
linked from the Admin Dashboard).

### What it does

- Click any text, image, button or section directly in the live preview to
  select and edit it (content, colors, fonts, spacing, alignment, links, etc).
- Global **Theme** panel for site-wide colors and typography.
- Toggle any section's visibility, and reorder the middle sections
  (Hero, About, Services, Pricing, Testimonials, Contact).
- Add/remove Service cards and Pricing plans (and each plan's feature list).
- Upload/replace/remove images (Hero background, service card images).
- **Desktop / Tablet / Mobile** preview toggle.
- **Undo / Redo** (in-editor history).
- **Save Changes** writes a *draft* that only the editor can see.
- **Preview** opens the public site with the draft applied (`/?preview=true`),
  exactly as a visitor would see it, with no admin UI.
- **Publish** copies the draft to the live, *published* version that the
  public `/` route serves.
- **Reset to Default** restores the original copy/design (draft only).

### How it's implemented

- All editable content lives in one JSON document per version
  (`draft` / `published`), stored in a new Postgres table
  `landing_page_content` (created automatically on backend startup).
- Backend endpoints (see `backend/main.py`):
  `GET /landing-page/content?version=draft|published`,
  `PUT /landing-page/content/draft`, `POST /landing-page/publish`,
  `POST /landing-page/reset`, `POST /landing-page/upload-image`.
- Uploaded images are stored in `backend/uploads/` and served at `/uploads/...`.
- `python-multipart` was added to `backend/requirements.txt` (required by
  FastAPI for file uploads) — run `pip install -r requirements.txt` again.
- Frontend: `src/content/LandingContentContext.jsx` is the single source of
  truth for the content object (fetch, edit, history, save/publish).
  Every landing page component (`Hero`, `Navbar`, `About`, `Services`,
  `Pricing`, `Testimonials`, `Contact`, `Footer`) reads its text/images from
  this context via the reusable `EditableText` / `EditableImage` /
  `EditableCtaButton` components in `src/components/editor/Editable.jsx`,
  so nothing is hardcoded anymore. Adding a new editable field to an existing
  section, or a whole new section type, just means adding a key to
  `src/content/defaultContent.js` (and its Python mirror
  `backend/landing_page_default.py`) and wiring it up with one of the
  existing `Editable*` components — the persistence, undo/redo, draft/publish
  and properties-panel plumbing all already support it.

### Phase 3: Video support & more image slots

- **Video everywhere backgrounds/images already worked.** Every section's
  standardized `background` object now has a `type` (`color` | `image` |
  `video`), and switching to `video` reveals upload/embed controls in its
  properties panel instead of the image ones. `ImageTextSection` (added in
  Phase 2) has a `mediaType` toggle to swap its media side between an image
  and a video. A brand new section type, **Video Block** (`videoBlock`), is
  a full-width video with an optional eyebrow/title above or below it —
  available from "+ Add Section" alongside the other 6 templates.
- **Two ways to set a video**: upload a file (`.mp4`/`.webm`/`.mov`, up to
  50MB, via the new `POST /landing-page/upload-video` endpoint — mirrors
  `upload-image` exactly, just with its own extension/size limits) or paste
  an embed link. YouTube and Vimeo links are auto-converted to the right
  embed URL (with autoplay/loop/muted params wired through for background
  use); any other link is used as-is in an iframe with a soft warning in the
  panel that embed support is best with YouTube/Vimeo.
  `src/utils/videoEmbed.js` has the conversion logic, `EditableVideo.jsx`
  is the click-to-select component (same pattern as `EditableImage`).
- **Migration**: content saved before this phase has no `background.type`.
  `migrateBackgroundTypes()` in `src/content/migrateContent.js` infers it
  once on load (`image` set → `'image'`, otherwise `'color'`) before the
  new default shape would otherwise silently backfill it to `'color'` —
  same "migrate in memory on load, persist properly on next Save" approach
  used for the Phase 2 section-instance migration.
- **New optional image slots**, all `null`/off by default so nothing looks
  different until an admin sets one:
  - Navbar & Footer: `logoImage` (independent per section) plus a
    `showBrandText` toggle, so the admin can show logo + text, logo only,
    or text only.
  - About & Contact: an optional `image` field. When set, the section
    switches to a 2-column image/text layout (matching `ImageTextSection`'s
    layout); when empty, both keep their original single-layout look
    exactly as before.
  - Pricing and Testimonials intentionally did **not** get an image slot
    this phase.
- **⚠️ Known limitation (not fixed in this phase):** uploaded files
  (`backend/uploads/`) live on local disk. If the backend is deployed
  somewhere with an ephemeral filesystem (e.g. Render's free/standard web
  services), uploads can be wiped on every redeploy/restart. This was a
  minor issue with small images; it's a much bigger one with videos up to
  50MB. Moving uploads to external object storage (S3, Cloudinary, etc.) is
  planned for a future phase — until then, treat `backend/uploads/` on such
  platforms as non-durable, especially for video.

