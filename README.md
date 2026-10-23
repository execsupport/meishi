# Meishi

A mobile-first business card manager on Cloudflare Workers. Open it and write a memo; scan cards with the camera; flick a card to move it along.

Production: https://meishi.orielle.workers.dev

## Features

- Memo box that is focused and usable on first paint, before the app bundle loads (static HTML + `boot.js`). Enter saves an inbox card; memo-only cards (no image) are fine. Works without JavaScript as a plain form POST.
- Full-screen skeleton (card-shaped placeholders with shimmer) while the bundle and data load.
- Flick right to advance (inbox -> follow -> done), left to go back. Left on an inbox card or right on a done card archives it, with a 5-second undo toast. In the archive tab, flick right restores. Threshold, velocity and spring-back physics.
- Long press (or right click, or the context-menu key / Shift+F10) opens an action menu with the same moves, archive/restore, details and vCard: the non-gesture equivalent of a flick. Arrow keys move a focused card.
- Scan: camera input (`capture=environment multiple`) in the memo box, plus a batch import button for several photos from the library. Images are resized on the device to max 1280 px JPEG q0.8, uploaded to `/api/cards/scan`, stored in KV and read by Workers AI. Batches are processed one after another with a progress bar; each result opens in an editable review form. If the model fails, the image is still stored and the form is left for manual entry.
- Duplicate detection before saving a scan: same email (case-insensitive), same phone/mobile (digits only, +81 folded to 0), or same name + company. Choose merge (fills empty fields, appends the memo, adds the image if missing) or save as a separate card.
- Instant local search over name, reading, company, department, title, email and memo (NFKC, case and kana-insensitive). No server round trip.
- CSV export of all cards (UTF-8 with BOM, CRLF, formula-injection safe) and vCard 3.0 per card (iPhone Contacts / Google Contacts).
- AI memo parsing: one button in the detail sheet fills empty name/company/title/email/phone fields from the memo text.
- Statuses: inbox / follow / done / archived, tabs with count badges and a spring underline.
- Google sign-in only. Memos written while signed out stay on the device (localStorage outbox) and move to the account on sign-in in one `POST /api/cards/import`.
- Service worker app shell: repeat visits open instantly and offline.
- Liquid Glass on white, 14-20 px radii, system sans-serif, letter-spacing 0, one dusty-blue accent (#6B8BB5), dusty status pills (gold / sage / rose), SVG icons only.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Hosting / API | Cloudflare Workers + Static Assets (one Worker) | The SPA and the API ship in one deploy and are served from the edge. No cold-start servers; static assets are free. |
| Routing | Hono | About 14 KB, built for Workers, typed context. |
| Database | Cloudflare D1 (SQLite) | Relational data (users, sessions, cards) with a native binding from the Worker. A single atomic `UPDATE ... RETURNING` touching only the sent fields keeps concurrent edits from overwriting each other. |
| Images | Workers KV (binary values, 25 MB limit) | R2 is not enabled on this account (it needs a dashboard step), so KV stands in. Images are resized on the device to about 150-300 KB first. All access goes through the `ImageStore` interface (`src/worker/images.ts`); enabling R2 later means adding one class with `put/get/delete`. |
| AI | Workers AI: vision `@cf/meta/llama-3.2-11b-vision-instruct` (card photo -> JSON), text `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (memo -> fields, JSON schema output) | Runs on Cloudflare's network next to the Worker with no external API key, and handles Japanese. Every call is wrapped with a timeout and a rule-based fallback (email / phone / URL / company / title regexes), so scanning and parsing never dead-end. Model ids were confirmed with `wrangler ai models list`. |
| Auth | Google OAuth 2.0 Authorization Code + PKCE, implemented directly | No auth library or third-party identity service. Server-side sessions in D1 store only a SHA-256 of the token; the cookie is `HttpOnly; Secure; SameSite=Lax`; every write checks `Origin` (CSRF). No login method other than Google. |
| UI | Preact + TypeScript, built with Vite | React-style components at about 4 KB; the whole app is about 24 KB of JS gzipped, so it opens fast on mobile. |
| Motion | Web Animations API + CSS `linear()` spring curves | Real spring physics (sampled from a damped-spring simulation) with zero library weight. Honors `prefers-reduced-motion`. |
| Styling | Plain CSS (backdrop-filter, mask, color-mix) | Liquid Glass (layered blur, specular highlight, refractive rim) is most direct without a framework. |
| Offline / instant open | Service worker (app shell) + localStorage outbox | Instant re-open; memos are never lost offline or signed out. |
| Tests | Playwright: mobile Chromium 390 (real touch via CDP), mobile WebKit (iPhone 14), desktop Chromium 1280 | Exercises the real requirements in real browsers. |

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/google` | Redirect to Google (PKCE). `503 {"error":"google_not_configured"}` until the secrets are set. |
| GET | `/auth/google/callback` | Code exchange, session cookie. |
| GET | `/auth/status` | `{"google": boolean}`; lets the UI show an inline notice instead of a 503 page. |
| POST | `/auth/logout` | |
| GET | `/auth/dev` | Test-only login. Requires `DEV_LOGIN=1` and a localhost host. Never set in production (returns 404 there). |
| GET | `/api/me` | `401 {"error":"unauthorized"}` when signed out. |
| GET / POST | `/api/cards` | List / create. |
| PATCH / DELETE | `/api/cards/:id` | Update sent fields / archive. |
| POST | `/api/cards/:id/restore` | Restore from archive to the previous status. |
| POST | `/api/cards/import` | Bulk move of the signed-out outbox (idempotent by id). |
| POST | `/api/cards/scan` | Multipart `image`; stores it and returns `{imageKey, fields, source}`. No card is created. |
| GET | `/api/images/:key` | Owner only (the key embeds an owner hash and the KV metadata is checked). |
| POST | `/api/ai/parse-memo` | `{text}` -> `{fields, source}`. |
| GET | `/api/export.csv` | All cards, UTF-8 BOM. |
| GET | `/api/cards/:id.vcf` | vCard 3.0. |

## Local development

Requires Node 24 and npm.

```bash
npm install
npm run build
npx wrangler d1 migrations apply meishi --local -c wrangler.test.jsonc
npx wrangler dev -c wrangler.test.jsonc --port 8789
```

`.dev.vars` (not committed):

```
DEV_LOGIN=1
GOOGLE_CLIENT_ID=test-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=test-secret
```

`wrangler.test.jsonc` is `wrangler.jsonc` without the remote AI binding, so the scan and memo-parse endpoints take their rule-based fallback and no Cloudflare login is needed. To try the real models locally, run `npx wrangler dev -c wrangler.jsonc` (needs `wrangler login`).

## Tests

```bash
npx playwright install chromium webkit     # once
npm test                                   # build + all flows, 3 browser projects (23 tests x 3)
REMOTE_AI=1 npm test                       # same against real Workers AI
BASE_URL=https://<worker-host> npm run test:prod   # signed-out smoke test against a deployment, fresh contexts
```

Covered: memo focus before the bundle loads (bundle route blocked), skeleton, dev login, memo -> card, flick right/left with real touch on mobile Chromium, archive + undo, long-press menu, detail edit + AI memo parsing, scan with on-device resize and the AI-less fallback, batch scan with progress, image owner check, duplicate merge / save-as-new, search, CSV and vCard downloads, no-JS form POST, outbox migration on login, logout, Google not-configured notice, CSRF/anonymous refusal, layout at 390 and 1280, no console errors.

## Deploy

```bash
npx wrangler login
npx wrangler d1 create meishi                     # put database_id into wrangler.jsonc (and wrangler.test.jsonc)
npx wrangler kv namespace create MEISHI_IMAGES    # put the id into both configs (binding IMAGES)
npx wrangler d1 migrations apply meishi --remote
npm run deploy
```

Never set `DEV_LOGIN` in production.

## Google sign-in setup

1. Open Google Cloud Console (https://console.cloud.google.com/) and select or create a project.
2. APIs & Services -> OAuth consent screen (Google Auth Platform -> Branding / Audience):
   - User type: External (or Internal for a Workspace-only app).
   - App name `Meishi`, a support email, and a developer contact email.
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (no sensitive scopes).
   - While the app is in Testing, add the Google accounts that may sign in under Test users, or publish the app.
3. APIs & Services -> Credentials -> Create credentials -> OAuth client ID:
   - Application type: Web application. Name: `Meishi`.
   - Authorized JavaScript origins: `https://meishi.orielle.workers.dev`
   - Authorized redirect URIs: `https://meishi.orielle.workers.dev/auth/google/callback`
     (for another host, use `https://<worker-host>/auth/google/callback`; the Worker builds the redirect URI from the request host, so it must match exactly).
   - Create, then copy the client ID and client secret.
4. Store them as Worker secrets (never in the repo):

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

5. Check: `curl https://meishi.orielle.workers.dev/auth/status` returns `{"google":true}`, and `/auth/google` now answers 302 to `accounts.google.com`. Sign in from a private window.

## Decisions and notes

- KV instead of R2 for images (R2 not enabled); swap via `ImageStore`.
- Two file inputs: the camera button in the memo box uses `capture=environment multiple` as specified, but iOS ignores `multiple` when `capture` is set, so the toolbar adds a batch import input without `capture` for picking several photos from the library.
- Duplicate detection runs on the client against the already-loaded cards (no extra query) when a scan is saved.
- When a merge happens and the existing card already has an image, the new image stays in KV unreferenced (there is no delete endpoint in the API contract).
- Closing the scan sheet discards the rest of the queue.
- A non-secret `meishi_auth=1` cookie is set next to the HttpOnly session cookie so a signed-out visit skips the `/api/me` request (no 401 in the console, faster first render). `/api/me` still answers 401 JSON.
- Llama 3.2 Vision needs a one-time license acceptance per account; the Worker sends it automatically on the first `agree` error (already accepted for this account).
- Archive is reversible (`DELETE` archives); there is no hard delete.
