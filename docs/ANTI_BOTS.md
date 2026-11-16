# Anti-robot challenge (proof of work)

The public forms that create something are protected by a small calculation the visitor's browser does by itself, in the background.
No account, no cookie, no tracking, no third party: nothing about the visitor leaves our own server (GDPR).

## What it protects
| Route | When the challenge is required |
|---|---|
| `POST /trial-sessions` | always |
| `POST /contact-messages` | always |
| `POST /users` (first profile) | only when the profile does **not** exist yet; whoever already has one signs in without it |

Not touched: login, password recovery and the direct Firebase registration (they never reach this backend), nor the normal logged-in routes.
A refused request answers `400` with `{"detail": {"code": "challenge_failed", "reason": ...}}` (`missing`, `invalid`, `expired`, `used`, `too_fast`).
The honeypot field stays (a robot that fills it is told it worked and nothing is stored).

## How it works
1. `GET /challenge` → `{id, salt, challenge, max, iat, exp, sig}`. The server picks a secret number `N` (0..`max`), sends `SHA-256(salt + N)` and signs the fields with HMAC-SHA-256. It stores nothing.
2. The browser finds `N` by trying 0, 1, 2… (in a Web Worker of the site: `worker-src 'self'`, no `blob:`), and sends the challenge plus `number` (base64url JSON) in the `challenge` field of the form.
3. The server checks the signature, the expiry (10 minutes), that `SHA-256(salt + number)` is the challenge, and that the id was never used (table `challenge_used`, cleaned when expired). **Every solution works once.**
4. A solution younger than 2 s is answered `too_fast`: it is not used up and the same solution is accepted a moment later (a person cannot fill a form that fast; the site simply waits 2.5 s before sending, so a real visitor never sees it).
5. The check runs after the form is valid (a typo does not use up the solution) and before anything is stored.

Difficulty: `max` = 100 000 tries (average 50 000: about 50 ms on a computer, a few hundred ms on a phone). It doubles for every 10 challenges the same IP asks for in 10 minutes (up to ×16) and `GET /challenge` answers `429` beyond 120 per IP per 10 minutes. The IP is `web_safety.get_client_ip`.

## The secret key
`CHALLENGE_HMAC_KEY` (or `ALTCHA_HMAC_KEY`) in the environment, if set. Otherwise a strong random key is generated on the first start and kept in the table `app_secrets` (created idempotently). It is never logged and no route returns it. **No manual configuration is needed.**
Changing the key only invalidates the challenges in flight (visitors get a new one automatically).

## Why not Altcha
Altcha would be one more dependency and a widget that uses a blob worker (it would need `worker-src blob:` in the CSP). The same idea is ~150 lines here, with a plain Worker file, and the policy only gains `worker-src 'self'` (which also tightens it: before, workers fell back to `script-src`, that lists external hosts).

## In the frontend
`src/challenge/`: `useChallenge` (states idle / checking / ready / error / unsupported), `ChallengeStatus` (a `role="status"` line, "Retry" is a real button), `sendWithChallenge` (sends the form; if the server refuses the challenge it gets a new one and sends again, three tries at most). Registration solves it **before** creating the Firebase account, so a failure never leaves a half-created account. Texts in ES/EN/CA (`ch_*`); without JavaScript the `<noscript>` of `index.html` says so.

## Tests
`backend/test_challenge.py` (secret, signature, expiry, single use, too fast, rate limit, the three forms), `src/challenge/challenge.test.js` (SHA-256 against Node's, retries), `src/challenge/ChallengeStatus.spec.jsx` (states and keyboard).
The rest of the backend suite posts to the forms without a challenge: it sets `CHALLENGE_ENFORCE=0` (CI does). That variable is **ignored unless the database is on this computer**, so it can never open the forms in production.
