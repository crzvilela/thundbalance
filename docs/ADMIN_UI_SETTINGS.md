# Personalising the admin panel

The studio's admin can rename, reorder and hide what it does not use from "Personalizar panel" (the button at the end of the side menu, only for the main admin): the **menu** areas, the **Overview** cards and the **title and subtitle of each page**. There is ONE configuration for the whole studio, stored in a single row of `admin_ui_settings` (`key = 'panel'`, `{"menu", "overview", "pages", "version"}`); a name is one text for both languages, and where nothing is customised the original text (ES / EN) is shown, so with no configuration the panel is exactly the original one. `GET /admin/ui-settings` returns it (or `{}`), `PUT` validates and saves it (it must send the `version` it loaded, otherwise 409; the first save is version 0), `DELETE` removes the row ("Restablecer todo"); all three are admin only. Only keys of a closed registry can be customised and nothing else is stored: names up to 30 characters, subtitles up to 120, no `<` or `>` and no control characters, at most 8 KB, the Overview item and the "Personalizar panel" button can never be hidden and at least 3 menu areas always stay visible (the server refuses it with 422 and the editor warns). The panel never depends on it: the frontend loads it once, never waits for it, and if the request fails or the answer is not valid it uses the original values; a key that is missing from a saved configuration (for example a new area added later) simply appears at the end with its original name. While editing, the changes are applied live to the menu and the Overview without saving; everything that can be dragged also has up / down buttons and works with the keyboard and on a phone.

## Editable keys

| Group | Keys |
|---|---|
| Menu (`menu`) | `overview` (protected), `requests`, `trials`, `messages`, `sent-messages`, `clients`, `calendar`, `schedule`, `trainers`, `plans`, `videos`, `landing`, `customize` (the editor button: protected, always last, can be renamed) |
| Overview cards (`overview`) | `stat_clients`, `stat_sessions`, `stat_pending`, `week`, `pending`, `business`, `upcoming`, `quick` |
| Pages (`pages`, title + subtitle) | `overview`, `requests`, `trials`, `messages`, `sent-messages`, `clients`, `calendar`, `schedule`, `trainers`, `plans`, `videos` |

## Adding a new area (or card, or page)

1. **Frontend registry** `src/admin/uiRegistry.js`: add the item to `MENU_ITEMS` (key, route, icon, `labelKey`, optional `badge`) / `OVERVIEW_CARDS` (key, `titleKey`, group and span) / `PAGES` (key, `titleKey`, `subtitleKey`); the texts go in `adminText.js` (ES and EN). The menu and the editor read the registry, so nothing else is needed for the menu.
2. **Backend registry** `backend/admin_ui_settings.py`: add the same key to `MENU_KEYS` / `OVERVIEW_KEYS` / `PAGE_KEYS` (the server refuses any key it does not know).
3. **The place that shows it**: a page uses `<PageHeader pageKey="the-key" ... />`; an Overview card takes its title with `titleOf('the-key', originalText)` (`useOverviewCards()`), and is placed by `overviewBlocks` (`src/admin/uiSettings.js`).
4. Tests: `src/admin/uiSettings.test.js` (the original menu must stay equal) and `backend/test_admin_ui_settings.py`.

An area added later appears at the end of the menu for studios that already saved a configuration, with its original name.
