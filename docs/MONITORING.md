# Monitoring of the site (errors, alerts, keep-alive)

Everything works with what already exists: the backend, the database, the admin and the team's e-mail. No external service, no new account.

## What is kept, and what never is

Table `app_errors` (`backend/monitoring.py`): **one row per KIND of error**. A repeated error only raises `count` and `last_seen`; it never adds a row.

| Kept | Never kept |
|---|---|
| where it came from (server or website), the **type** of the error, function, file and line (server), the **pattern** of the route (`GET /admin/clients/{client_id}`), the answer code, the release of the site, a short message that went through `scrub` | bodies of requests, headers, tokens, e-mails, names, phones, query strings, values of variables, stack traces, the address with ids |

`scrub` removes e-mails, long tokens and JWTs, phone numbers, addresses, quoted values and the text `Failing row contains (...)` of PostgreSQL before anything is written. Noise is ignored: 401, 403, 404, 422 and 429, and the client going away. Recording happens in a background worker and every failure of the monitoring is swallowed: the site works the same if it is broken.

Limits: at most **500** kinds of error (the oldest *resolved* leave first; if all are unresolved new ones are ignored in silence) and *resolved* ones are deleted after **30 days** by the daily job of `data_retention.py` (the same one, with its lock).

## Where the errors come from

* **Server**: the global handler (`main.py`) records every unexpected exception (500) and every 5xx answered on purpose (502, 503...).
* **Website**: when a page crashes, `AppErrorBoundary` (public site) and `AdminErrorBoundary` (admin) call `POST /client-errors/report` (public, no token) with the minimum: type, short message, page pattern, release. The body is at most 2 KB (also without Content-Length), no extra field is accepted (422), at most 10 reports per 10 minutes per address (shared in the database) and repeated reports are deduplicated. A new version loading (`ChunkLoadError`...), cancelled requests, browser extensions and third-party scripts are not reported. If the table is full the report is ignored with the usual 204.

## Admin > Estado del sistema

The list of errors (type, where, how many times, first and last time, server or website), the filter by state (new / seen / resolved), buttons to mark one as seen or resolved (or reopen it), and a summary at the top: new errors in the last 24 hours and the last error. The Overview shows a discreet line only when there are new errors in the last 24 hours. Admin only (`/admin/system-errors`). A resolved error that happens again goes back to *new*.

## E-mail alerts (TEAM_NOTIFICATION_EMAILS, in Spanish)

* **One summary a day at most**, with the kinds of error that are new since the last one. Nothing new, nothing sent.
* **An immediate alert only for a spike**: more than 20 answers 5xx in 10 minutes, at most one every 6 hours.
* They only carry types, places and counts. `MONITOR_EMAILS=off` switches both off.

## Variables

| Variable | Meaning |
|---|---|
| `MONITOR_EMAILS` | `off` = no alert e-mails (the page keeps working). Default: on. |
| `KEEP_ALIVE` | `off` = no internal keep-alive. Default: on in production (see `RENDER_KEEP_AWAKE.md`). |
| `RENDER_EXTERNAL_URL` | Set by Render itself: the public address the keep-alive asks. Not needed in development. |
| `RENDER_GIT_COMMIT` | Set by Render itself: the release shown next to each error. |

## Health

* `GET /health`: light, no database (wakes the service, used by the site).
* `GET /health/ready`: asks the database too (2 s timeout). `200 {"status": "ok"}` or `503 {"status": "degraded"}`, no detail, at most 30 per minute per address.

## After a new version (white screen)

`vercel.json` no longer answers `/assets/*` or any path with a file extension with the app: a missing file is a real 404, so a page that was open when a new version was published gets an error instead of HTML where it expected JavaScript. `AppErrorBoundary` then reloads the page **once per session** (guarded by `sessionStorage`, so it can never loop) to pick up the new version. Hashed files under `/assets` are cached for a year (`immutable`) and the HTML is `max-age=0, must-revalidate`.
