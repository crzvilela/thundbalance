# Language of the e-mails

**Every e-mail to a client is written in ONE language: the client's** (`en`, `es` or `ca`): subject, title, body, buttons,
notices, footer, weekdays, months and dates, the plain-text version and `<html lang>` / `Content-Language`.
No e-mail puts two languages together ("ES / EN") any more. E-mails to the team (pt@) are Spanish only, unchanged.

## Which language is used (`backend/client_lang.py`, `resolve_client_lang`)

1. the language saved with the booking / request itself (`trial_sessions.lang`, `reschedule_requests.lang`), if it has one;
2. `users.lang`, the language the client has on the site;
3. English.

The language of the admin panel is never used. A text missing in a language is shown in English and a warning
(`Email text missing: key=… lang=…`, no personal data) goes to the log.

## Where `users.lang` comes from

* The site sends it (`PUT /me/language {lang}`, Firebase token, only the client's own row) when a signed-in client changes the
  site language and when they sign in (`src/components/LanguageSync.jsx`: once per account and language, silent, never blocks).
* The admin chooses it in **Nuevo cliente → Idioma del cliente** (default **Spanish**) and it is saved in the new profile.
* Old clients keep `NULL` until they next sign in; until then they receive English.

## Texts

`backend/emails/texts.py` (+ `reschedule_texts.py`): `TEXTS_EN`, `TEXTS_ES`, `TEXTS_CA`. Add a text to the three.
`test_client_emails.py` fails if a text a client e-mail uses is missing in any language, or if a subject or a button holds
two languages. Texts only the team reads (`staff_*`, `rs_staff_*`) exist in Spanish only.

## Check them by eye

```
python preview_emails.py            # backend/email_previews/client-<email>-<en|es|ca>.html (+ .txt)
python send_test_email.py you@example.com ca
```
