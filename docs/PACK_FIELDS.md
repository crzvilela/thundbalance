# Pack fields: objective, benefits and calculated totals

Admin > Packs. A pack of the catalogue (`pack_catalog`) now carries two optional texts written by the studio, and shows two figures that the system works out.

| Field | Where it lives | Rule |
|---|---|---|
| Name | `name` (already existed) | 1–80 characters |
| Duration | `weeks` (already existed; 4 = 1 month, 12 = 3, 24 = 6) | whole number 1–260 |
| Price per session | `price_per_session` (already existed) | 0–100000, at most 2 decimals |
| **Objective** | `objective TEXT` (new, NULL = none) | up to 160 characters, no `<` or `>`, no control characters |
| **Benefits** | `benefits JSONB` (new, NULL = none) | 0–8 items, each up to 80 characters, no `<` `>`, no repeats (case-insensitive); blank lines are dropped |
| Total sessions | **calculated**, never stored | weeks x sessions per week |
| Total price | **calculated**, never stored | the pack price (one option and a price set) or price per session x weeks x sessions per week |

The objective and the benefits are one free text, written once, in the language the admin chooses: they are not translated per language (like the pack name). The labels around them ("Goal", "Included"...) are translated: admin texts ES/EN (`adminText.js`), client texts ES/EN/CA (`pageText.js`), e-mail labels ES/EN/CA (`backend/emails/texts.py`).

## Why the totals are calculated and not typed

A sold pack gets its number of sessions from `weeks x sessions per week`, and the client chooses the sessions per week (1–7) when the pack has several options. A typed "total sessions" would contradict that. So the form shows both figures read-only, updating as the admin types (one line per option when there are several), and the server returns them: `total_sessions` and `price_total` when the pack has ONE option (otherwise `null`: it depends on the client's choice), and `totals` = `[{per_week, sessions, total}]` for every option. A `total_sessions` / `price_total` sent by the browser is ignored.

## Database

`ensure_schema` (`backend/pack_catalog.py`) runs `ALTER TABLE pack_catalog ADD COLUMN IF NOT EXISTS objective TEXT` and `... benefits JSONB`: idempotent, nothing is renamed or deleted. Every pack that existed before has both columns empty and keeps working and looking the same.

## API

`POST /admin/pack-catalog` and `PUT /admin/pack-catalog/{id}` accept `objective` (text) and `benefits` (list of text). A `PUT` that does not carry the key leaves what the pack has; an empty text / empty list clears it. Anything invalid answers `422` with `{code: "invalid_objective" | "invalid_benefits", field, message}` (message in Spanish and English). `GET /pricing` (public, packs on sale) and `GET /admin/pack-catalog` return `objective`, `benefits`, `totals`, `total_sessions`, `price_total`.

## What the client sees (only when the pack has them)

* Landing page pricing cards and the pack picker of the request page (`src/components/PackExtras.jsx`; plain text, escaped by React).
* The pack summary e-mail (`backend/emails/pack_emails.py`): rows "Goal" and "Included" in the client's language (ES/EN/CA), HTML-escaped. The data is read from the catalogue pack the client's pack was sold from (`user_plans.catalog_pack_id`). The team copy is in Spanish.

A pack that was sold keeps its price, weeks and type (copied onto `user_plans`); the objective and benefits shown in later e-mails are those the catalogue pack has at that moment.

## Admin form

"New pack" / "Edit": objective with a character counter; benefits list (add, edit, move up / down with buttons, delete with a confirmation when the line has text, maximum 8, counter per line); a read-only block with the calculated totals; a live preview of the card as the client sees it. Errors are shown in the admin's language; the server checks everything again.

## Tests

`backend/test_pack_fields.py` (create with all fields / without them, computed totals, browser totals ignored, every validation, editing an old pack, the client endpoint, the e-mail with and without the fields in ES/EN/CA and escaping) and `src/utils/packFields.test.js` (the same limits in the form).
