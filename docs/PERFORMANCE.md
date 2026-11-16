# Performance: what the landing page downloads, and how it stays small

Measured on the production build, mobile Lighthouse (slow 4G, 4x CPU), same machine and same API before and after:

| | before | after |
|---|---|---|
| entry script (gzip) | 225 kB | 56 kB (+ React in its own cached file, 71 kB) |
| everything `index.html` downloads first, JS + CSS (gzip) | 320 kB | 188 kB |
| first load of the landing page, bytes | 1007 kB | 690 kB |
| of which images / fonts | 389 / 116 kB | 165 / 89 kB |
| Lighthouse score / FCP / LCP / TBT / CLS | 76 / 3.6 s / 4.5 s / 3-21 ms / 0.001 | 82 / 2.5 s / 4.2 s / 0 ms / 0 |

## What was done
- **Entry chunk**: the login, the admin guard, the phone-number library (191 kB), the admin dictionary (130 kB), the legal model texts and the framer-motion animation code are no longer in the code every visitor downloads first (`utils/textValidators.js`, `legal/legalDate.js`, lazy routes in `routes/AppRoutes.jsx`, `LazyMotion` with `components/motionFeatures.js`).
- **Firebase** (`firebase/session.js`): the menu, the roles and the language sync talk to Firebase through a gateway; the SDK is a separate file fetched after the first paint (at once for a browser that has signed in before, or on a private page). Until Firebase says who is signed in, `RolesProvider` stays `loading` and the private routes show their waiting screen. Pages that need a login import `firebase/auth` directly (they are lazy).
- **Chunks** (`vite.config.js`): React, Firebase, FullCalendar and libphonenumber have files of their own (cached between deploys, downloaded only by the routes that use them). The calendar, date picker, phone numbers and the editor are never part of the first load (the budget below checks it).
- **Images**: `npm run optimize:images` makes AVIF and WebP copies (and a 640 px pair for phones) of `public/site-images`; `components/OptimizedPicture.jsx` draws them as `<picture>` with width/height, lazy + async, and the first-screen image eager with `fetchpriority="high"`.
- **Fonts**: `scripts/gen-fonts-css.mjs` now writes `unicode-range` for the Latin and Latin-extended parts, so the extended file is downloaded only when a character needs it. The two fonts of the first screen (Bebas Neue, Inter) and Roboto are preloaded (`vite.config.js`).
- **Cold start**: `<link rel="preconnect">` to the API, `public/early.js` starts the content and prices requests while the JavaScript downloads, the content request is retried while the host answers 502/503/504, and after 3 s the page says "We are waking the server up" (ES/EN/CA, `components/WakeNotice.jsx`).
- **Routes likely to be opened next** (login, register) are prefetched on hover / focus / touch, never with Data Saver or on 2G (`utils/prefetch.js`).

## The budget
`npm run build && npm run check:size` fails when the entry script, the first load or the biggest chunk pass the limits of `scripts/bundle-budget.json` (the measured value + about 15 %), or when the calendar, the phone library, Firebase, the date picker or the editor end up in the first load. It runs in CI after the build.

## Looking inside a build
```bash
STATS_FILE=stats.json npx vite build --config tests/perf/analyze.config.mjs --outDir /tmp/analysis
node scripts/bundle-modules.mjs stats.json assets/index-      # what is in a chunk (sizes before minification)
node scripts/bundle-report.mjs                                  # gzip size of every file and of the first load
```

## Not done
- The text of the three languages (about 26 kB gzip) is one file; loading only the visitor's language would need an asynchronous start of the whole app.
- Images uploaded by the admin are served as they were uploaded (the server does not convert them).
- LCP is the title of the hero: it waits for the site content and its fonts before it is drawn, which was left as it is (it protects the page from showing a fallback font and then changing).
