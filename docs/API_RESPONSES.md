# What the API answers (and what it never does)

Rule: **an answer carries the fields the page uses and nothing else.** The routes already built their answers field by field; now each
one is also declared in `backend/response_models.py` and FastAPI filters the answer through that model (`response_model=`). A field
that is not declared never leaves the server, even if a query later selects one more column.

Adding a field a page needs: declare it in `response_models.py` **and** return it from the route. `backend/test_response_leaks.py` fails if:
- an answer to a client, the public, the inbox or a trainer has a key that must never leave (`firebase_uid`, `google_event_id`, `calendar_*` states, `feed_sequence`, `*_by` audit fields, `confirmation_token`, `calendar_feed_token`, `idempotency_key`, `extra_emails`, `file_path`... or any `token`/`url` outside the routes that hand the person their own link);
- anything that belongs to another client appears in what a client receives (their e-mail, phone, address, tax id, uid, tokens, Google event, notes, name);
- the lists of trainers and hours carry contact data;
- a new `GET` route outside `/admin` has neither a model nor an entry in `NO_MODEL` (with the reason).

## Inventory by audience
| Audience | Routes | Fields |
|---|---|---|
| Public | `/trainers`, `/available-trainers`, `/pack-availability`, `/schedule`, `/schedule/{date}`, `/trainer/{id}/available-times/{date}` | trainer **id and name** (`/trainers`: id, name, speciality), hours. The `trainers` table has no e-mail or phone column: nothing of that can leave. |
| Public | `/pricing`, `/features`, `/training-videos`, `/landing-page/content`, `/legal` | catalogue and prices, two switches, videos, the published site content, and the company data of the legal notice (holder, tax id, address, e-mail, phone, registry, DPO, retention periods: public by law) |
| Holder of a link | `/trial-sessions/confirmation/{token}`, `/reschedule-response/{token}` | first name, date, hour, state. No e-mail, phone, token or id |
| Client | `/users/email/{email}`, `/profile/{id}`, `/sessions/user/{id}`, `/client/trial`, `/client/workflow`, `/me/reschedule-requests`, `/me/roles`, `/me/deletion-request`, `/me/calendar-feed` | only the person's own data (the owner is checked from the login) |
| Inbox | `/inbox`, `/inbox/unread-count` | id, kind, type, title, body, date, read, archived, can_archive, actions |
| Trainer | `/me/roles`, `/trainer-area/me/*` | their own numbers; the sessions show a **display name** of the client, the pack name and the hour, never an e-mail, phone or token |
| Admin | `/admin/*` | may carry more (client e-mails, notes), but never keys, credentials or the tokens of links |

## What was removed (they were not used by any page)
| Route | Removed fields |
|---|---|
| `GET /me/reschedule-requests`, `GET /me/reschedule-requests/{id}` and the `request` inside the accept / decline answers | `decided_at`, `requested_trainer_id` |
| `GET /client/workflow` | `user_id`, `plans[].total_price` |

## Left as it is, on purpose
- `admin_note` in the client's reschedule requests: it is the studio's answer **written for the client** (the e-mail carries it too, and the page shows it). It is declared with that comment and is the only route where the key may appear.
- Lists of rows (`/trainers`, `/sessions/user/{id}`): arrays whose select list is fixed in the route.

## Lists and order
A client's lists are capped (`CLIENT_LIST_LIMIT`, default 1000; the newest ones are kept) and ordered by date, time **and id**, so the order never changes between calls: `/sessions/user/{id}`, `/client/workflow` (sessions) and `/me/reschedule-requests`. The admin's pagination is untouched.
