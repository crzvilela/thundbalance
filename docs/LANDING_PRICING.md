# The Pricing section of the landing page (manual)

The packs shown in the Pricing section of the landing page are written **by hand** in the landing editor. They have no link with the catalogue of packs (Admin > Packs): creating, editing, archiving or deleting a pack there never changes the landing, and the landing never changes the catalogue. The page does not even read the catalogue (`GET /pricing` is not called by the Pricing section).

## Add a pack to the landing

1. Open the landing page editor and select the Pricing section.
2. In the panel, "Packs en la landing" lists the cards. Press **Añadir pack**: a blank card is created and opened.
3. Fill in what you want (everything is free text; empty fields are simply not drawn). Below the card, a live **preview** shows how it will look.
4. Each card can be **moved** (up / down buttons or drag and drop), **hidden / shown**, **duplicated** and **deleted** (with confirmation). Deleting a card of the landing never touches the catalogue.
5. The texts can also be edited on the page itself (double click on the word), as the rest of the landing.
6. Save / publish as always. The button of a card has no destination (it never had one): it only shows its text.

| Field | Limit |
|---|---|
| Name | 60 characters |
| Price (free text, e.g. "45 € / sesión" or "Desde 120 €") | 40 |
| Price note (small text next to the price) | 60 |
| Label (e.g. "Más popular") | 60 |
| Goal | 200 |
| Description | 200 |
| Duration, total sessions, button text | 60 each |
| Benefits, features | 0 to 10 items of up to 100 characters |
| Highlighted (dark card) | yes / no |

No field accepts `<` or `>` (no HTML). At most 30 cards. The editor shows a counter per field and a message (ES / EN) when a limit is passed; the server checks the same limits when the draft is saved or published (`422 invalid_pricing_card`, `backend/landing_pricing.py`).

A text is either a plain string or an `{ "en", "es", "ca" }` object: the form writes the current language into a field that already has languages and a plain string into a field that has not; a double click on the page writes the language being shown.

## How it is stored

In the landing content (`landing_page_content`, draft and published) each Pricing section has `cards`: `[{ id, visible, highlighted, name, price, period, tag, objective, duration, totalSessions, description, benefits[], features[], buttonText, + style objects }]`, in the order of the page. Pure logic and limits: `src/utils/landingCards.js`; editor panel: `src/components/editor/PricingCardsFields.jsx`; the card: `src/components/Pricing.jsx`.

## The one-time migration

Before, the section listed catalogue packs (`planItems` with a `plan_id`) or, even earlier, drew every pack on sale. On the first start of the server after this change, every Pricing section **without `cards`** is converted by `backend/landing_pricing.py`: each item becomes a manual card with the values the page showed (name, price as "€65", weeks and sessions per week, total, goal and benefits of the pack, plus the description, features, button and highlight of the text card it used), in the same order and with the same visibility, so the landing looks the same. An item whose pack no longer exists disappears in silence. `planItems` (and its `plan_id`) is removed; the old `plans` text cards stay untouched in the content (not used). A section that already has `cards` is never touched, so running it again changes nothing, and an emptied list stays empty. "Reset" of the landing runs the migration again over the restored content. The old format (no `cards`) is still accepted when saving.

One difference from before: the Individual / Dual selector of the section is gone (a manual card has no type); the cards of both types appear together, individual first.

## Tests

`backend/test_landing_pricing.py` (migration copies the values, once, without duplicating; a deleted pack disappears; limits, HTML and too many benefits are refused; the old format is accepted; creating, editing or archiving a pack does not change the landing; the public content endpoint does not read the catalogue) and `src/utils/landingCards.test.js` (create, edit, duplicate, delete, reorder, hide, validation; the page and the editor do not read the catalogue).
