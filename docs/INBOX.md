# Client inbox (backend)

A channel PARALLEL to the e-mails: nothing here replaces or changes an e-mail, and a failure here never breaks the
operation that caused it (`create_system_message` and the `on_*` helpers catch everything and log without personal data).
Code: `backend/inbox.py`, texts `backend/inbox_texts.py`, tests `backend/test_inbox.py`.

## Tables (created at startup, idempotent)
- `inbox_messages`: `kind` admin | system, `type`, admin text (`title`, `body`, `translations`, `main_lang`, `audience`,
  `action_label`, `action_target`) or system (`template_key`, `params`, `refs`, `dedupe_key` UNIQUE), `visible_from`,
  `expires_at`, `created_by`, `idempotency_key` UNIQUE, `deleted_at`.
- `inbox_recipients`: `message_id`, `user_id` (empty until the person has an account), `recipient_email`, `read_at`,
  `deleted_at` (the client's own delete). Unique (message_id, user_id) and (message_id, recipient_email).
- `inbox_audit`: who deleted which message and when (no personal data).
- `visible_from` / `expires_at` are Europe/Madrid wall-clock times. No cron: "send later" is a filter at read time.

## Who receives
`all` = every client not archived, never the admin account; `active_pack` = the same with an active pack; `user` = one
client by e-mail. Worked out when the studio sends or schedules. Archived clients never receive anything.
**Active pack** = `pack_view.has_active_pack` / `pack_view.active_pack_sql`: the dashboard's definition (a pack that is
active, or that still has sessions to come).

## Automatic messages (one function: `inbox.create_system_message`)
Called, after the commit, from the functions that already concentrate each operation:
`trial_confirmation.approve_trial`, `trial_confirmation.answer_trial` (confirm / decline, used by the e-mail page AND the
inbox), the pack creation paths in `main.py` (approve a request, renew, Asignar plan) and `client_accounts.py` (new client
with pack), `reschedule_requests.approve | reject | counter | admin_reschedule`, and the studio cancelling a session
(`DELETE /sessions/{id}` by the admin). Duplicates are impossible (`dedupe_key`: type + refs + state).
Types: trial_approved, trial_confirmed, trial_declined, pack_approved, reschedule_approved, reschedule_rejected,
reschedule_counter, session_cancelled, session_rescheduled. The client accepting a proposal moves the session but writes
no message (the client did it).

## Buttons inside a message
`trial_approved` (confirm, decline), `reschedule_counter` (accept, reject), `pack_approved` (link to /my-sessions), and the
optional link of a studio message. The state is read LIVE from the trial session / the request: `available`, `done`
(answered by any channel, e-mail link included) or `expired`. Once an answer button is `done`, `action.result` says WHAT was answered (confirmed | declined for a trial session,
accepted | declined for a proposal), read from the real object. A message with an `available` answer can not be deleted by the
client. Trial buttons need the VERIFIED sign-in e-mail to be the booking's e-mail (403 `use_booking_email`).

## Linking messages to a later sign-up
`GET /inbox` and `GET /inbox/unread-count` fill `user_id` of the rows waiting for the e-mail of the signed-in person, only
when Firebase says `email_verified`.

## Endpoints
Client (ID token): `GET /inbox?lang=&page=&filter=all|unread&size=`, `GET /inbox/unread-count`, `POST /inbox/{id}/read`,
`POST /inbox/read-all`, `DELETE /inbox/{id}`, `POST /inbox/{id}/actions/{trial_confirm|trial_decline|reschedule_accept|reschedule_reject}`.
`{id}` is the recipient row's id. Pages are capped (50) and every route is rate limited per person (429).
Admin (ID token + administrator): `POST /admin/messages/preview`, `POST /admin/messages`, `GET /admin/messages`,
`GET /admin/messages/{id}`, `DELETE /admin/messages/{id}` (soft delete, idempotent).
`GET /admin/messages` takes `page`, `size`, `q` (title, % and _ literal) and `status` (scheduled | sent | expired); each item has
`person` (the e-mail, only for a message to one person) and the detail lists `read_at` of that person. The button's text
can be translated: `translations.<lang>.action_label` (the written `action_label` is the fallback; ignored without a button). Title up to 120, text up to 2000,
plain text (HTML refused), button destination = one of `/my-sessions /profile /dashboard /trial-session /training-request
/training-tips` or an http(s) address.

## Cleanup
Lazy: reading the inbox removes, at most once an hour per process, the messages that expired more than 90 days ago.
Deleting a client also removes the inbox rows for their e-mail.
