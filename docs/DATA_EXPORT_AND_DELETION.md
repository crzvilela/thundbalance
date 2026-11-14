# Export of a client's data and request to delete the account

The right of access (a copy of one's data) and the right to erasure. The complete deletion itself is described in `DATA_RETENTION.md` (`backend/client_erasure.py`); this page is about how a client asks for it and how the studio answers.

## What the client can do (Profile > "Mis datos")

* **Download my data**: `GET /me/export` returns one JSON file (`thundbalance-datos-AAAA-MM-DD.json`, `Cache-Control: no-store`), at most 3 times per hour per client (`429 too_many_exports` after that).
* **Request deletion of my account**: after a clear warning and a confirmation, `POST /me/deletion-request` creates a request. **Nothing is deleted**: the studio reviews it. The client sees its state (`GET /me/deletion-request`: pending, completed or rejected, with the reason when it was rejected) and is told the answer takes at most 30 days. A client has at most ONE pending request; asking again while it is pending changes nothing.
* The admin account has no "Mis datos" (it cannot be deleted from here).

Both routes need a valid login and a **verified e-mail** (`email_not_verified` 403 otherwise: the site then shows its verification screen). The person is found through the login id in the token; no id sent in the request is ever read, so nobody reaches another person's data.

## What the export holds

Profile (name, e-mail, phone, country, city, address, postal code, tax id, language, creation date) and the profile photo (a file of ours is embedded, a Google photo is a link); packs and their history (plan, type, dates, sessions per week, trainer name, prices, the second person and extra addresses the client gave); sessions; pack requests; reschedule requests (including the studio's note about the request); the inbox messages addressed to the client; the contact messages and trial sessions made with their e-mail; and the list of e-mails sent to them (type, date, state, language: the subject and the text are not stored).

It **never** holds: data of other clients, the login id, the calendar feed token or any other token, the ids of calendar events, the uid of the admin who handled something, the audit log, or any configuration (a test checks the forbidden names and values).

## What the admin does

* **Export a client's data** (when the client asks by e-mail): Clients > the client > **Exportar datos** (`GET /admin/clients/{id}/export`, the same JSON). It is recorded in `admin_audit_log` (the action, the client's number and the admin's uid shortened to 6 characters: no personal data).
* **Solicitudes de eliminación**: on the Overview, a list of the pending requests (it only appears when there are any; `GET /admin/deletion-requests`). The team also gets an e-mail (TEAM_NOTIFICATION_EMAILS) with the client's name and the date only.
  * **Aprobar** (asks "¿Seguro?"): `POST /admin/deletion-requests/{id}/approve` runs the complete deletion of `client_lifecycle.perform_delete` (calendar events, database rows, photos, Firebase account, profile; packs stay anonymized) and marks the request completed. If a step cannot finish (the calendar or Firebase did not answer), the answer is the usual `delete_incomplete` 502, the request stays pending and approving again continues the deletion. The admin's own account is never deleted.
  * **Rechazar**: `POST /admin/deletion-requests/{id}/reject` needs a short reason (up to 200 characters, no `<` or `>`); the client sees it. Nothing is deleted.
  * Both are recorded in `admin_audit_log` (the action and the request number; the reason is not copied there).

## How to answer a client's request by e-mail

1. **A copy of their data**: open the client, press **Exportar datos** and send them the file through a safe channel (the file holds personal data). Answer within one month.
2. **Deletion**: ask them to use "Solicitar eliminación de mi cuenta" in their profile (or, if they cannot, delete the client yourself with the usual "Eliminar cliente"). When the request arrives, check that it is really theirs and that nothing keeps you from deleting (an unpaid pack you must record, a dispute), then approve or reject with a reason. Answer within one month.

## Technical notes

`backend/privacy.py` (export, requests, routes), the table `deletion_requests` (`id, user_id, created_at, status pending | completed | rejected, handled_by, handled_at, reason`; one pending request per client through a partial unique index; created idempotently at startup), the e-mails in `backend/emails/privacy_emails.py`, tests in `backend/test_privacy.py` and `src/utils/downloadFile.test.js`. Nothing in it writes an e-mail address, a name or exported content to a log.
