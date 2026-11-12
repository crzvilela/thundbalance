# The Pricing section of the landing page (manual, Individual | Dual)

The landing page is ONE site for everybody: a visitor without login, a client and the admin see exactly the same Pricing section. Its content is the published landing, read from the public `GET /landing-page/content?version=published` (no token, read only, `Cache-Control: public, max-age=30`); the Pricing section never depends on a token, a role or a profile, and never reads the catalogue of packs.

## What the page shows

Two boxes, **Individual** and **Dual** (the selector above the cards). Each box shows its own three prices, always in this order: **Monthly, Quarterly, Semiannual** (labels: Mensual / Trimestral / Semestral in Spanish and Catalan, Monthly / Quarterly / Semiannual in English), each with its price (free text) and its features. Nothing of one type ever appears in the other box. A price that has not been written yet shows "—"; if nothing at all has been written the page says so ("Prices coming soon") instead of showing nothing.

The description, the button text and the "highlighted" look of each plan are the section's three text cards (`plans[0..2]`), the same for both boxes, as before the catalogue existed. The button has no destination (it never had one).

## Edit the prices

In the landing editor select the Pricing section. The panel has two blocks, Individual and Dual, each with Monthly, Quarterly and Semiannual: for every one the **price** (free text, e.g. "45 € / sesión" or "Desde 120 €") and a list of **features** (0 to 10), with a live preview of the card and a counter per field. The same texts can be edited on the page itself (double click). Highlighting a plan is at the end of the panel (shared by both boxes).

| Field | Limit |
|---|---|
| Price | 60 characters |
| Feature | 100 characters, at most 10 per price |

No field accepts `<` or `>` (no HTML). The editor shows the problem (ES / EN) and the server checks the same limits when the draft is saved or published (`422 invalid_pricing`, `backend/landing_pricing.py`).

## How it is stored

In the landing content (`landing_page_content`, draft and published) the Pricing section has `plans` (the three text cards) and `prices`: `{ "individual": [t0, t1, t2], "dual": [t0, t1, t2] }`, each `t = { "price": ..., "features": [...] }`. A text is a plain string or an `{ "en", "es", "ca" }` object. Pure logic: `src/utils/landingPrices.js`; editor panel: `src/components/editor/PricingTiersFields.jsx`; the section: `src/components/Pricing.jsx`. The browser keeps a copy of the published content for speed; its key carries a version (`landing-content:v3:`), so a copy of an older shape is never used.

## Packs and the landing are independent

Creating, editing, archiving or deleting a pack in Admin > Packs never changes the landing, and the landing never changes the catalogue. A new pack lives only in the database and in the places where a pack is chosen (the client's request, the admin creating a pack for a client...). The goal and the benefits of a pack are not shown to the client when choosing it.

## The one-time migration

`backend/landing_pricing.py` converts every Pricing section **without `prices`**, in the draft and the published content, when the server starts (and after a "Reset" of the landing):

1. The JSON as it was is saved first in a backup row, `backup-draft` / `backup-published` in the same table (never overwritten).
2. Each earlier card (the manual cards of the previous version, the list of catalogue packs before that, or the plain catalogue) goes to its place by type and duration (4 / 12 / 24 weeks, or the name: Monthly, Quarterly, Semiannual). Its price text is kept as the page showed it ("€65/session") and so are its features.
3. What does not fit (a second card for the same place, a card that is not Monthly / Quarterly / Semiannual) is **not deleted**: it stays in `legacyCards` of the section (not drawn) and in the backup, and the report of the migration lists it.
4. The old `cards` / `planItems` keys are removed from the section (they are in the backup). A section that already has `prices` is never touched, so running it again changes nothing.

## Excluir pack (Admin > Packs)

Every pack has an **Excluir pack** button; the confirmation ("¿Seguro?") shows the name. It calls `DELETE /admin/plans/{id}` (admin only):

* a pack that nobody ever used (no client pack and no request made from it) is **deleted for good**;
* a pack that clients use or asked for is only **archived**: hidden from every selector, and the packs of the clients keep working as before (they hold their own copy of price, weeks and type). It can be restored from the archived list.

The answer says which of the two happened (`outcome: "deleted" | "archived"`) and the list reloads. An unknown id is a clear 404 (`pack_not_found`).

## The form "Nuevo pack"

Name, goal, duration (weeks), sessions per week the client may choose, price per session, type (Individual | Dual) and benefits; the **total sessions** (weeks x sessions per week) and the **total price** (total sessions x price per session) are calculated and read only (one line per option when several sessions per week are offered). There is no separate pack price any more: the server ignores one sent by a browser.

## Tests

`backend/test_landing_pricing.py` (migration: backup, no loss, once, nothing mixed between the boxes, leftovers kept; limits and HTML refused; the public landing is the same with and without a token; a pack created, edited or deleted does not change the landing), `backend/test_pack_delete.py` (Excluir pack: deleted when unused, archived when in use without breaking the clients' packs, requests, 404, admin only; the fields of a new pack and the calculated total) and `src/utils/landingPrices.test.js` (each box has its own three prices, empty tiers, editing, limits, labels in ES / EN / CA, no dependence on the catalogue, a token or a role).
