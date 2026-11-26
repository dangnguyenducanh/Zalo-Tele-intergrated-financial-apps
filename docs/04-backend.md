# 4. Backend (Express 5 on Vercel)

*Parts marked planned (§2.10, §2.11, §2.12) are not built yet. Each build PR updates the planned sections in the docs its card's Scope lists; where a card's Scope doesn't list them (T32), the orchestrator opens a docs-only follow-up PR after the merge.*

## 4.1 How the API runs

- `server/src/app.js` builds and **exports** the Express app. It never calls `listen`.
- `api/index.js` re-exports that app, so Vercel turns it into **one Vercel Function** (Fluid compute, Hobby limit 300 s per invocation).
- `server/src/local.js` calls `app.listen(env.PORT)` (default 4100) for local development. The Vite dev server proxies `/api` to it.
- `vercel.json` routes `/api/*` to the function and everything else to the SPA (see [06-deployment.md](06-deployment.md)).

**Middleware order** (`app.js`, then `routes/index.js` under `/api`):

```text
trust proxy 1 → helmet → express.json({ limit: '1mb' }) → cookie-parser → requestId/logger
→ /api/health       (pings the DB itself, before connectDb)
→ connectDb
→ /api/auth → /sessions → /users → /wallets → /categories → /transactions → /budgets
  → /stats → /chat-links → /receipts → /webhooks → /admin
→ notFound (404) → errorHandler
```

- There is no global `requireAuth`. Each protected router applies it itself, so an unknown top-level path still answers 404 (an unknown sub-path of a protected router, such as `/api/wallets/x/y`, answers 401 without a token). `connectDb` runs before every `/api` router except `/health`, so with the database down any other `/api` path answers 500. `/admin` adds `requireRole('admin')`; `/webhooks` checks the platform's secret header instead of a JWT; `/auth` protects only `/auth/me`.
- Only `/auth/login` and `/auth/register` are rate-limited (plus `POST /chat-links/code`, see §4.3).
- `/webhooks/whatsapp` checks an HMAC signature of the raw body instead of a secret header (§2.10.4). The HMAC needs the exact bytes Meta sent, and re-serialising `req.body` does not give them back, so the global parser is `express.json({ limit, verify })`, where `verify` keeps the bytes as `req.rawBody` only when `req.originalUrl` starts with `/api/webhooks/whatsapp`. The order above does not change.
- *Planned (§2.11):* two new routers. `/assistant` (`routes/assistant.js`) applies `requireAuth` itself. `/cron` checks `Authorization: Bearer ${CRON_SECRET}` with the existing `sameSecret()` instead of a JWT, like `/webhooks`. Admins also get `POST /admin/cron/daily` inside `/admin`. Where the two routers sit in the order above is left to the builder; both come after `connectDb`.
- *Planned (§2.12.1):* `/auth/register`, `/auth/register/resend` and `/auth/password/forgot` also get `mailRateLimit` (see §4.3).

## 4.2 Configuration

`server/src/config/env.js` validates `process.env` with zod at startup. It fails fast (naming the variables, never their values) only when `MONGODB_URI` or `JWT_ACCESS_SECRET` (≥ 32 chars) is missing, or a variable that is set has a malformed value. Everything else is optional, so the API boots without it:

- no `KIE_URL` → `POST /receipts` answers 503 `FEATURE_NOT_CONFIGURED` for a valid JPEG/PNG upload (the missing-field 400 and the 415 come first; the bots say the receipt reader is not answering);
- no webhook secret → that platform's webhook answers 401 to everything;
- no `TELEGRAM_BOT_USERNAME`, `WHATSAPP_NUMBER` or `ZALO_BOT_URL` → that app's entry in the link code's `links` is `null`, and the web link card hides the app.
- if any of the WhatsApp webhook settings `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` is unset, the WhatsApp webhook is disabled: `GET` and `POST /webhooks/whatsapp` answer 503 `FEATURE_NOT_CONFIGURED` and process nothing, and `links.whatsapp` is `null` (even with `WHATSAPP_NUMBER` set), so the link card hides WhatsApp. Unlike Telegram and Zalo (401 without their secret), an unset setting is not treated as a failed check (`whatsappConfigured()` in `config/env.js`; the error handler logs each such 503 like any 5xx);
- *planned (§2.11.6):* each agent variable is optional and a missing one turns its feature off, as with KIE. Without `AGENT_URL` or `AGENT_SECRET`, Express never calls the agent service: questions in chat and in the drawer get the help text with the plain commands, receipts go to KIE whatever `RECEIPT_READER` says, and a Khác/Other draft gets no suggestion. `ASSISTANT_ENABLED` and `ASSISTANT_CHANNELS` only open or close the model gate (§4.11); pipeline skills answer either way. Without `CRON_SECRET`, `sameSecret()` fails every call, so `GET /cron/daily` answers 401, as a webhook does without its secret (§2.11 names no status for this);
- *built, T35 (§2.12.4):* mail is on only when both `GMAIL_USER` and `GMAIL_APP_PASSWORD` are set. Without them in development and test, `sendCode` writes the code to the server log (`[mail] signup code for a***@gmail.com: 123456`) instead of sending it. Without them in production, `sendCode` rejects and `canSendCodes()` is false. Nothing calls the mailer yet, so no endpoint changes. *Planned:* without them in production, `POST /auth/register` answers as today (201, logged in, no code) and `POST /auth/password/forgot` answers 503 `FEATURE_NOT_CONFIGURED`. What `register/verify`, `register/resend` and `password/reset` answer then is not stated in §2.12.

An empty value (`KIE_URL=`) counts as unset. Under `NODE_ENV=test` the required variables and the `APP_URL`, bot and KIE variables get harmless defaults, so the test suites run without `server/.env` (`MONGODB_DB` and the `SEED_*` variables stay unset). `GMAIL_USER` and `GMAIL_APP_PASSWORD` get **no** default, because a default would turn mail on in every suite; the Vitest setup file (`test/helpers/no-gmail.js`) also deletes both from the environment before each test file.

| Variable | Example / rule |
|---|---|
| `NODE_ENV` | `development` (default) \| `test` \| `production`; the `rt` cookie is `Secure` only in `production` |
| `MONGODB_URI` | `mongodb+srv://…/finance?retryWrites=true&w=majority` |
| `MONGODB_DB` | optional; overrides the database name (each agent worktree uses `finance_wt<n>`, set by `tools/wt-env.sh`) |
| `PORT` | local API port, default 4100 (worktrees: `4100+10n`; Vite uses `VITE_PORT`, `5300+10n`) |
| `JWT_ACCESS_SECRET` | ≥ 32 random bytes (`openssl rand -hex 32`) |
| `ACCESS_TOKEN_TTL` | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | `7` |
| `APP_URL` | `https://<project>.vercel.app`, must be a URL (used in bot links; Telegram's ✏️ button only when it is `https://`) |
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_BOT_USERNAME` | for deep links |
| `TELEGRAM_WEBHOOK_SECRET` | 1–256 chars `[A-Za-z0-9_-]` |
| `ZALO_BOT_TOKEN` | from Zalo Bot Platform |
| `ZALO_WEBHOOK_SECRET` | 8–256 chars |
| `ZALO_BOT_URL` | the Zalo bot's share link from Zalo Bot Creator (the link card's "Copy & open Zalo"): an `https://` URL of at most 106 bytes, what the card's QR code holds |
| `WHATSAPP_NUMBER` | the WhatsApp bot's number in international format, digits only (6–15, no `+` or leading 0), for `wa.me` links |
| `WHATSAPP_ACCESS_TOKEN` | permanent (system user) access token of the Meta app; sends messages and downloads receipt photos. Sent only in the `Authorization` header |
| `WHATSAPP_PHONE_NUMBER_ID` | the business number's ID in the Graph API messages URL; digits only (at most 30), because it becomes a path segment |
| `WHATSAPP_APP_SECRET` | key of the `X-Hub-Signature-256` HMAC on webhook `POST`s |
| `WHATSAPP_VERIFY_TOKEN` | compared with `hub.verify_token` in the webhook's `GET` setup check |
| `AGENT_URL` *(planned, §2.11)* | `https://<tunnel-host>` of the agent service, must be a URL; its value comes from `AGENT_PUBLIC_URL` on the GPU host, like `KIE_URL` from `KIE_PUBLIC_URL` |
| `AGENT_SECRET` *(planned)* | `openssl rand -hex 32`; sent as `Authorization: Bearer …`; the same value is in `agent/.env` (§4.11) |
| `RECEIPT_READER` *(planned)* | `kie` \| `qwen`, default `kie` until the receipt eval passes (§4.8) |
| `ASSISTANT_ENABLED` *(planned)* | `true` \| `false`, default `false`; the model gate's ceiling, and the runtime switch's value while `appSettings` has no row |
| `ASSISTANT_CHANNELS` *(planned)* | comma list, default `web,telegram,zalo,whatsapp` |
| `CRON_SECRET` *(planned)* | sent by Vercel Cron as `Authorization: Bearer …`; checked with `sameSecret()` |
| `GMAIL_USER` | optional e-mail address of the Gmail account that sends the codes (§2.12); a space or newline around it is dropped, and only whitespace counts as unset. Set only in the Vercel dashboard of both projects, never in `server/.env` (decision D8, docs/06 §6.14) |
| `GMAIL_APP_PASSWORD` | optional; a 16-character Google app password (2-Step Verification must be on); every whitespace character is removed, so it can be pasted as Google shows it; changing the Google password revokes it. Same rule: dashboard only |
| `KIE_URL` | `https://<tunnel-host>`, must be a URL |
| `KIE_API_KEY` | shared secret sent as `X-KIE-Key` (see §4.8) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | used by `npm run seed` and `npm run seed:test` only |
| `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD`, `TEST_USER_B_*` | used by `npm run seed:test` only (test users A and B) |

**DB connection on serverless:** `config/db.js` keeps a module-level cached `mongoose.connect()` promise, so warm invocations reuse one connection (a failed connect is forgotten, so the next request retries). It also calls `attachDatabasePool(mongoose.connection.getClient())` from `@vercel/functions` so idle connections are released properly under Fluid compute. Every router after `/health` awaits `connectDb()` through a tiny middleware; if MongoDB is unreachable that request answers 500 `INTERNAL` (only `/health` answers 503).

## 4.3 Authentication and authorization

| Piece | Design |
|---|---|
| Password hashing | `bcryptjs`, cost **10**. Min length 8 characters, max **72 bytes** in UTF-8: bcrypt ignores every byte after the 72nd and a Vietnamese letter takes 2–3 bytes, so register and password change count bytes, not characters (BUG-009). Hashes never leave the server (`select: false`). |
| Access token | **JWT HS256**, 15 min, claims `{ sub: userId, role, sid: sessionId }`. Sent as `Authorization: Bearer <jwt>`. Verified with `algorithms: ['HS256']`. |
| Refresh token | 32 random bytes (base64url). Sent only as cookie **`rt`**: `HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=REFRESH_TOKEN_TTL_DAYS` (7 d), plus `Secure` when `NODE_ENV=production`. Stored only as a SHA-256 hash in `sessions`. |
| Rotation | Every `/auth/refresh` revokes the old session row, creates a new one (`replacedBy`), and sets a new cookie. |
| Reuse detection | If a refresh token belonging to an **already rotated** session is presented, all of that user's sessions are revoked (the token was probably stolen) → 401. **Grace window (BUG-003):** if it comes back within **30 s** of its rotation and its replacement has never been refreshed, the answer was most likely lost (navigation, reload, network drop), so the unused replacement is revoked and the token is rotated once more (200). One valid chain remains, and a reuse after the replacement was refreshed, or after 30 s, is still treated as theft. **Revoke all wins races (BUG-006):** revoking every session first stamps `users.sessionsRevokedAt`; a refresh that was rotating at the same moment checks that stamp (and the account status) after opening its new session. If every session was revoked after the login that began its chain (`sessions.chainStartedAt`), it revokes the new session and answers 401 `INVALID_REFRESH`, or 403 `ACCOUNT_LOCKED` when the cause was an admin lock. |
| Logout | Ends this device's rotation chain, clears the cookie → 204. **Wins races (BUG-010):** every row of the chain gets `sessions.chainEndedAt` first, then its live row is revoked; a refresh of this device that was rotating at the same moment sees the mark after opening its new session and revokes it (401). Logging out one device from Settings (`DELETE /sessions/:id`) does the same. |
| Log out others | Revokes all sessions except `sid` → 204, like a revoke-all (BUG-010): the kept session's `chainStartedAt` is moved just past the time of the `users.sessionsRevokedAt` stamp, the stamp is written, then the other sessions are revoked, so a refresh racing it on another device dies too. A password change does the same. If this device's own refresh runs in that same instant, it is logged out too: the race fails safe. |
| Login wins races (BUG-040) | Login reads the user, checks the password with bcrypt (slow) and then opens its session, so a password change or an admin lock can land in between, after the revoke has already run and could not see this session. After creating its session, login reads the user again: if `passwordHash` is no longer the hash it checked, it revokes the new session and answers 401 `INVALID_CREDENTIALS`, as a fresh login with the old password would; otherwise, if the account is now locked, it revokes the new session and answers 403 `ACCOUNT_LOCKED`. "Log out others" does not change the hash, so a login overlapping it stays valid: its password is still right. |
| Lock user (admin) | `status = locked` + revoke all sessions. The bots refuse the user's messages and buttons with a "locked" reply (except `/start CODE` and `/link CODE`, which are answered before the lock check). Login returns 403 `ACCOUNT_LOCKED` only after a correct password (a wrong one stays 401). Refresh returns 403 `ACCOUNT_LOCKED`: refresh checks the owner's status for any stored token, also one the lock already revoked, before the reuse check (BUG-011); an unknown token stays 401. Existing access tokens expire within 15 min. |
| `requireAuth` | Verifies the JWT, sets `req.user = { id, role, sid }`. Missing or invalid → 401 `UNAUTHENTICATED`; expired → 401 `TOKEN_EXPIRED` (the client then refreshes). |
| `requireRole('admin')` | `req.user.role !== 'admin'` → 403 `FORBIDDEN`. |
| Ownership | Services always query `{ _id, userId: req.user.id, deletedAt: null }`. Not found → 404 (never reveals other users' data). |
| Brute force | `express-rate-limit` on `/auth/login` and `/auth/register`: 10 **failed** attempts per 15 min per IP (`skipSuccessfulRequests`, so normal logins from a shared IP never count), then 429 `RATE_LIMITED`. `POST /chat-links/code` allows 5 codes per user per 10 min. On serverless the counters live in each instance's memory, so these are best-effort guards. *Planned (§2.12.1):* `mailRateLimit` beside `authRateLimit` allows 10 code emails per IP per 15 minutes across `register`, `register/resend` and `password/forgot`, and counts successful requests too (no `skipSuccessfulRequests`), because too many mails to fake addresses make Google stop the Gmail account. In memory per instance, like `authRateLimit`. |
| Email codes *(planned, §2.12.1)* | 6 random digits (`crypto.randomInt`), single use, valid 10 minutes, stored only as SHA-256 and compared with `timingSafeEqual`. 5 wrong tries kill the code. Per address: a new send not before 60 s after the last one and at most 5 sends an hour; a resend replaces the code. Rows in `emailCodes` ([03-database.md §3.8](03-database.md)). |
| Pending sign-up *(planned, §2.12)* | Register creates no user, only an `emailCodes` row; the right code creates the user. So login, refresh, sessions, `requireAuth` and the bots do not change. |
| CSRF | Only the refresh endpoint uses the cookie. `SameSite=Strict` + same origin + POST-only stops cross-site use. All other endpoints use the Bearer header. |

Idea credit: ezBookkeeping stores every login as a `token_record` row so logout and revocation are real. Here that becomes the `sessions` collection with JWT access tokens.

## 4.4 REST API reference

All paths are prefixed with `/api`. Bodies are JSON unless noted. 🔒 = needs JWT, 👑 = admin only.

### Auth and sessions

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| POST | `/auth/register` | — | `{name, email, password, language?}` | **201** `{accessToken, user}` + cookie. *Planned (§2.12.2):* with mail on, **202** `{email: "a***@gmail.com", resendAfter: 60}`, no cookie and no token; the `emailCodes` row keeps the name, language and bcrypt hash, and the code is mailed (the send is awaited). Registering again while a code is live replaces them and counts as a send. With mail off in production, 201 as today | 400, 409 `EMAIL_TAKEN` (no mail), 429. *Planned:* 429 `RATE_LIMITED` also within 60 s of the last send or past 5 sends an hour (`details.retryAfter`, seconds) and from `mailRateLimit`; `EMAIL_SEND_FAILED` (503: Gmail refused; the row is deleted) |
| POST | `/auth/register/verify` *(planned, §2.12.2)* | — | `{email, code}` | **201** `{accessToken, user}` + cookie, exactly as register today: the row is deleted, the user is created with the stored hash and `onUserRegistered()` seeds the wallet and categories | 400; `CODE_INVALID` (400, `details.attemptsLeft`); `CODE_EXPIRED` (400: no live code, or out of tries); 409 `EMAIL_TAKEN` (registered meanwhile) |
| POST | `/auth/register/resend` *(planned, §2.12.2)* | — | `{email}` | **202** `{resendAfter: 60}`, the same whether or not a sign-up is pending; a new code replaces the old one | 400, 429 `RATE_LIMITED` (too early or over 5 an hour, `details.retryAfter`; or `mailRateLimit`) |
| POST | `/auth/password/forgot` *(planned, §2.12.3)* | — | `{email}` | **202** `{resendAfter: 60}` always, whether or not the account exists. Only for an existing **active** user is the `reset` row upserted and the code sent, inside `waitUntil()`, so both answers are equally fast | 400, 429 `RATE_LIMITED`, 503 `FEATURE_NOT_CONFIGURED` (mail off in production) |
| POST | `/auth/password/reset` *(planned, §2.12.3)* | — | `{email, code, newPassword}` (same rules as register: ≥ 8 characters, ≤ 72 bytes) | **204**: new hash set, then `revokeAllSessions(userId)` logs out every device. No auto-login | 400; `CODE_INVALID` (400); `CODE_EXPIRED` (400); 403 `ACCOUNT_LOCKED` (locked after the code was sent; the code is spent) |
| POST | `/auth/login` | — | `{email, password}` | **200** `{accessToken, user}` + cookie | 400, 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_LOCKED`, 429 |
| POST | `/auth/refresh` | cookie | — | **200** `{accessToken, user}` + new cookie | 401 `INVALID_REFRESH`, 403 `ACCOUNT_LOCKED` |
| POST | `/auth/logout` | cookie | — | **204** | — |
| GET | `/auth/me` | 🔒 | — | **200** `{user}` | 401 |
| GET | `/sessions` | 🔒 | — | **200** `[{id, userAgent, ip, lastUsedAt, current}]` | 401 |
| DELETE | `/sessions/:id` | 🔒 | — | **204** (that device's whole chain, also when it rotated after the list was loaded) | 404 |
| DELETE | `/sessions` | 🔒 | `?others=true` (required) | **204** | 400 without it |
| PATCH | `/users/me` | 🔒 | `{name?, language?, theme?, defaultWalletId?}` | **200** `{user}` | 400, 404 |
| PATCH | `/users/me/password` | 🔒 | `{currentPassword, newPassword}` | **204** (also revokes other sessions) | 400, 401 `INVALID_CREDENTIALS` |

*Planned (§2.12.5):* the five auth routes above are public and check their bodies with zod. `register/verify` and `password/reset` share one code check: one atomic `$inc` of `attempts` on a live row, then the hash comparison, then `findOneAndDelete` on the row's `_id` and `codeHash` (only one of two equal requests wins). Here `details` is an object (`attemptsLeft`, `retryAfter`), not the `[{path, issue}]` list zod errors use. Settings → change password stays as today.

*Planned (§2.11.5):* Settings gets the "Trợ lý" switch (`users.assistantOn`, default on) and the B1 reminder choice (`users.notify`). §2.11 names no endpoint for them; `PATCH /users/me` is the natural place, left to the builder.

### Wallets, categories, budgets

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/wallets` | 🔒 | `?includeArchived=` | **200** `[{…, balance}]` | — |
| POST | `/wallets` | 🔒 | `{name, type, initialBalance, aliases?, color?, icon?}` | **201** | 400 (also `initialBalance` < 0 when `type` ≠ `credit`, details path `initialBalance`), 409 `NAME_TAKEN` |
| GET | `/wallets/:id` | 🔒 | — | **200** | 404 |
| PATCH | `/wallets/:id` | 🔒 | any field above, `archived?` (archiving the default wallet clears the user's default) | **200** | 400 (also when the patch changes `type` or `initialBalance` and the resulting wallet is below 0 without being `credit`), 404, 409 |
| DELETE | `/wallets/:id` | 🔒 | — | **204** | 404, 409 `WALLET_IN_USE` |
| GET | `/categories` | 🔒 | `?type=expense\|income` | **200** | — |
| POST | `/categories` | 🔒 | `{type, name, keywords?, icon?, color?}` | **201** | 400, 409 `NAME_TAKEN` (same name and type, any case) |
| PATCH | `/categories/:id` | 🔒 | same fields except `type` (fixed) | **200** | 400, 404, 409 `NAME_TAKEN` |
| DELETE | `/categories/:id` | 🔒 | — | **204** (its transactions move to the fallback category) | 404, 409 `FALLBACK_CATEGORY` |
| GET | `/budgets` | 🔒 | `?month=YYYY-MM` (optional, default the current Vietnamese month) | **200** `[{…, spent, percent}]`. *Planned (§2.11.2 A2):* `listBudgets()` adds the `pace()` result to every budget (daily limit left, month-end projection, the day it goes over), so `/month`, the confirm warning and the Budgets page show the same number; field names left to the builder | 400 |
| POST | `/budgets` | 🔒 | `{month, categoryId\|null, limit}` | **201** | 400 (also when the category is not an expense category), 404, 409 `BUDGET_EXISTS` |
| POST | `/budgets/copy` | 🔒 | `{from: 'YYYY-MM', to: 'YYYY-MM'}` | **201** `{created: n}` | 400 |
| PATCH | `/budgets/:id` | 🔒 | `{limit}` | **200** | 400, 404 |
| DELETE | `/budgets/:id` | 🔒 | — | **204** | 404 |

### Transactions, statistics, receipts

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/transactions` | 🔒 | `?from&to&type&walletId&categoryId&status&source&q&page=1&limit=20&sort=-occurredAt` | **200** `{items, page, limit, total}` | 400 |
| POST | `/transactions/parse` | 🔒 | `{text}` (≤ 2000 chars; web quick add; same parser as the bots) | **200** `{drafts:[{type, amount, categoryId, walletId, occurredAt, note}], noAmountLines:[3], truncated}`: `noAmountLines` are the line numbers with no usable amount (none, 0, or over 10^13), `truncated` is true past 10 lines; nothing is saved. *Planned (§2.11.1):* `classify(text, { followUp: false })` runs first; a question answers **200** `{question: true, drafts: [], noAmountLines: [], truncated: false}` (never 422), and the client shows the "Hỏi Sổ chi tiêu" chip. *Planned (§2.11.2 A5, A6):* `chia N` splits the amount, and each draft carries the same `hints` as a bot draft (`draftHints()`) | 400, 422 `NO_AMOUNT_FOUND` (no line is readable) |
| POST | `/transactions` | 🔒 | `{type, amount, walletId, categoryId, occurredAt, note?}` | **201** (status `confirmed`) | 400, 404 (wallet/category) |
| GET | `/transactions/:id` | 🔒 | — | **200** | 404 |
| PATCH | `/transactions/:id` | 🔒 | any editable field | **200** | 400, 404 |
| DELETE | `/transactions/:id` | 🔒 | — | **204** (soft) | 404 |
| POST | `/transactions/:id/restore` | 🔒 | — | **200** (undo delete) | 404 |
| POST | `/transactions/:id/confirm` | 🔒 | optional edits, same fields as PATCH (the Bot inbox) | **200** `{transaction, budgetWarning?}`; the edits and the confirm are one write that only matches a draft | 400, 404, 409 `ALREADY_CONFIRMED` (nothing changed) |
| GET | `/stats/summary` | 🔒 | `?month=YYYY-MM` | **200** `{income, expense, net, budget:{limit, spent}}` (`budget` is `null` without an overall budget) | 400 |
| GET | `/stats/by-category` | 🔒 | `?month=&type=expense` | **200** `[{categoryId, name, total, percent}]` | 400 |
| GET | `/stats/daily` | 🔒 | `?month=` | **200** `[{date, income, expense}]` | 400 |
| POST | `/receipts` | 🔒 | `multipart/form-data` field `image` (JPEG/PNG; the client resizes first, the server accepts up to 4.5 MB) | **201** `{transaction (draft)}` | 400 (no `image` field), 413, 415, 422 `RECEIPT_UNREADABLE`, 502 `KIE_UNAVAILABLE`, 503 `FEATURE_NOT_CONFIGURED` (no `KIE_URL`), 504 `KIE_TIMEOUT`. *Planned (§2.11), with `RECEIPT_READER=qwen`:* `AGENT_UNAVAILABLE` (503: agent down and no `KIE_URL`), `AGENT_BUSY` (503), `RATE_LIMITED` (429: 30 reads a day) (§4.8) |

### Bot linking

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/chat-links/code` | 🔒 | — | **201** `{code, expiresAt, links: {telegram, whatsapp, zalo}}`: `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<CODE>`, `https://wa.me/<WHATSAPP_NUMBER>?text=%2Flink%20<CODE>` and `ZALO_BOT_URL` (no code: Zalo bot links carry no data); each `null` when its setting is missing | 429 `RATE_LIMITED` (5 per user per 10 min) |
| POST | `/chat-links/claim/preview` | 🔒 | `{token}` (string, 1–100 chars) | **200** `{platform, displayName}`; the token is not spent | 400; 404 `LINK_TOKEN_INVALID` (unknown, used, expired, or a website code) |
| POST | `/chat-links/claim` | 🔒 | `{token}` | **201** `{id, platform, displayName, createdAt, viaClaim: true}` | 400; 404 `LINK_TOKEN_INVALID`; 409 `CHAT_ALREADY_LINKED` (that chat was linked meanwhile; the token is still spent) |
| GET | `/chat-links` | 🔒 | — | **200** `[{id, platform, displayName, createdAt, viaClaim, claimNoticeDismissedAt}]` | — |
| DELETE | `/chat-links/:id` | 🔒 | — | **204**; also deletes that chat's claim link, if it has one | 404 |
| PATCH | `/chat-links/:id/claim-notice` | 🔒 | — | **204**; sets `claimNoticeDismissedAt` to now (own links only) | 400 (malformed id); 404 (another user's or unknown id) |


**Link card links** (§2.10.2): `links.telegram` is `https://t.me/<bot>?start=<CODE>`, `links.whatsapp` is `https://wa.me/<WHATSAPP_NUMBER>?text=%2Flink%20<CODE>` (the chat opens with `/link CODE` typed), and `links.zalo` is `ZALO_BOT_URL` (a Zalo bot link carries no payload, so the card copies `/link CODE` to the clipboard before opening it). The code itself is unchanged: 6 characters, 10 minutes, single use, 5 per user per 10 minutes.

**Linking from the chat** (§2.10.3): the bot hands an unlinked chat a claim link (see §4.6, step 4), and the website's `/link?t=<token>` screen spends it through the two claim endpoints above (`services/chatLinks.js`: `createClaimToken`, `previewClaim`, `claimChat`).
- Tokens travel in the body, never in a URL the server logs. Both endpoints need login.
- Both only match `linkCodes` rows that have `chat` (claim links), so a website code is `LINK_TOKEN_INVALID` here; in the other direction `/start CODE` and `/link CODE` only match rows that have `userId`, so a claim token never works in the chat.
- `/claim` is one atomic update, as `/link CODE` is: the row must be unused, unexpired and a claim link, and it is marked used. Then a `chatLinks` row is created from its `chat` (`platform`, `platformUserId`, `chatId`, `displayName`) for the logged-in user. If that chat got linked in the meantime, the unique `(platform, platformUserId)` index refuses the row → `CHAT_ALREADY_LINKED` (409).
- Unlinking (`deleteChatLink`) deletes the chat's claim row first, then the `chatLinks` row, so a claim link made before the chat was linked can't link it again. `claimChat` reads its row again after creating the `chatLinks` row; if an unlink removed it meanwhile, the new row is deleted → 404 `LINK_TOKEN_INVALID`.
- After the 201 the bot sends the chat the same text as a `/link CODE` success ("Đã liên kết với tài khoản <name>" / "Linked to the account of <name>") in the user's language, through that platform's adapter (`sendLinked` in `bot/core.js`). The send runs in `waitUntil`, after the response, like the webhook work; if it fails it is only logged and the link stays.
- Responses carry only `platform` and `displayName`, never `platformUserId` or `chatId`.
- Phishing (§2.10.3): an attacker can send their own chat's claim link to a victim; if the victim confirms, the attacker's chat is linked to the victim's account and can read `/today` and `/month` and create and confirm transactions there (not the web login). The display name is not proof. Mitigations: the warning on the `/link` confirm screen, the 10-minute single-use token, and a Bot inbox notice "New chat linked from a chat link: **Zalo · Anh**. Not you? [Unlink]". The server records it on `chatLinks`: `viaClaim` (boolean, default `false`; `/claim` sets `true`) and `claimNoticeDismissedAt` (date or `null`). The notice shows for every link with `viaClaim && !claimNoticeDismissedAt`; Unlink is the existing `DELETE /chat-links/:id`, and `PATCH /chat-links/:id/claim-notice` dismisses it (`claimNoticeDismissedAt = now`, 204; 404 for another user's or an unknown id).

### Assistant *(planned, §2.11.5)*

`routes/assistant.js`, `requireAuth`, zod bodies. The questions go to the agent service's `/v1/turn` (§4.11); with the model gate shut, pipeline skills and templates answer.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/assistant/chat` | 🔒 | `{message (1–500 chars), month?, requestId}` | **200** `{route, text, sources, action?, capture?, remainingToday}`. `route` is the agent's `rules` or `agent`; `action` is a confirm card; `capture` is the quick-add preview when the message is a capture (`phở 45k`, no agent call). Without `AGENT_URL`, the help text | 400; `DUPLICATE` (409: the same `requestId` twice); `AGENT_UNAVAILABLE` (503: agent service down or timed out); `AGENT_BUSY` (503: its queue is full) |
| GET | `/assistant/thread` | 🔒 | — | **200** the web thread (the last 6 `agentTurns` rows of `threadKey: "web"` with `clearedAt: null`, read by Express) and the count for "Còn N câu hỏi hôm nay"; exact shape left to the builder | — |
| DELETE | `/assistant/thread` | 🔒 | — | "Xoá": sets `clearedAt` on the user's web `agentTurns` rows, the one write Express makes to an agent collection. Rows are never deleted, so the daily count is not reset ([03-database.md §3.7](03-database.md)). Status not stated | — |
| POST | `/assistant/actions/:id/confirm` | 🔒 | — | checks the row's `args` again, flips the `pendingActions` row `pending → done` atomically, then runs the same service as the web (`createBudget`, `copyBudgets` or `deleteTransaction`), then asks `/v1/turn` (`trigger: confirm`) for the reply. Success status and body not stated | 404 (not this user's, or expired), 409 (already done) |
| POST | `/assistant/actions/:id/cancel` | 🔒 | — | the card is dropped; status and body not stated | 404, 409 |

- `requestId` is the turn's `requestId` in `agentTurns`; the agent service's unique `(userId, requestId)` index turns a second request with the same id into `DUPLICATE` (409), which Express passes on.
- §2.11 does not name the error codes of the action routes' 404 and 409.

*Planned error codes are written `CODE` (status) in this section until the build PR adds `errors.DUPLICATE`, `errors.AGENT_UNAVAILABLE`, `errors.AGENT_BUSY`, `errors.CODE_INVALID`, `errors.CODE_EXPIRED` and `errors.EMAIL_SEND_FAILED` (vi + en), because TC-F12-03 reads codes written as status-then-code from this file and requires a translation for each.*

### Admin 👑

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/admin/users` | `?q&role&status&page&limit` | **200** `{items, total}` | 403 |
| PATCH | `/admin/users/:id` | `{role?, status?}` | **200** | 400, 403, 404, 409 `LAST_ADMIN` |
| GET | `/admin/categories` | `?type=` | **200** templates (stores the built-in defaults first if there are none) | 403 |
| POST | `/admin/categories` | `{type, names:{vi,en}, keywords?, icon?, color?}` | **201** | 400, 403 |
| PATCH | `/admin/categories/:id` | same fields except `type` (fixed) | **200** | 400, 403, 404 |
| DELETE | `/admin/categories/:id` | — | **204** | 403, 404, 409 `FALLBACK_CATEGORY` |
| GET | `/admin/stats` | — | **200** `{users, activeUsers7d, chatLinks:{telegram, zalo, whatsapp}, transactionsBySource:{web, telegram, zalo, whatsapp, receipt}}` | 403 |
| POST | `/admin/cron/daily` *(planned, §2.11.2)* | — | runs the same work as `GET /cron/daily` ("Chạy ngay", for the demo: crons don't fire locally). Status and body not stated | 403 |

*Planned (§2.11.5):* the admin users page gets the runtime assistant switch (`appSettings.assistantEnabled`) next to "Chạy ngay". There is no per-user switch for admins. §2.11 names no endpoint for it; a settings route is left to the builder. No admin route reads `agentTurns` or `receiptReads`.

### Webhooks and health

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| POST | `/webhooks/telegram` | header `X-Telegram-Bot-Api-Secret-Token` | **200** (always, after the secret check) | 401 bad secret |
| POST | `/webhooks/zalo` | header `X-Bot-Api-Secret-Token` (timing-safe compare) | **200** | 401 bad secret |
| GET | `/webhooks/whatsapp` | query `hub.mode=subscribe` and `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN` (Meta's setup check) | **200** `hub.challenge` as plain text | 403; 503 `FEATURE_NOT_CONFIGURED` (a WhatsApp webhook setting unset, §4.2) |
| POST | `/webhooks/whatsapp` | header `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET>` (constant-time compare) | **200** (also for status updates, which are ignored) | 401 bad or missing signature, nothing processed; 503 `FEATURE_NOT_CONFIGURED` (a WhatsApp webhook setting unset, §4.2) |
| GET | `/cron/daily` *(planned, §2.11.2)* | header `Authorization: Bearer ${CRON_SECRET}`, checked with `sameSecret()` (constant time) | a 2xx after the daily run (§4.11); §2.11 names no status or body | 401 bad or missing secret (§2.11 names no status; 401 as for webhooks) |
| GET | `/health` | — | **200** `{status:'ok', db:'up'}` | 503 |

## 4.5 Errors and status codes

Every error goes through one `errorHandler` and has the same shape (the one exception is `GET /health`, which answers its own 503 body):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "amount must be a positive integer", "details": [{ "path": "amount", "issue": "too_small" }] } }
```

| Status | When |
|---|---|
| 200 / 201 / 204 | OK / created / deleted or no body |
| 400 `VALIDATION_ERROR` | zod validation failed (body, query, params, bad ObjectId) |
| 400 *(planned, §2.12)* | `CODE_INVALID`: wrong email code (`details.attemptsLeft`); `CODE_EXPIRED`: no live code, or out of tries ("Send a new one") |
| 401 | Not logged in, bad or expired token, wrong password, bad webhook secret or WhatsApp signature; *planned (§2.11.2):* bad `CRON_SECRET` |
| 403 | Logged in but not allowed (role), account locked; the WhatsApp setup check (`GET /webhooks/whatsapp`) with a wrong verify token (`FORBIDDEN`); *planned (§2.12.3):* password reset for an account locked after the code was sent |
| 404 | Resource not found **or not yours**; `LINK_TOKEN_INVALID` (claim token unknown, used, expired, or a website code) |
| 409 | Unique conflict (`EMAIL_TAKEN`, `NAME_TAKEN`, `BUDGET_EXISTS`, else generic `CONFLICT`), resource in use, fallback category, last admin, already confirmed; `CHAT_ALREADY_LINKED` (the claimed chat was linked meanwhile); *planned (§2.11.5):* `DUPLICATE` (the same assistant `requestId` twice), and an action card already done |
| 413 / 415 | Body too large (`PAYLOAD_TOO_LARGE`) / image not JPEG or PNG (`UNSUPPORTED_MEDIA_TYPE`) |
| 422 | `RECEIPT_UNREADABLE` (no total found, or KIE could not open the image); `NO_AMOUNT_FOUND` (quick-add text with no readable amount; *planned (§2.11.1):* never for a question, which answers 200 `question: true`) |
| 429 `RATE_LIMITED` | Rate limited; *planned (§2.12.1):* also an email code asked for too early or too often (`details.retryAfter`, seconds), and `mailRateLimit` |
| 502 / 504 | KIE service down / timed out (with `RECEIPT_READER=kie`) |
| 503 | `FEATURE_NOT_CONFIGURED` (missing optional env, §4.2; *planned (§2.12.4):* `password/forgot` with mail off in production); `/health` when the database is down (body `{status:'error', db:'down'}`, not the error shape); *planned (§2.12.2):* `EMAIL_SEND_FAILED` (Gmail refused the code email); *planned (§2.11):* `AGENT_UNAVAILABLE` (the agent service is down or timed out) and `AGENT_BUSY` (its queue is full) |
| 500 `INTERNAL` | Anything unexpected (logged with request id; the message is hidden from clients) |

Implementation: an `AppError(status, code, message, details)` class; Mongoose `E11000` → 409 `CONFLICT` (when no service mapped it first); `CastError` → 400; zod error → 400; other 4xx errors from Express or the body parser keep their status. A Mongoose `ValidationError` is not mapped, so it becomes 500 `INTERNAL` (input is normally rejected by zod before it gets that far). Express 5 forwards rejected async handlers to the error middleware without wrappers.

## 4.6 Bot core and adapters

```text
server/src/bot/
├── core.js        handleMessage(adapter, message), handleButton(platform, platformUserId, action, txId), sendLinked(adapter, chatId, userId), messagesFor(lang)
├── parser.js      parseText(text, ctx) → one result per line (first 10)
│                  parseLine(text, {categories, wallets, defaultWalletId, now}) → {type, amount, categoryId, walletId, occurredAt, note} | null
│                  bestCategory(categories, text), onDay(now, year, month, day)
├── messages.vi.js / messages.en.js   all bot reply texts
├── telegram.js    map update → core calls, sendMessage/editMessageText/answerCallbackQuery/getFile
├── whatsapp.js    map webhook body → core calls, Graph API messages (text, reply buttons) and media download
└── zalo.js        map event → core calls, sendMessage
```

*Planned (§2.11.1):* `bot/ask.js` holds `classify(text, { followUp })` → question or capture, a pure function with no database and no model; the question engine lives in the agent service, reached through `services/agent.js` (§4.11).

The secret check lives in `routes/webhooks.js`, before the adapter runs. WhatsApp is a third adapter, `bot/whatsapp.js` (`whatsapp`, `handleWhatsAppWebhook`), whose signature check runs at the same point; see **WhatsApp specifics** below.

**Adapter contract** (what `core.js` needs from each platform):

```js
{
  platform: 'telegram' | 'zalo' | 'whatsapp',
  sendText(chatId, text),
  sendDraft(chatId, { id, text }, lang),   // Telegram: inline keyboard; Zalo: text + "ok / huy" hint; WhatsApp: button message
  downloadPhoto(ref) → Buffer
}
```

**Webhook handling** (Telegram and Zalo; WhatsApp follows steps 1, 2, 4 and 5, with its signature check in step 1 and Meta retrying any delivery that does not get a 200; step 3 has no WhatsApp equivalent, see **WhatsApp specifics**):

1. Check the secret header, comparing with `crypto.timingSafeEqual`. A mismatch returns 401.
2. Reply **200 immediately**, then run the adapter's handler (`handleTelegramUpdate` / `handleZaloEvent`) inside `waitUntil`. The platform does not retry, and the slow work (KIE ~20 s) continues inside the 300 s function limit. Failures are only logged.
3. Only messages from **private chats** are handled (Telegram `chat.type = private`, Zalo `chat.chat_type = PRIVATE`); in a group other people would see the money, so those messages are dropped. Telegram button presses (`callback_query`) are handled before this check, with no chat-type test (drafts, and so their buttons, are only sent to private chats).
4. `handleMessage` looks up `chatLinks` by `(platform, platformUserId)`. If there is none, only a valid `/start CODE` or `/link CODE` links the chat; anything else (a wrong or expired code counts as "anything" and is called out first) gets the "please link" reply with a claim link. A linked but locked user gets the "locked" reply to everything else (`/start CODE` and `/link CODE` are answered before the lock check). A button press from an unlinked chat only gets the "please link" text, as its short notice cannot be tapped.
   **Claim link** (§2.10.3, every platform): `createClaimToken` makes a random 32-character base64url token (24 bytes), kept only as its SHA-256 in `linkCodes`, 10 minutes, single use, with `chat: { platform, platformUserId, chatId, displayName }` and no `userId`. It is one atomic upsert keyed on `(chat.platform, chat.platformUserId)`, backed by a partial unique index, so it replaces the chat's older link and a chat has at most one even when two messages arrive at once. The reply, in both languages, is the "please link" text plus "Or tap to link: `<APP_URL>/link?t=<token>` (valid 10 minutes)". Without `APP_URL` no token is made. The website spends the token through `POST /chat-links/claim` (§4.4).
   *Planned (§2.11.1):* for a linked, active chat the first match wins, in this order: a photo (the receipt reader → draft, §4.8); `/hoi <question>` (the question path); any other command; the reserved words `ok`, `huy`, `hoàn tác`, `khôi phục`; everything else goes through `classify(text, { followUp })`, where a question goes to the agent service's `/v1/turn` (§4.11) and a capture to `createDrafts` as today. `followUp` is true when an assistant answer went to this chat in the last 10 minutes. A bare `1`–`3` replies to an open ask-back; after it expired (less than 24 h ago) it gets "Câu hỏi đã hết hạn, hãy hỏi lại" and never reaches `createDrafts` or the Zalo amount correction. Telegram button presses are still handled before all of this.
5. Idempotency: each draft carries `chatRef = (platform, chatId, '<messageId>:<line>')`, and the unique partial index turns a duplicate delivery of a text or photo message into no second draft and no second reply. Typed `ok` / `huy`, commands and Zalo amount-only corrections are not deduplicated: delivered twice, they run twice (a second `ok` acts on the next waiting draft; a correction is applied and the draft sent again). For a photo the core first checks whether that `chatRef` already exists, so a redelivered photo is not sent to KIE again. WhatsApp's message `id` (`wamid…`) is the `messageId`, so the same rules hold there.
   *Planned (§2.11):* a **question** is deduplicated too: Express sends the chatRef `<platform>:<chatId>:<messageId>` as `requestId`, and the agent service's `ingress` first inserts its `agentTurns` row, unique on `(userId, requestId)`, so a redelivered question answers once and calls the model at most once. An action card runs once because the tap flips its `pendingActions` row `pending → done` atomically first. A recurring-bill draft from the cron uses `chatRef.messageId = rec:<date>:<key>`, so a rerun makes no second draft. Proactive messages insert their `notices` row before sending, so a double cron fire sends nothing twice.

**Bot commands** (the same on Telegram, Zalo and WhatsApp, §2.10.4; on WhatsApp "ok" / "huy" work too, and the buttons do the same):

| Input | Reply |
|---|---|
| `/today` | today's spent and received |
| `/month` | this month's spent and received, the overall budget, then each category budget, fullest first |
| `/lang vi\|en` | switches the reply language (the same setting as the web Settings page) |
| `/help`, `/start` without a code, any unknown command | the help text |
| text lines | one draft per line with an amount; if no line has an amount, the help text. Lines without a usable amount get a "not recorded" reply naming their line numbers |
| `ok` / `huy` | confirms / discards `chatLinks.pendingTransactionId` while it is still a draft, else the newest draft of this chat that still waits (several lines make several drafts); the reply names the next waiting draft. Works on both platforms |
| `/hoi <question>`, or a message `classify` reads as a question *(planned, §2.11.3)* | an exact answer from the user's data, naming the period and filter it used |
| `/dubao` *(planned, §2.11.2 A2)* | budget pace and the month-end forecast (from day 5 of the month) |
| `/visao` *(planned, A3)* | the 3 categories that changed most against the same days last month, unusual rows, and one tip with an action button |
| `/sua <changes>` *(planned, A4)* | edits the waiting draft, or else the transaction this chat confirmed in the last 15 minutes (`chatLinks.lastConfirmedId`). Only with the slash: "sửa xe 150k" stays an expense |
| `hoàn tác` / `khôi phục` *(planned, A4)* | deletes the last transaction this chat confirmed / brings it back (`deleteTransaction`, `restoreTransaction`) |
| `cơm 1tr2 chia 4`, `chia N` *(planned, A5)* | amount = ceil(total ÷ N ÷ 1000) × 1000 and the note gets "(1.200.000 ₫ ÷ 4)"; `chia N` alone divides the waiting draft. N from 2 to 50. A parser rule applied before `findAmount()` |
| `/ngansach <danh mục> <số tiền>` *(planned)* | sets a budget |
| `/tuan`, `/thang` *(planned, B4)* | the weekly / monthly report (the same skills as the cron) |
| `/chep`, `/dunggoiy` *(planned, B4)* | copy last month's budgets (`copyBudgets()`) / use the suggested budgets (`createBudget()`, skipping a 409) |
| `/dinhky` *(planned, B3)* | the recurring bills found |
| `/nhac toi\|tuan\|tat` *(planned, B1)* | sets `users.notify` to `daily`, `weekly` or `off` |
| `/tongket` *(planned, B1)* | the evening digest now |
| `/dongy` / `/thoi` *(planned, C3)* | confirms / cancels the waiting action card (typed, for Zalo; the other apps have buttons) |

*Planned (§2.11.6):* `/help` lists the new commands; English aliases are added where natural. Each reply is one message of at most 1,500 characters (never split on Zalo). Telegram shows "typing" every 4 s while a question runs. Ask-back options and action cards are buttons on Telegram (`ao:<id>` / `an:<id>` for ✅ Đồng ý / ✖️ Thôi, `q:` for ask-back) and reply buttons on WhatsApp; on Zalo the user types `1`–`3` within 10 minutes, or `/dongy` / `/thoi`. Callback encodings within 64 bytes are left to the builder.

*Planned (§2.11.6), per channel:* the assistant is on in all four channels (`ASSISTANT_CHANNELS`; WhatsApp once §2.10 ships), with 30 questions per user per day on the web, 20 on Telegram, 10 on Zalo and 5 on WhatsApp. Zalo (counting and guard built, T49): proactive messages off at 2,000 messages a month, assistant answers off at 2,400, and from 2,850 only capture and linking replies (decision D20; help and other replies stop). WhatsApp: assistant answers off at 800, and at 950 every reply stops (captures still land in the Bot inbox). Proactive messages: Telegram gets them directly; Zalo only on the user's next reply; WhatsApp only within 24 h of the user's last message; the web shows a banner on the next visit. A user linked on several apps gets them on Telegram only.

**Telegram specifics** (Bot API):
- Register with `setWebhook(url, secret_token, allowed_updates: ["message","callback_query"])`. Telegram sends the secret back in `X-Telegram-Bot-Api-Secret-Token`.
- Text: `update.message.text`. Photo: `update.message.photo` (array of sizes; take the last, i.e. largest) → `getFile(file_id)` → download `https://api.telegram.org/file/bot<TOKEN>/<file_path>` (bots can download files up to 20 MB).
- Buttons: `reply_markup.inline_keyboard` with `callback_data` `c:<txId>` / `x:<txId>` (≤ 64 bytes). Then `answerCallbackQuery` and `editMessageText`. A third ✏️ button opens `${APP_URL}/bot` (the web Bot inbox), only when `APP_URL` is `https://` (Telegram refuses http and localhost links).
- Deep link: `https://t.me/<bot>?start=<CODE>` → arrives as `/start <CODE>`.

**Zalo specifics** (Zalo Bot Platform, `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>`):
- Register with `setWebhook { url, secret_token }` (secret 8–256 chars). Zalo sends it back in `X-Bot-Api-Secret-Token`. Webhook and `getUpdates` polling are mutually exclusive.
- Body: `{ event_name, message }`, also accepted wrapped as `{ ok, result: { event_name, message } }`. Handle `message.text.received` (`message.text`) and `message.image.received` (`message.photo_url`, older payloads used `photo`; a caption is not read). Ignore `message.sticker.received`, `message.voice.received` and `message.unsupported.received`.
- Reply target: `message.chat.id`. Sender: `message.from.id`, `message.from.display_name`.
- `sendMessage { chat_id, text }`, max 2000 chars. **No buttons**, so each draft ends with the `ok` / `huy` hint (see Bot commands). **Zalo only:** a one-line reply that is only an amount (`55k`) corrects the waiting draft's amount through the same update service as the web Bot inbox.
- Every line of a message is saved before any reply is sent, so a failed `sendMessage` (monthly quota, timeout) never loses the lines after it.
- **Send counter and quota guard** (built, T49; §2.11.6). `bot/zalo.js` has one send function, and both `sendText` and `sendDraft` go through it, so every message Zalo accepts adds 1 to `channelUsage {platform: 'zalo', month}` exactly once (an atomic `$inc` upsert; a refused send is not counted; a counting failure is logged and the send's result is unchanged). The bot core sends every text reply through `reply(adapter, chatId, text, kind)`, which asks `maySend(platform, kind)` (`services/channelUsage.js`) first: `proactive` is off from 2,000 messages this month, `assistant` from 2,400, `other` from 2,850, `capture` and `link` never. *Capture* replies are the drafts, the receipt reading and failure messages, the note about lines with no amount, and the results of `ok`, `huy` and an amount correction. *Link* replies are the please-link prompt, every reply to `/start CODE` and `/link CODE` (linked, already linked, invalid code) and the claim success message. *Other* is the rest: commands and help (including the help text for a message with no amount) and the locked-account notice. From 2,850 an `other` reply is not sent, but a command still runs. Telegram is never held back by it, and WhatsApp is not counted until T70.
- ⚠️ The payload shape comes from community SDKs (see sources in [06-deployment.md](06-deployment.md)). Log the first real webhook body during setup and adjust if it differs.

**WhatsApp specifics** *(built by card T34, §2.10.4; Meta's WhatsApp Cloud API directly, `https://graph.facebook.com/<version>/…`)*:
- Webhook `/api/webhooks/whatsapp`, subscribed to the `messages` field (Meta app setup goes in [06-deployment.md](06-deployment.md)). `GET` is Meta's setup check: `hub.mode=subscribe` and `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN` (constant-time compare) with a `hub.challenge` → 200 with `hub.challenge` as plain text, otherwise 403 `FORBIDDEN` (a repeated parameter is an array, so it is a 403 too). `POST` must carry `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of req.rawBody with WHATSAPP_APP_SECRET>` (raw bytes kept by the parser's `verify`, §4.1), compared in constant time; otherwise 401 and nothing is processed (also when the body was not JSON, so there are no raw bytes). Each 401 writes one `console.warn` with the request id and its cause, `whatsapp webhook: signature mismatch` or `whatsapp webhook: no raw body (content-type …)`, never the header or a secret (TC-F8-42): both answer the same 401, and only the log tells a wrong app secret from a platform that handed Express an already-read body (§6.12). The setup `GET` sets `req.originalUrl` to its path before it does anything else, so the request log (`middleware/requestId.js`) and the 5xx log (`middleware/error.js`) print no query and so no `hub.verify_token` (TC-F8-43). Without all four WhatsApp settings both answer 503 `FEATURE_NOT_CONFIGURED` before anything else (§4.2). `scripts/setWebhooks.js` has a `whatsapp` entry that calls nothing: Meta keeps the callback URL on the app, so it prints `manual: …` with the URL and the verify-token reminder to enter in the dashboard, or `skipped: …` when a setting is missing.
- Body: read `entry[].changes[].value` of every change whose `field` is `messages`. `messages[]` are handled in order (a failure on one does not stop the next; the first error is logged); `statuses[]` (sent/delivered/read) and other fields are ignored. All get 200, so Meta doesn't retry.
- Incoming message → core message: `platformUserId` and `chatId` are the user's **business-scoped user ID** (BSUID, `from_user_id` on the message). Meta omits `from` (the phone number) for users who adopted a WhatsApp username, so the phone number is never the key and is never stored (the adapter does not read `from` or `wa_id`). `displayName` is `profile.name` of the contact whose `user_id` is that BSUID; `messageId` is the message `id` (`wamid…`). `type: text` → `text.body`; `type: image` → `photo` = `image.id`; `type: interactive` with `button_reply` → a button press (`handleButton`) decoded from `button_reply.id`; other types (audio, sticker, location, unsupported…) → the help text; `reaction` and `system` (Meta's note that a user's ID changed) are ignored, see below. A message without a string `from_user_id` is ignored (the contact is not proof of who sent it) and logged as `whatsapp message <wamid> ignored: no business-scoped user ID`, never with the number. A message with a `group_id` (WhatsApp's Groups API) is ignored like a group chat on the other platforms: other people would see the money. An emoji reaction (`type: reaction`) and a `type: system` message (Meta sends one when a user's ID changes) are ignored too, so reacting to a draft does not make the bot answer with the help text, and the old ID is not sent a help text or a claim link.
- Sending: `POST https://graph.facebook.com/<version>/<WHATSAPP_PHONE_NUMBER_ID>/messages` with the access token in `Authorization: Bearer`, `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `recipient: <BSUID>` (no `to`: Meta reserves `to` for phone numbers; if both are sent `to` wins), and either `type: "text"` or `type: "interactive"` with `interactive.type: "button"`. The Graph API version is one constant in the adapter (`GRAPH_VERSION = 'v26.0'`, pinned at build time; v27.0 came out on 2026-11-04 and v26.0 is supported to 2028). `sendText` splits replies longer than 4096 characters at the last line break that fits (characters counted as WhatsApp counts them). A Graph error is thrown as `WhatsApp <what> failed: <HTTP status> <error code> <message>` and logged by the webhook; the error never contains the token. Meta lets the bot reply only within 24 hours of the user's last message (§2.10.1): every reply answers a message that just came in, and the claim success message goes out within the claim link's 10 minutes.
- Drafts (`sendDraft`): a button message with **✅ Lưu**, **❌ Huỷ**, **✏️ Sửa** (body at most 1024 characters, titles at most 20). The button ids are `c:<txId>`, `x:<txId>` and `e:<txId>` (27 characters; WhatsApp allows 256), Telegram's `callback_data` plus `e:` for edit, so `handleButton`'s existing confirm/discard path is reused. Reply buttons cannot open a URL and a sent message cannot be edited, so the result of ✅ / ❌ (`{ ok, text }` from the core) is a new text message, ✏️ Sửa makes the bot reply with `<APP_URL>/bot` (the button is left out when `APP_URL` is unset), and a button id that is not `[cxe]:<24 hex>` is ignored. Pressing ✅ again answers "already saved"; a press from another chat touches nothing (`handleButton` looks the draft up by the presser's own chat link).
- Receipts (`downloadPhoto`): `GET /<image.id>` with the access token gives a `url` valid for 5 minutes (it must be `https`); download it with the same token and pass the bytes to KIE as on the other platforms. `transactions.receipt.fileRef` is the media id.
- Every closed list of platforms gains `whatsapp` (§2.10.5): the Mongoose enums `chatLinks.platform`, `transactions.source` and `transactions.chatRef.platform` (without the last, every WhatsApp draft fails validation), the zod `source` filter of `GET /transactions` (`routes/transactions.js`), and the platform/source lists of `GET /admin/stats` (`services/admin.js`). `routes/chatLinks.js` registers the adapter so a claimed WhatsApp chat is told it is linked.
- Privacy: no phone number is stored or returned; the web shows the WhatsApp profile name, and admin stats count chats per platform without identifiers.
- Locked accounts, `/today`, `/month`, `/lang`, `/help`, `ok` / `huy` and budget alerts behave exactly as on Telegram and Zalo.

## 4.7 Text parser

Specified in [02-features.md §2.5](02-features.md#25-text-parser-rules-rule-based-no-ai). It is a pure function with **unit tests** (Vitest, case TC-F8-01/02 in [07-testing.md](07-testing.md)), one table-driven test per row of the rules. The same function serves the web quick-add preview (`POST /transactions/parse`). This is the easiest part to demo and explain.

*Planned (§2.11):* `classify()` (`bot/ask.js`, rules in §2.11.1) runs before the parser on chat text and on `POST /transactions/parse`; it is a pure function with table-driven unit tests like the parser. The parser gains the `chia N` rule (A5), applied before `findAmount()`. `findAmount()` is also how C3 takes a budget limit from the user's own message (§4.11); today it is private to `bot/parser.js`, so it gets exported.

## 4.8 KIE client (`services/receipts.js`)

| | |
|---|---|
| Call | `POST ${KIE_URL}/analyze`, `multipart/form-data`, field **`image`** (JPEG/PNG, KIE limit 10 MB) |
| Auth | Header `X-KIE-Key: ${KIE_API_KEY}`. **Small addition to the KIE app** (permitted): a FastAPI dependency that rejects requests without the key, because `/analyze` is otherwise open to anyone with the tunnel URL |
| Timeout | 120 s (`AbortSignal.timeout`). KIE processes one image at a time (`inference_lock`), ~20 s each |
| Use from response | `fields.merchant`, `fields.date`, `fields.total`, `fields.address`, `line_items[]`, `reconciliation`, `timings_ms` |
| Ignore | `images.*_base64`, `boxes`, `lines`, `full_text` (large and not needed) |
| Mapping | total → digits → `amount`; date `dd/mm/yyyy` → `occurredAt` (else now); merchant → `note`; items → `receipt.items`; category by keyword match on merchant + item names, else fallback |
| Wallet | the user's `defaultWalletId` if set, else their oldest active (not archived) wallet. The stored default is used as is, without checking that it is still active |
| Errors | `KIE_URL` unset → 503 `FEATURE_NOT_CONFIGURED`; network error → 502 `KIE_UNAVAILABLE`; KIE answers 400/413/415 (could not open the image) or no total → 422 `RECEIPT_UNREADABLE`; any other non-2xx (down, wrong key) → 502 `KIE_UNAVAILABLE`; timeout → 504 `KIE_TIMEOUT`. A total above 10^13 that is still a safe integer passes the mapping but fails the Transaction model's amount check → 500 `INTERNAL`; a larger total → 422 `RECEIPT_UNREADABLE`. The bot turns each into a friendly message ("no total" for 415/422, "reader not answering" otherwise) |

**Receipt reader switch** *(planned, §2.6, §2.11)*. `RECEIPT_READER` picks who reads a photo; `createReceiptDraft()` stays the one entry point for the web and the bots.
- `kie` (the default until the receipt eval passes): the KIE client above, unchanged.
- `qwen`: `services/agent.js` `readReceipt()` sends the bytes as base64 to the agent service's `/v1/receipt` (60 s budget, §4.11). The answer maps to the same draft as KIE's: total → `amount`, merchant → `note`, date → `occurredAt`, items → `receipt.items`, reconciliation → `receipt.reconciled`, and the agent's `ms` goes in `receipt.kieMs`. The agent has already applied the payable-total rules (`check_total`), so `{error: NO_TOTAL|UNREADABLE}` → `RECEIPT_UNREADABLE` (422). The category is the keyword rule as today; a Khác/Other result asks `/v1/categorize` after the draft is sent.
- Agent service down, timed out or busy with `RECEIPT_READER=qwen`: the photo goes to KIE when `KIE_URL` is set; else the bot asks the user to type the amount and `POST /receipts` answers `AGENT_UNAVAILABLE` (503), or `AGENT_BUSY` (503) when its queue is full. Over 30 reads a day the agent answers `RATE_LIMITED` (429), which Express passes on.
- Gate to flip the default to `qwen` (eval in [07-testing.md](07-testing.md)): Qwen reads at least as many true payable totals as KIE on the receipt set, with p95 ≤ 15 s. Then the KIE container is retired, and this client and the `KIE_*` variables go with it.

## 4.9 Vercel limits that shape the code

| Limit (Hobby) | Effect |
|---|---|
| Function max duration **300 s** (default 300 s with Fluid compute) | Covers the KIE call (~20 s; 120 s timeout) and, *planned (§2.11)*, the agent calls (25 s in chat, 40 s on the web, 60 s for a receipt). `waitUntil` work shares this limit |
| Request/response body **4.5 MB** | Web receipt uploads are resized in the browser (≤ 1600 px JPEG). Bots download photos server-side, so no limit there |
| One Express function, 250 MB bundle | Keep server dependencies small; nothing native |
| `express.static` is ignored | The SPA is served by Vercel's CDN from `client/dist` |
| Instances are ephemeral | No in-memory state that matters (rate limit is best-effort); all state in MongoDB |
| Cron jobs *(planned, §2.11.2)* | On Hobby a cron runs at most once a day, only on production, with no retry. One cron `0 13 * * *` (20:00–20:59 Vietnam time) calls `GET /api/cron/daily`; `POST /api/admin/cron/daily` runs it by hand, because crons don't fire locally |

## 4.10 Security checklist

- [ ] `.env` git-ignored; `.env.example` lists names only; secrets set in Vercel → Settings → Environment Variables.
- [ ] Webhook secrets checked with timing-safe compare before the update is processed (the global `express.json` has already parsed the body).
- [ ] WhatsApp `X-Hub-Signature-256` checked against an HMAC-SHA256 of `req.rawBody` with `WHATSAPP_APP_SECRET`, in constant time, before anything is processed (401 otherwise); the `GET` setup check answers 403 unless `hub.verify_token` equals `WHATSAPP_VERIFY_TOKEN` (§2.10.4, TC-F8-26, TC-F8-27, TC-F8-28).
- [ ] Claim tokens (§2.10.3) are 24 random bytes, stored only as SHA-256, single use, 10 min, at most one live per chat (partial unique index); the API takes them in request bodies only, never in a URL the server logs; claiming needs login plus the Confirm step and spends the token in one atomic update. The claim link itself is a page address (`/link?t=…`), so the first page load carries the token; the SPA removes it before its first request.
- [ ] No WhatsApp phone number stored or returned (chats are keyed by BSUID; TC-F8-37).
- [ ] `WHATSAPP_VERIFY_TOKEN` is kept out of the app's logs: Meta's `GET` setup check carries it in the query, and `middleware/requestId.js` and `middleware/error.js` print `req.originalUrl`, so the route sets `req.originalUrl = req.baseUrl + req.path` before anything else and both log the path only, for a 200, a 403 and a 503 alike (TC-F8-43). What Vercel itself records about a request is not under the app's control; the token only guards the setup check, which answers with Meta's own challenge number and does nothing else, and it can be rotated with `tools/set-secret.sh` and Meta's Configuration panel. The access token and app secret are never in a URL, and no log line holds a signature or a secret (TC-F8-33, TC-F8-34, TC-F8-42).
- [ ] *Planned (§2.11.4):* the agent tools close over `userId` from the request (taken by Express from the JWT or the `chatLinks` row); `FORBIDDEN_ARGS` (`userId`, `token`, `query`) never come from the model. Facts sent to the model carry no name, email, phone, chat name, BSUID or chat id; 8+ digit runs and emails in free text are masked and notes cut to 60 characters. The guard rejects any digit, number word or verdict word not in the facts, and any id, URL, @handle or email in the model's own text. A C3 card needs a change verb in the user's own message, Express checks its `args` again, and nothing is written until the tap.
- [ ] *Planned (§2.11.4):* the agent service checks `Authorization: Bearer ${AGENT_SECRET}` in constant time on every path except `/health`, which returns no user data. vLLM listens on `127.0.0.1` only; the tunnel exposes the agent service, never vLLM. Prompts never leave our machines.
- [ ] *Planned (§2.11):* the agent service connects as `sochitieu_agent`, a custom role with `find` on the app's money collections and writes only on its own collections and `pendingActions` ([03-database.md §3.7](03-database.md)); every money write stays in Express.
- [ ] *Planned (§2.11.6):* `agentTurns` holds money questions and answers and `receiptReads` what receipts said; admins never see either. Logs in Express and in the agent service carry only the turn id, node and error class, never the question, notes, figures or tool arguments; vLLM request logging stays off.
- [ ] *Planned (§2.11.2):* `CRON_SECRET` checked with `sameSecret()` (constant time) before the daily run.
- [ ] *Planned (§2.12):* email codes stored only as SHA-256 and compared in constant time; 5 tries per code, 60 s between sends, 5 sends per address per hour, 10 code emails per IP per 15 minutes. `password/forgot` and `register/resend` give the same answer whether or not the address has an account or a pending sign-up. The pending sign-up keeps a bcrypt hash, never the password. Production logs never contain the code or the password, and the email is masked (`a***@gmail.com`).
- [ ] *Planned, open (not settled by §2.12):* `register/resend` and `password/forgot` promise the same answer whether or not a row exists, yet the per-address limits answer 429 only when one does (a pending sign-up, or an active account after its first send). A 429 on the second request therefore tells an attacker the address is pending or has an account. The builder either answers 202 and silently skips the send when the per-address limit is hit, or accepts the leak.
- [ ] Every query scoped by `userId`; admin cannot read users' transactions.
- [ ] Passwords hashed with bcrypt; refresh tokens and link codes stored hashed; link codes single-use, 10 min TTL.
- [ ] `helmet`; JSON body limit 1 MB; zod on every input; `mongoose.set('sanitizeFilter', true)` against operator injection.
- [ ] Atlas: dedicated DB user with `readWrite` on one database only; strong password (the network allows `0.0.0.0/0`, see deployment doc).
- [ ] KIE protected by `X-KIE-Key`.
- [ ] Last admin cannot demote or lock themselves (`409 LAST_ADMIN`).

## 4.11 Assistant, agent service and daily cron (planned, §2.11)

None of this is built yet; docs/02 §2.11 is the spec, and [01-architecture.md](01-architecture.md) shows the components and flows. Every number in a reply comes from our code and MongoDB, never from the model, and nothing goes to a third-party model. The work is split in two:

- **Express** (this server) keeps `classify`, capture, the plain commands, every write, auth and the cron entry point. It calls the agent service through `services/agent.js`.
- **The agent service** (`agent/`, Python 3.12, FastAPI + LangGraph) runs on the GPU host next to vLLM, which serves Qwen3.5-2B (§2.11.4). It holds the question engine (§2.11.3), reads receipts and suggests categories. It writes only its own collections and `pendingActions` proposals ([03-database.md §3.7](03-database.md)).

Express reaches it over HTTPS through a Cloudflare tunnel, like KIE. vLLM listens on `127.0.0.1:8300` only and is never exposed. Serving and setup are in [06-deployment.md](06-deployment.md).

### Express side

**`services/agent.js`.** One client for the agent service:

```js
turn(body)                                        // POST /v1/turn
readReceipt({ userId, image, mime, platform, fileRef })   // POST /v1/receipt
categorize({ userId, note, merchant, items })     // POST /v1/categorize
```

- Sends `Authorization: Bearer ${AGENT_SECRET}` and passes the `requestId` through.
- Aborts with `AbortSignal.timeout` at the call's budget: 25 s in chat (inside `waitUntil`), 40 s on the web, 60 s for a receipt, 3 s for a category suggestion. An abort, a network error or a 5xx counts as "agent down".
- Reads one error shape, the same as Express's (`{ error: { code, message } }`).
- Without `AGENT_URL` or `AGENT_SECRET` it is never called (§4.2).

**Who calls what.**

| Express caller | Agent endpoint | Agent down or unset |
|---|---|---|
| `handleMessage`: `/hoi <question>`, or `classify` reads a question (§4.6 step 4) | `/v1/turn`, `trigger: chat`, `requestId` = the chatRef `<platform>:<chatId>:<messageId>` | the help text plus the plain commands |
| skill commands `/dubao`, `/visao`, `/tuan`, `/thang`, `/tongket` | `/v1/turn`, `trigger: chat`, with `skill` set | the same |
| `POST /assistant/chat` | `/v1/turn`, `trigger: chat`, the drawer's `requestId` | unset: 200 with the help text; down: `AGENT_UNAVAILABLE` (503); queue full: `AGENT_BUSY` (503) |
| an action tap (Telegram `ao:`/`an:`, WhatsApp reply buttons, Zalo `/dongy`/`/thoi`, `POST /assistant/actions/:id/confirm` and `/cancel`) | Express flips the row and runs the write first, then `/v1/turn`, `trigger: confirm`, `actionId` | the write stands; the reply is a fixed line from our templates |
| `GET /cron/daily`, `POST /admin/cron/daily` (B1, B2, B4) | `/v1/turn`, `trigger: schedule`, with `skill` (`ban_tin_toi`, `du_bao_cuoi_thang`, `tong_ket_tuan`, `tong_ket_thang`) | that user's message is skipped this run, and no `notices` row is written |
| a bot photo or `POST /receipts`, with `RECEIPT_READER=qwen` | `/v1/receipt` (§4.8) | KIE when `KIE_URL` is set; else the bot asks the user to type the amount, and the web answers `AGENT_UNAVAILABLE` (503) |
| a bot draft that fell back to Khác/Other (text or receipt) | `/v1/categorize`, inside `waitUntil` after the draft is sent | no suggestion; the draft stays Khác |
| an A7 category tap | Express moves the draft and adds the keyword first, then `/v1/turn`, `trigger: event`, so `remember` stores the fact (the event's shape is left to the builder) | the keyword still lands |

**The model gate** (§2.11.4) is worked out by Express and sent with every `/v1/turn` as one boolean (`allowLlm`; §2.11 names no field). It is true only when `ASSISTANT_ENABLED=true`, `appSettings.assistantEnabled` is on (a missing row reads as `ASSISTANT_ENABLED`), `users.assistantOn` is true, the channel is in `ASSISTANT_CHANNELS`, and the Zalo or WhatsApp quota guard of `channelUsage` has not switched assistant answers off (§2.11.6): from 2,400 Zalo messages a month `maySend('zalo', 'assistant')` is false and no assistant answer is sent at all, template or model, not only the model. The agent service adds two checks of its own: the daily cap and vLLM's health. With the gate shut, pipeline skills and templates answer, as in Stage R.

**Caps** (§2.11.4), counted by the agent service: per user per day 30 questions on the web, 20 on Telegram, 10 on Zalo and 5 on WhatsApp (from `agentTurns`), and 30 receipt reads (from `receiptReads`). Over the question cap the turn answers one line saying so, plus the plain commands. Over the receipt cap `/v1/receipt` answers `RATE_LIMITED` (429), which Express passes on. `GET /assistant/thread` counts the same `agentTurns` rows for "Còn N câu hỏi hôm nay".

**Dedup.** A question is deduplicated by `requestId`: `ingress` inserts its `agentTurns` row first, unique on `(userId, requestId)`, so a redelivered webhook or a double click runs once. The second request gets `DUPLICATE` (409); in chat Express sends no second reply, and on the web it passes `DUPLICATE` (409) on.

**New error codes** on the web endpoints: `AGENT_UNAVAILABLE` (503: the agent service is down, timed out or vLLM is down for a receipt) and `AGENT_BUSY` (503: the agent's queue is full, passed through). Both are written `CODE` (status) here until the build PR adds `errors.AGENT_UNAVAILABLE` and `errors.AGENT_BUSY` (vi + en), for the reason given under Bot linking (§4.4).

### Agent service API

All bodies are JSON. Every path except `/health` needs `Authorization: Bearer ${AGENT_SECRET}`, compared in constant time (`hmac.compare_digest`); the service refuses to start without `AGENT_SECRET`. Errors use Express's shape, `{ "error": { "code", "message" } }`.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/v1/turn` | Bearer | `{trigger: chat\|confirm\|schedule\|event, userId, channel, threadKey, requestId, text?, actionId?, skill?, language, today, allowLlm}`; `today` is the Vietnam date | **200** `{route: rules\|agent, text, facts[], sources[], action?, followups[], card?, steps[], timingsMs}`. `action` is a confirm card; `steps` lists the nodes the turn passed | 401 (bad or missing bearer); `VALIDATION_ERROR` (422: FastAPI's status for a bad body); `DUPLICATE` (409: the same `requestId` for this user); `AGENT_BUSY` (503) |
| POST | `/v1/receipt` | Bearer | `{userId, image (base64 of the bytes Express already holds), mime, platform, fileRef}` | **200** `{total, merchant, date, items[], currency, confidence, reconciliation, model, ms}`, or **200** `{error: NO_TOTAL\|UNREADABLE}` | 401; `VALIDATION_ERROR` (422); `RATE_LIMITED` (429: 30 a day); `AGENT_BUSY` (503); `AGENT_UNAVAILABLE` (503: vLLM down) |
| POST | `/v1/categorize` | Bearer | `{userId, note, merchant?, items?}` | **200** `{categoryId, score, method: embedding\|llm, alternatives[2]}` | 401; `VALIDATION_ERROR` (422); `AGENT_BUSY` (503) |
| GET | `/health` | — | — | **200** `{vllm: ok\|down, embedder: ok, model, gpuFreeMb}`; no user data | — |

- `platform` and `fileRef` in `/v1/receipt` fill `receiptReads`; the design names only `userId`, `image` and `mime`.
- **Budgets:** 25 s in chat, 40 s on the web, 60 s for a receipt. The turn carries a deadline; when too little time is left for a model call, the graph skips it and answers from the template.
- **Queue:** vLLM runs at most 8 sequences (`--max-num-seqs 8`). The agent service lets at most 16 requests wait; the 17th gets `AGENT_BUSY` (503).

### The graph

One compiled LangGraph `StateGraph` for turns, after the reference repo's `copilot_graph` (diagram and node table in §2.11.3):

```text
ingress → load_context ─┬─ chat ─────────→ rewrite_question → recall_memory → find_skills ─┐
                        ├─ schedule / event ───────────────────────────────→ decide ←──────┘
                        ├─ confirm ─────→ act                                 decide ⇄ act
                        └─ declined / expired / blocked ─→ generate_answer
   … → generate_answer → guard_output → suggest_followups → save_turn
```

**Routing functions** (pure functions of the state, one unit test each):

| Function | Goes to |
|---|---|
| `route_after_context` | `blocked` (over the cap, empty or too long) → `generate_answer`; `chat` → `rewrite_question`; `schedule` or `event` → `decide` (the skill is given); `confirm` on a `done` action → `act`; a declined or expired action → `generate_answer` |
| `route_after_search` | `retrieval: none` → `decide` with `hoi_tu_do` when the model is allowed, else `generate_answer` (the help text with 3 example questions); `direct` or `choose` → `decide` |
| `route_after_decide` | tool calls to run → `act`; an ask-back (`choose` with the model off) or nothing to run → `generate_answer` |
| `route_after_act` | an agent-mode skill that asks for more, with fewer than `max_steps` (4) rounds done → `decide`; else `generate_answer` |

**State** (`TurnState`, a `TypedDict`):

| Group | Fields |
|---|---|
| request | `userId`, `channel`, `threadKey`, `requestId`, `trigger`, `text`, `actionId`, `skill`, `language`, `today`, `allowLlm`, `deadline` |
| context | `user`, `categories`, `wallets`, `history` (the last 6 turns), `pendingAction`, `blocked` |
| understanding | `standalone`, `period`, `entities` (linked categories and wallets), `queryVector`, `memories` |
| routing | `candidates` (top 3 `{code, score}`), `retrieval`, `skillCode`, `askBack` |
| tools | `plan` (the next tool calls), `toolCalls` (`{tool, args, ok, ms, error?}`), `facts` (`{id, label, display}`), `round` |
| answer | `text`, `sources`, `action`, `card`, `followups`, `route`, `guard` |
| trace | `steps`, `timingsMs`, `promptTokens`, `completionTokens` |

**Tool registry** (`agent/tools/`). Each tool is one handler registered with:
- a **pydantic** model for its arguments (`extra='forbid'`), a description, `sideEffect` (`read` \| `proposal` \| `write_agent`), `timeoutMs` and the collections it reaches. On start the registry syncs `agentTools`.
- **`FORBIDDEN_ARGS = {'userId', 'token', 'query'}`.** They are removed from the JSON Schema the model sees, and a model output that contains one is rejected. Every handler gets a `ToolContext` (`userId`, `today`, `language`, `deadline`) from the request instead, and every query it runs starts with `{ userId }`. `query` is forbidden so the model can never pass raw MongoDB; `query_transactions` takes the typed query of §2.11.3, which our compiler turns into the pipeline.
- **Presets** from the skill's `tools[].preset` are applied over the model's arguments, so a preset always wins.
- Then pydantic validation, then the handler under `asyncio.wait_for(timeoutMs)`. A failed or timed-out call becomes a step with `ok: false`, never a crash; the answer then uses the template for a failure.
- At most `max_steps` (4) rounds of `decide ⇄ act` per turn. A pipeline skill runs its tools once, in `ord` order.
- `propose_action` only inserts a `pendingActions` row; `remember` only writes `agentMemory`. No tool writes the app's collections.

**Guided JSON.** `decide`, `read_receipt` and `llm_choose` call vLLM's OpenAI-compatible API with `response_format: {type: "json_schema"}`. The schema is built per request from the pydantic models: its enums are the user's own category and wallet ids and the skill's allowed periods. The result is validated again with pydantic; a failure falls back to the template answer, `NO_TOTAL` or Khác. Non-thinking mode only; temperature 0.2 for `decide` and `llm_choose`, 0.7 with top_p 0.8 for `read_receipt` and wording; `max_tokens` 512 (1024 for receipts).

**The guard** (`guard_output`, §2.11.4). The model writes `[[factId]]` placeholders and our code fills them. Its own text may hold no digit, number word or verdict word that is not in the facts, no id, JSON, URL, @handle or email, and no claim of a change that did not happen. Any failure → the template answer from this turn's tool results.

**Receipts and categories** are two small graphs in the same service, with no chat state:
- `receipt_graph`: `ingress → read_receipt → check_total → reconcile → save_turn`. `read_receipt` sends the image to the model with a guided-JSON schema. `check_total` applies §2.6's "payable total only" rules in code: the total must be a money-shaped number on a TOTAL / TỔNG CỘNG / THANH TOÁN line, or the largest money value after VAT; years, dates, phone numbers, numbers with a leading zero and document numbers are rejected. Otherwise `NO_TOTAL`, and the bot asks the user to type the amount, as today. `save_turn` writes `receiptReads`.
- `categorize_graph`: `embed_note → nearest_category → (tie) llm_choose → save_turn`. Nearest by embedding against `agentCategoryVectors` plus `agentMemory` hints; `llm_choose` runs only when the top 2 scores are within 0.05 and picks from the user's own category ids (an enum).

**Agent host environment** (`agent/.env`, never on Vercel):

| Variable | Example / rule |
|---|---|
| `AGENT_SECRET` | the same value as on Vercel (`openssl rand -hex 32`) |
| `MONGODB_URI_AGENT` | the `sochitieu_agent` user (custom role, [03-database.md §3.7](03-database.md)) |
| `VLLM_BASE_URL` | `http://127.0.0.1:8300/v1` |
| `LLM_MODEL` | `qwen3.5-2b` (vLLM's served name) |
| `EMBED_MODEL` | `BAAI/bge-m3` |
| `HF_HOME` | where model weights are cached |

**Module layout** (file names inside each folder are left to the builder):

```text
agent/
├── app.py            FastAPI app: /v1/turn, /v1/receipt, /v1/categorize, /health; bearer check, queue
├── graph/            TurnState, the turn graph with its route_after_* functions, receipt_graph, categorize_graph
├── nodes/            one module per node (ingress … save_turn, read_receipt, check_total, llm_choose)
├── skills/*.yaml     one file per skill; synced into agentSkills on start
├── tools/            the registry (pydantic args, FORBIDDEN_ARGS, presets, timeouts) and one module per tool;
│                     period.py (date phrases) and the typed-query compiler live here
├── prompts/          one system prompt per node, vi + en
├── eval/             skill_cases.yaml and the receipt and category sets; python -m agent.eval skills|receipts|categories
└── models.lock       pinned model revisions
```

### New and changed services in Express (§2.11.2)

| Function | Where | Used by |
|---|---|---|
| `pace({spent, limit, day, daysInMonth})` | `services/budgets.js`, pure | `listBudgets()` adds it to every budget; the confirm warning and the Budgets page |
| `confirmedInRange(start, end)` | `services/stats.js`, generalizes `confirmedInMonth` | Express's own reads (the agent's tools run the same `$match` in Python) |
| `compareRange({ from, to }, unit?)` | `utils/vnTime`, pure (built, T43) | `{ from, to }` as Vietnam dates `YYYY-MM-DD` → the period one `day`, `week`, `month` or `year` before it (the unit the dates imply when none is given; a range from the 1st to a month's last day is taken as a whole month, the gap fill of §2.11.3; a bad date, order or unit is a `RangeError`). The Dashboard's MonthCompare ("cùng kỳ tháng trước") follows the same rule in the browser, building its own ranges for the current month; `compare_periods` follows it in the agent service. All read `shared/fixtures/compare-range.json` |
| `draftHints()` | name only in §2.11; module left to the builder | A6, on bot drafts and in the quick-add preview |
| `detectRecurring()` | name only in §2.11; module left to the builder | B3 and `/dinhky` |
| `updateTransaction`, `deleteTransaction`, `restoreTransaction`, `copyBudgets`, `createBudget` | existing | A4, B4 and C3, so chat and web run the same code |

A7: when the parser fell back to Khác/Other, the draft offers the top 3 expense categories and, within 3 s, the agent's suggestion. The tap moves the draft and adds the note's first word to that category's `keywords` with `$addToSet`. On Zalo the user types the category name.

**Daily cron** (§2.11.2, B tier). `GET /api/cron/daily` checks the bearer secret, then runs one sequential loop over opted-in users (`users.notify` not `off`). For the B1 digest, B2 early warnings and the B4 reports (Sunday evening `tong_ket_tuan`; day 1 `tong_ket_thang` with next month's suggested budgets) it gets the text from `/v1/turn` with `trigger: schedule`, inserts the `notices` row, then sends. B3 recurring-bill drafts are made by Express (`detectRecurring()`). Every Zalo and WhatsApp send adds 1 to `channelUsage` (Zalo built in T49, WhatsApp with T70); proactive Zalo sends stop at 2,000 a month (`maySend('zalo', 'proactive')`). `POST /api/admin/cron/daily` runs the same loop.

**Logs.** In Express and in the agent service, only the turn id, node and error class; never the question, notes, figures or tool arguments. vLLM request logging stays off.

## 4.12 Email codes (§2.12; the mailer is built, the rest is planned)

**Built (T35): the mailer and the Gmail settings; nothing calls them yet.** The endpoints below, the `emailCodes` collection and the screens are planned; docs/02 §2.12 is the spec. The endpoints are in §4.4, the codes and limits in §4.3, and the `emailCodes` collection in [03-database.md §3.8](03-database.md).

**Mail** (§2.12.1, §2.12.5). Server-only dependency `nodemailer` 10.6.1, one module `services/mail.js`:

```js
sendCode({ to, purpose, code, language })   // to: one plain address; purpose: 'signup' | 'reset'; code: a string of 6 digits
canSendCodes()                              // can a code reach the user? false only in production without both Gmail settings
maskEmail('an.nguyen@gmail.com')            // 'a***@gmail.com'
setMailSender(deliver)                      // test seam, see below
```

- Gmail SMTP on port 465 (`smtp.gmail.com`; Vercel blocks only port 25), logged in with `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Free, about 500 emails a day.
- From `"Sổ chi tiêu" <GMAIL_USER>`, in the user's language, plain text plus simple HTML. Subject "Mã xác nhận Sổ chi tiêu: 123456" / "Your Sổ chi tiêu code: 123456". The body says what the code is for, that it is valid for 10 minutes, and to ignore the email if the user didn't ask for it. No links, no images, no tracking.
- **Modes** (read at call time): both settings set → SMTP, in every mode; not both, outside production → the log line `[mail] signup code for a***@gmail.com: 123456` (or `reset`); not both, in production → codes are off, `sendCode` rejects without logging the code, and callers ask `canSendCodes()` first.
- **SMTP:** `smtp.gmail.com`, port 465, TLS, with 15 s connection (DNS included), greeting and socket timeouts. A bad `purpose`, a code that is not 6 digits, or a `to` that is not one plain address is refused before anything is sent (the code goes into the HTML as it is, and `to` into a header: a CR LF, a comma or a name in it would add a header or a second recipient). Any `language` but `en` is Vietnamese.
- **Never leaked:** with mail on, the code and the full address are not logged. A failed send logs only `[mail] send failed for a***@gmail.com: <error code> <SMTP reply code>` and rejects with a plain `Error('the email could not be sent')` that has no `cause` (the nodemailer error and its message can repeat the address). The caller maps that rejection to `EMAIL_SEND_FAILED`; that code is not in the server yet.
- **Test seam:** `setMailSender(deliver)` replaces delivery in every mode, also with `GMAIL_*` unset; `deliver(request, message)` gets `{ to, purpose, code, language }` and the built nodemailer message. Called with nothing it restores the real delivery. Only test code calls it (a test checks that nothing in `server/src` does); this is how the E2E mail stub will read codes.
- Register awaits the send (a refusal → `EMAIL_SEND_FAILED` (503) and the row is deleted). `password/forgot` sends inside `waitUntil()`, so it answers as fast for an unknown address as for a real one.
- Where the code logic lives (`services/emailCodes.js` or inside `services/auth.js`) is left to the builder.

**Flows.**
- *Sign-up* (§2.12.2): register → 202 and a mailed code → `register/verify` → 201 and logged in, the same answer as today's register. `onUserRegistered()` runs only then.
- *Forgot password* (§2.12.3): `password/forgot` → 202 → `password/reset` with the code and a new password → 204 and `revokeAllSessions(userId)`, so every device, including a thief's, is logged out. A locked user gets no code.

**Without mail** (§2.12.4): see §4.2. Unit tests replace `services/mail.js` and read the code from the mock. The Playwright server (`e2e-server.js`) uses a test-only mail stub, like `bot-api-stub.js`, which never loads in production. If Google stops the account sending, switching mail off (delete both variables in the Vercel dashboard, or `tools/set-secret.sh --remove GMAIL_USER GMAIL_APP_PASSWORD`; docs/06 §6.14) and redeploying turns sign-up back to today's flow until it recovers.
