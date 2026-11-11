# Pack creation: order of operations and when the client is notified

Every flow that creates a pack (create client + pack, new pack on an existing client, approve a request) works in this order: **validate, commit, create the Google events, notify**. `packs.create_pack` only validates (client, trainers, plan, schedule, conflicts) and writes the database rows, with each session marked `calendar_sync_status = 'pending'`; it never calls Google. The endpoint commits (for a new client that includes creating the login account, so a duplicate email is refused before anything is written) and only then calls `packs.publish_calendar`, which creates the events through the single rule in `calendar_sync.sync_sessions_to_google`. That is the first and only moment a guest can be invited, so nothing that can still fail happens after an invitation went out. If creating the events fails part-way, the events already created are **not** deleted: each session records `ok` or `failed` (with the reason) and "Sincronizar con Google" repeats what is missing. The client is notified by Google only by invitations created after the commit (and only when `SEND_CALENDAR_INVITE_EMAILS=all`) and by the pack summary email, which is sent last. Deleting an event is silent (`sendUpdates=none`) in every rollback, clean-up or internal cancellation; only a cancellation the admin or the client asked for (a cancelled session, a declined trial) goes through `delete_calendar_event(event_id, notify=True)` and can send a cancellation email.

## Refusing an email that already exists (`POST /admin/clients`)

| Situation | Answer |
|---|---|
| The email already belongs to a client | `409`, `code: client_exists`, `existing_client_id`, "Este email ya es un cliente. Abre su ficha y crea el pack desde ahí." The pack is never attached automatically and the client is never duplicated: the admin opens the profile and uses "Nuevo pack". |
| A login account with that email exists but there is no client | `409`, `code: login_exists`. Nothing is created. |

Both are decided before any database write and before any call to Google, so they never send an email.
