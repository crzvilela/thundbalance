# Which plans the landing page shows

The Pricing section of the landing page shows only the plans that the studio **added to it**. Creating a plan in Admin > Packs does not put it on the landing: the plan lives in the catalogue and is offered where a plan is chosen (the client's request, the admin creating a pack...). The landing changes only from the landing editor.

## Add a plan to the landing

1. Open the landing page editor and select the Pricing section.
2. In the panel, "Planes en la landing" lists the plans that are there. Press **Añadir plan**: it lists the plans that are not on the landing yet (name, type, price per session). Choose one and it appears at the end.
3. Each plan on the list can be **moved** (up / down buttons or drag and drop), **hidden / shown** (hidden plans stay in the list but are not drawn) and **removed from the landing** (it is only taken off the landing; the plan stays in Packs). An empty list says so.
4. The price, the name, the goal, the benefits and the total sessions come from the plan, live: editing a plan in Packs changes its card. An archived or deleted plan disappears from the landing in silence (and comes back if it is restored). The description, features, button and "highlighted" of a card are written in the editor, as before.
5. Save / publish as always.

The goal and the benefits of a plan (written in Packs) are drawn on this card, and nowhere else on the client side.

## How it is stored

In the landing content (`landing_page_content`, draft and published), each Pricing section has `planItems`: `[{"plan_id": <pack_catalog.id>, "visible": true, "card": <index in "plans" or null>}]`, in the order of the page; `card` points to the text card of the item. Pure logic: `src/utils/landingPricing.js`; editor panel: `src/components/editor/PricingPlansFields.jsx`; the card: `src/components/Pricing.jsx`.

## The one-time migration

Until now the section drew every plan on sale. On the first start of the server after this change, `backend/landing_pricing.py` gives every Pricing section **that has no `planItems` yet** the list that reproduces the page: the plans on sale, by type, in the order of the catalogue, each with the card that had its position (a plan beyond the number of cards gets a plain card). It never touches a section that already has the key (so it does not duplicate and an emptied list stays empty), and "Reset" of the landing runs it again over the restored content. The immutable `default_base` snapshot is not modified.

## Tests

`backend/test_landing_pricing.py` (migration once and without duplicates, a new plan does not enter, the catalogue still feeds the card) and `src/utils/landingPricing.test.js` (only listed plans drawn, add / remove / reorder / hide, deleted plan skipped, no goal / benefits outside the landing).
