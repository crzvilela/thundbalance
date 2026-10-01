# Footer editor

Open **Admin → Footer** (`/admin/footer`). Edit the location, heading, contacts and social links. Use the language selector for translated labels and addresses. Contacts and social links support visibility, removal with confirmation, and keyboard-accessible ordering. The desktop/mobile preview renders the real public footer before saving.

**Save Changes** publishes only the footer and updates the footer in the landing page draft. Other draft content is preserved. Save failures retain local edits; concurrent changes to the published footer return a conflict instead of overwriting the newer footer. **Discard Changes** restores the last saved version. Reloading or leaving through the Admin link warns about unsaved changes.

Normal Google Maps location links and addresses are converted to the existing map format. Shortened links need a full address; they are not resolved through a new third-party service. Editing the address clears the old link so an old location cannot override the new address. Existing map dimensions, contact positioning, branding and the 360° view are retained. The existing landing editor still manages branding, layout and the 360° URL.

## Files

Created:

- `src/pages/admin/FooterEditor.jsx` and `FooterEditor.css`: editor and responsive styles.
- `src/components/editor/FooterPreview.jsx`: actual public footer inside an independent desktop/mobile viewport.
- `src/utils/footerContent.js`: documented contact/social shapes, legacy compatibility, safe links, map conversion and validation.
- `tests/footer-content.mjs`, `tests/footer-editor.mjs`, `tests/footer_api_test.py`: content, isolated browser and backend transaction tests.

Modified:

- `src/components/Footer.jsx`: editable heading, ordered contacts/social links and visibility while retaining existing content fallbacks.
- `src/content/LandingContentContext.jsx`: local snapshot provider for preview.
- `src/components/editor/PropertiesPanel.jsx`: link to the dedicated editor; existing branding/layout/360° controls retained.
- `src/pages/Admin.jsx`, `src/routes/AppRoutes.jsx`: navigation and existing admin protection.
- `src/api/landingPage.js`, `backend/main.py`: authenticated `PUT /landing-page/footer`.

## Deployment and data

Deploy the updated frontend and backend together, using the existing Firebase admin configuration and PostgreSQL connection. No dependencies, credentials, schema migrations or manual data edits are needed. New optional fields live inside `sections.footer` in the existing `landing_page_content` JSONB document. Legacy fixed contact fields remain supported until the corresponding list is edited. The immutable `default_base` version is untouched.

After deployment, verify a save with an authenticated admin and reload a public page. Public pages use the existing fetch-on-load behavior; already-open visitor tabs refresh their content on reload.

## Verification

- `npm.cmd run build`: passed (existing large bundle warning).
- Targeted ESLint for new editor/components/helpers and modified UI/API files: passed.
- `node tests/footer-content.mjs`: passed.
- With Vite running, `node tests/footer-editor.mjs`: passed. Uses installed Playwright and Edge, mocks auth/API, blocks external requests and changes no production data. Screenshots: `artifacts/footer-editor/`.
- `npm.cmd run lint`: seven existing errors in mixed hook/component exports and effect state updates, including the nested repository copy. No new lint errors.
- No typecheck script is configured; this project uses JavaScript/JSX.
- Backend tests: `python -m unittest discover -s tests -p '*_test.py'`. Not executed here: the virtual environment points to missing `C:\Python314\python.exe`, and the installed Python aliases cannot launch. These isolated tests cover footer-only writes, concurrent conflicts and rollback; live database integration and third-party map loading still need deployment verification.
