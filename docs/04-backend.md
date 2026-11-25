# 4. Backend (Express 5 on Vercel)

*Parts marked planned (§2.10) are not built yet. Each build PR updates the planned sections in the docs its card's Scope lists; where a card's Scope doesn't list them (T32), the orchestrator opens a docs-only follow-up PR after the merge.*

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
- *Planned (§2.10.4):* `/webhooks/whatsapp` checks an HMAC signature of the raw body instead of a secret header. The HMAC needs the exact bytes Meta sent, and re-serialising `req.body` does not give them back, so the global parser becomes `express.json({ limit, verify })`, where `verify` keeps the bytes as `req.rawBody` only when `req.originalUrl` starts with `/api/webhooks/whatsapp`. The order above does not change.

## 4.2 Configuration

`server/src/config/env.js` validates `process.env` with zod at startup. It fails fast (naming the variables, never their values) only when `MONGODB_URI` or `JWT_ACCESS_SECRET` (≥ 32 chars) is missing, or a variable that is set has a malformed value. Everything else is optional, so the API boots without it:

- no `KIE_URL` → `POST /receipts` answers 503 `FEATURE_NOT_CONFIGURED` for a valid JPEG/PNG upload (the missing-field 400 and the 415 come first; the bots say the receipt reader is not answering);
- no webhook secret → that platform's webhook answers 401 to everything;
- no `TELEGRAM_BOT_USERNAME` → `telegramDeepLink` is `null`;
- *planned (§2.10):* `links.telegram` replaces `telegramDeepLink` with the same rule; no `WHATSAPP_NUMBER` → `links.whatsapp` is `null`, and no `ZALO_BOT_URL` → `links.zalo` is `null`, so the link card hides that app (§2.10.2);
- *planned (§2.10), decided by card T34 (#74):* if any of the WhatsApp webhook settings `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` is unset, the WhatsApp webhook is disabled: `GET` and `POST /webhooks/whatsapp` answer 503 `FEATURE_NOT_CONFIGURED` and process nothing, and `links.whatsapp` is `null`, so the link card hides WhatsApp. Unlike Telegram and Zalo (401 without their secret), an unset setting is not treated as a failed check.

An empty value (`KIE_URL=`) counts as unset. Under `NODE_ENV=test` the required variables and the `APP_URL`, bot and KIE variables get harmless defaults, so the test suites run without `server/.env` (`MONGODB_DB` and the `SEED_*` variables stay unset).

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
| `WHATSAPP_ACCESS_TOKEN` *(planned, §2.10)* | permanent (system user) access token of the Meta app; sends messages and downloads receipt photos |
| `WHATSAPP_PHONE_NUMBER_ID` *(planned)* | the business number's ID in the Graph API messages URL |
| `WHATSAPP_APP_SECRET` *(planned)* | key of the `X-Hub-Signature-256` HMAC on webhook `POST`s |
| `WHATSAPP_VERIFY_TOKEN` *(planned)* | compared with `hub.verify_token` in the webhook's `GET` setup check |
| `WHATSAPP_NUMBER` *(planned)* | the business number, international format, digits only, for `wa.me` links |
| `ZALO_BOT_URL` *(planned)* | the bot's share link from Zalo Bot Creator (the link card's Zalo button) |
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
| Lock user (admin) | `status = locked` + revoke all sessions. The bots refuse the user's messages and buttons with a "locked" reply (except `/start CODE` and `/link CODE`, which are answered before the lock check). Login returns 403 `ACCOUNT_LOCKED` only after a correct password (a wrong one stays 401). Refresh returns 403 `ACCOUNT_LOCKED`: refresh checks the owner's status for any stored token, also one the lock already revoked, before the reuse check (BUG-011); an unknown token stays 401. Existing access tokens expire within 15 min. |
| `requireAuth` | Verifies the JWT, sets `req.user = { id, role, sid }`. Missing or invalid → 401 `UNAUTHENTICATED`; expired → 401 `TOKEN_EXPIRED` (the client then refreshes). |
| `requireRole('admin')` | `req.user.role !== 'admin'` → 403 `FORBIDDEN`. |
| Ownership | Services always query `{ _id, userId: req.user.id, deletedAt: null }`. Not found → 404 (never reveals other users' data). |
| Brute force | `express-rate-limit` on `/auth/login` and `/auth/register`: 10 **failed** attempts per 15 min per IP (`skipSuccessfulRequests`, so normal logins from a shared IP never count), then 429 `RATE_LIMITED`. `POST /chat-links/code` allows 5 codes per user per 10 min. On serverless the counters live in each instance's memory, so these are best-effort guards. |
| CSRF | Only the refresh endpoint uses the cookie. `SameSite=Strict` + same origin + POST-only stops cross-site use. All other endpoints use the Bearer header. |

Idea credit: ezBookkeeping stores every login as a `token_record` row so logout and revocation are real. Here that becomes the `sessions` collection with JWT access tokens.

## 4.4 REST API reference

All paths are prefixed with `/api`. Bodies are JSON unless noted. 🔒 = needs JWT, 👑 = admin only.

### Auth and sessions

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| POST | `/auth/register` | — | `{name, email, password, language?}` | **201** `{accessToken, user}` + cookie | 400, 409 `EMAIL_TAKEN`, 429 |
| POST | `/auth/login` | — | `{email, password}` | **200** `{accessToken, user}` + cookie | 400, 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_LOCKED`, 429 |
| POST | `/auth/refresh` | cookie | — | **200** `{accessToken, user}` + new cookie | 401 `INVALID_REFRESH`, 403 `ACCOUNT_LOCKED` |
| POST | `/auth/logout` | cookie | — | **204** | — |
| GET | `/auth/me` | 🔒 | — | **200** `{user}` | 401 |
| GET | `/sessions` | 🔒 | — | **200** `[{id, userAgent, ip, lastUsedAt, current}]` | 401 |
| DELETE | `/sessions/:id` | 🔒 | — | **204** (that device's whole chain, also when it rotated after the list was loaded) | 404 |
| DELETE | `/sessions` | 🔒 | `?others=true` (required) | **204** | 400 without it |
| PATCH | `/users/me` | 🔒 | `{name?, language?, theme?, defaultWalletId?}` | **200** `{user}` | 400, 404 |
| PATCH | `/users/me/password` | 🔒 | `{currentPassword, newPassword}` | **204** (also revokes other sessions) | 400, 401 `INVALID_CREDENTIALS` |

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
| GET | `/budgets` | 🔒 | `?month=YYYY-MM` (optional, default the current Vietnamese month) | **200** `[{…, spent, percent}]` | 400 |
| POST | `/budgets` | 🔒 | `{month, categoryId\|null, limit}` | **201** | 400 (also when the category is not an expense category), 404, 409 `BUDGET_EXISTS` |
| POST | `/budgets/copy` | 🔒 | `{from: 'YYYY-MM', to: 'YYYY-MM'}` | **201** `{created: n}` | 400 |
| PATCH | `/budgets/:id` | 🔒 | `{limit}` | **200** | 400, 404 |
| DELETE | `/budgets/:id` | 🔒 | — | **204** | 404 |

### Transactions, statistics, receipts

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/transactions` | 🔒 | `?from&to&type&walletId&categoryId&status&source&q&page=1&limit=20&sort=-occurredAt` | **200** `{items, page, limit, total}` | 400 |
| POST | `/transactions/parse` | 🔒 | `{text}` (≤ 2000 chars; web quick add; same parser as the bots) | **200** `{drafts:[{type, amount, categoryId, walletId, occurredAt, note}], noAmountLines:[3], truncated}`: `noAmountLines` are the line numbers with no usable amount (none, 0, or over 10^13), `truncated` is true past 10 lines; nothing is saved | 400, 422 `NO_AMOUNT_FOUND` (no line is readable) |
| POST | `/transactions` | 🔒 | `{type, amount, walletId, categoryId, occurredAt, note?}` | **201** (status `confirmed`) | 400, 404 (wallet/category) |
| GET | `/transactions/:id` | 🔒 | — | **200** | 404 |
| PATCH | `/transactions/:id` | 🔒 | any editable field | **200** | 400, 404 |
| DELETE | `/transactions/:id` | 🔒 | — | **204** (soft) | 404 |
| POST | `/transactions/:id/restore` | 🔒 | — | **200** (undo delete) | 404 |
| POST | `/transactions/:id/confirm` | 🔒 | optional edits, same fields as PATCH (the Bot inbox) | **200** `{transaction, budgetWarning?}`; the edits and the confirm are one write that only matches a draft | 400, 404, 409 `ALREADY_CONFIRMED` (nothing changed) |
| GET | `/stats/summary` | 🔒 | `?month=YYYY-MM` | **200** `{income, expense, net, budget:{limit, spent}}` (`budget` is `null` without an overall budget) | 400 |
| GET | `/stats/by-category` | 🔒 | `?month=&type=expense` | **200** `[{categoryId, name, total, percent}]` | 400 |
| GET | `/stats/daily` | 🔒 | `?month=` | **200** `[{date, income, expense}]` | 400 |
| POST | `/receipts` | 🔒 | `multipart/form-data` field `image` (JPEG/PNG; the client resizes first, the server accepts up to 4.5 MB) | **201** `{transaction (draft)}` | 400 (no `image` field), 413, 415, 422 `RECEIPT_UNREADABLE`, 502 `KIE_UNAVAILABLE`, 503 `FEATURE_NOT_CONFIGURED` (no `KIE_URL`), 504 `KIE_TIMEOUT` |

### Bot linking

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/chat-links/code` | 🔒 | — | **201** `{code, expiresAt, telegramDeepLink}` (`null` without `TELEGRAM_BOT_USERNAME`). *Planned (§2.10.2):* **201** `{code, expiresAt, links:{telegram, whatsapp, zalo}}` (each a URL or `null`) instead of `telegramDeepLink`; the client changes in the same PR | 429 `RATE_LIMITED` (5 per user per 10 min) |
| POST | `/chat-links/claim/preview` *(planned, §2.10.3)* | 🔒 | `{token}` | **200** `{platform, displayName}`; the token is not spent | `LINK_TOKEN_INVALID` (404: unknown, used or expired) |
| POST | `/chat-links/claim` *(planned, §2.10.3)* | 🔒 | `{token}` | **201** `{id, platform, displayName, createdAt, viaClaim: true}` | `LINK_TOKEN_INVALID` (404); `CHAT_ALREADY_LINKED` (409: that chat was linked meanwhile; the token is still spent) |
| GET | `/chat-links` | 🔒 | — | **200** `[{id, platform, displayName, createdAt}]`. *Planned (§2.10.5):* each item also has `viaClaim` and `claimNoticeDismissedAt` | — |
| DELETE | `/chat-links/:id` | 🔒 | — | **204** | 404 |
| PATCH | `/chat-links/:id/claim-notice` *(planned, §2.10.5)* | 🔒 | — | **204**; sets `claimNoticeDismissedAt` to now (own links only) | 404 (another user's or unknown id) |

*Planned error codes are written `CODE` (status) in this section until the build PR adds `errors.LINK_TOKEN_INVALID` and `errors.CHAT_ALREADY_LINKED` (vi + en): TC-F12-03 reads codes written as status-then-code from this file and requires a translation for each.*

**Link card links** *(planned, §2.10.2)*: `links.telegram` is `https://t.me/<bot>?start=<CODE>` (as today), `links.whatsapp` is `https://wa.me/<WHATSAPP_NUMBER>?text=%2Flink%20<CODE>` (the chat opens with `/link CODE` typed), and `links.zalo` is `ZALO_BOT_URL` (a Zalo bot link carries no payload, so the card copies `/link CODE` to the clipboard before opening it). The code itself is unchanged: 6 characters, 10 minutes, single use, 5 per user per 10 minutes.

**Linking from the chat** *(planned, §2.10.3)*: the bot hands an unlinked chat a claim link (see §4.6, step 4), and the website's `/link?t=<token>` screen spends it through the two endpoints above.
- Tokens travel in the body, never in a URL the server logs. Both endpoints need login.
- Both only match `linkCodes` rows that have `chat` (claim links), so a website code is `LINK_TOKEN_INVALID` here; in the other direction `/start CODE` and `/link CODE` only match rows that have `userId`, so a claim token never works in the chat.
- `/claim` is one atomic update, as `/link CODE` is today: the row must be unused, unexpired and a claim link, and it is marked used. Then a `chatLinks` row is created from its `chat` (`platform`, `platformUserId`, `chatId`, `displayName`) for the logged-in user. If that chat got linked in the meantime, the unique `(platform, platformUserId)` index refuses the row → `CHAT_ALREADY_LINKED` (409).
- After a 201 the bot sends the chat the same text as a `/link CODE` success ("Đã liên kết với tài khoản <name>" / "Linked to the account of <name>") in the user's language. How that send runs (inside the request or `waitUntil`) and what happens when it fails are left to the builder.
- Responses carry only `platform` and `displayName`, never `platformUserId` or `chatId`.
- Phishing (§2.10.3): an attacker can send their own chat's claim link to a victim; if the victim confirms, the attacker's chat is linked to the victim's account and can read `/today` and `/month` and create and confirm transactions there (not the web login). The display name is not proof. Mitigations: the warning on the `/link` confirm screen, the 10-minute single-use token, and a Bot inbox notice "New chat linked from a chat link: **Zalo · Anh**. Not you? [Unlink]". The server records it on `chatLinks`: `viaClaim` (boolean, default `false`; `/claim` sets `true`) and `claimNoticeDismissedAt` (date or `null`). The notice shows for every link with `viaClaim && !claimNoticeDismissedAt`; Unlink is the existing `DELETE /chat-links/:id`, and `PATCH /chat-links/:id/claim-notice` dismisses it (`claimNoticeDismissedAt = now`, 204; 404 for another user's or an unknown id).

### Admin 👑

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/admin/users` | `?q&role&status&page&limit` | **200** `{items, total}` | 403 |
| PATCH | `/admin/users/:id` | `{role?, status?}` | **200** | 400, 403, 404, 409 `LAST_ADMIN` |
| GET | `/admin/categories` | `?type=` | **200** templates (stores the built-in defaults first if there are none) | 403 |
| POST | `/admin/categories` | `{type, names:{vi,en}, keywords?, icon?, color?}` | **201** | 400, 403 |
| PATCH | `/admin/categories/:id` | same fields except `type` (fixed) | **200** | 400, 403, 404 |
| DELETE | `/admin/categories/:id` | — | **204** | 403, 404, 409 `FALLBACK_CATEGORY` |
| GET | `/admin/stats` | — | **200** `{users, activeUsers7d, chatLinks:{telegram, zalo}, transactionsBySource}`. *Planned (§2.10.5):* `chatLinks` and `transactionsBySource` gain `whatsapp` | 403 |

### Webhooks and health

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| POST | `/webhooks/telegram` | header `X-Telegram-Bot-Api-Secret-Token` | **200** (always, after the secret check) | 401 bad secret |
| POST | `/webhooks/zalo` | header `X-Bot-Api-Secret-Token` (timing-safe compare) | **200** | 401 bad secret |
| GET | `/webhooks/whatsapp` *(planned, §2.10.4)* | query `hub.mode=subscribe` and `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN` (Meta's setup check) | **200** `hub.challenge` as plain text | 403; 503 `FEATURE_NOT_CONFIGURED` (a WhatsApp webhook setting unset, §4.2) |
| POST | `/webhooks/whatsapp` *(planned, §2.10.4)* | header `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET>` (constant-time compare) | **200** (also for status updates, which are ignored) | 401 bad signature, nothing processed; 503 `FEATURE_NOT_CONFIGURED` (a WhatsApp webhook setting unset, §4.2) |
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
| 401 | Not logged in, bad or expired token, wrong password, bad webhook secret; *planned (§2.10.4):* bad WhatsApp signature |
| 403 | Logged in but not allowed (role), account locked; *planned (§2.10.4):* WhatsApp setup check (`GET /webhooks/whatsapp`) with a wrong verify token |
| 404 | Resource not found **or not yours**; *planned (§2.10.3):* `LINK_TOKEN_INVALID` (claim token unknown, used, expired, or a website code) |
| 409 | Unique conflict (`EMAIL_TAKEN`, `NAME_TAKEN`, `BUDGET_EXISTS`, else generic `CONFLICT`), resource in use, fallback category, last admin, already confirmed; *planned (§2.10.3):* `CHAT_ALREADY_LINKED` (the claimed chat was linked meanwhile) |
| 413 / 415 | Body too large (`PAYLOAD_TOO_LARGE`) / image not JPEG or PNG (`UNSUPPORTED_MEDIA_TYPE`) |
| 422 | `RECEIPT_UNREADABLE` (no total found, or KIE could not open the image); `NO_AMOUNT_FOUND` (quick-add text with no readable amount) |
| 429 `RATE_LIMITED` | Rate limited |
| 502 / 504 | KIE service down / timed out |
| 503 | `FEATURE_NOT_CONFIGURED` (missing optional env, §4.2); `/health` when the database is down (body `{status:'error', db:'down'}`, not the error shape) |
| 500 `INTERNAL` | Anything unexpected (logged with request id; the message is hidden from clients) |

Implementation: an `AppError(status, code, message, details)` class; Mongoose `E11000` → 409 `CONFLICT` (when no service mapped it first); `CastError` → 400; zod error → 400; other 4xx errors from Express or the body parser keep their status. A Mongoose `ValidationError` is not mapped, so it becomes 500 `INTERNAL` (input is normally rejected by zod before it gets that far). Express 5 forwards rejected async handlers to the error middleware without wrappers.

## 4.6 Bot core and adapters

```text
server/src/bot/
├── core.js        handleMessage(adapter, message), handleButton(platform, platformUserId, action, txId), messagesFor(lang)
├── parser.js      parseText(text, ctx) → one result per line (first 10)
│                  parseLine(text, {categories, wallets, defaultWalletId, now}) → {type, amount, categoryId, walletId, occurredAt, note} | null
│                  bestCategory(categories, text), onDay(now, year, month, day)
├── messages.vi.js / messages.en.js   all bot reply texts
├── telegram.js    map update → core calls, sendMessage/editMessageText/answerCallbackQuery/getFile
└── zalo.js        map event → core calls, sendMessage
```

The secret check lives in `routes/webhooks.js`, before either adapter runs. *Planned (§2.10.4):* a third adapter for WhatsApp (file layout left to the builder), whose signature check runs at the same point; see **WhatsApp specifics** below.

**Adapter contract** (what `core.js` needs from each platform):

```js
{
  platform: 'telegram' | 'zalo',           // planned: | 'whatsapp' (§2.10.4)
  sendText(chatId, text),
  sendDraft(chatId, { id, text }, lang),   // Telegram: inline keyboard; Zalo: text + "ok / huy" hint; WhatsApp (planned): button message
  downloadPhoto(ref) → Buffer
}
```

**Webhook handling** (both platforms; WhatsApp *(planned)* follows steps 1, 2, 4 and 5, with its signature check in step 1 and Meta retrying any delivery that does not get a 200; step 3 has no WhatsApp equivalent in §2.10, see **WhatsApp specifics**):

1. Check the secret header, comparing with `crypto.timingSafeEqual`. A mismatch returns 401.
2. Reply **200 immediately**, then run the adapter's handler (`handleTelegramUpdate` / `handleZaloEvent`) inside `waitUntil`. The platform does not retry, and the slow work (KIE ~20 s) continues inside the 300 s function limit. Failures are only logged.
3. Only messages from **private chats** are handled (Telegram `chat.type = private`, Zalo `chat.chat_type = PRIVATE`); in a group other people would see the money, so those messages are dropped. Telegram button presses (`callback_query`) are handled before this check, with no chat-type test (drafts, and so their buttons, are only sent to private chats).
4. `handleMessage` looks up `chatLinks` by `(platform, platformUserId)`. If there is none, only `/start CODE` and `/link CODE` are accepted; everything else gets the "please link" reply. A linked but locked user gets the "locked" reply to everything else (`/start CODE` and `/link CODE` are answered before the lock check).
   *Planned (§2.10.3), on every platform:* the "please link" reply also carries a **claim link**. For anything except `/start CODE` or `/link CODE` (a wrong or expired code counts as "anything"), the bot deletes any older live claim link of this chat, so a chat has at most one, then stores a new one in `linkCodes`: a random 32-character base64url token (24 bytes), kept only as its SHA-256, 10 minutes, single use, with `chat: { platform, platformUserId, chatId, displayName }` and no `userId`. The reply, in both languages, is the current "please link" text plus "Or tap to link: `<APP_URL>/link?t=<token>` (valid 10 minutes)". The website spends the token through `POST /chat-links/claim` (§4.4).
5. Idempotency: each draft carries `chatRef = (platform, chatId, '<messageId>:<line>')`, and the unique partial index turns a duplicate delivery of a text or photo message into no second draft and no second reply. Typed `ok` / `huy`, commands and Zalo amount-only corrections are not deduplicated: delivered twice, they run twice (a second `ok` acts on the next waiting draft; a correction is applied and the draft sent again). For a photo the core first checks whether that `chatRef` already exists, so a redelivered photo is not sent to KIE again. *Planned (§2.10.4):* WhatsApp's message `id` (`wamid…`) is the `messageId`, so the same rules hold there.

**Bot commands** (same on both platforms, and on WhatsApp once built, §2.10.4):

| Input | Reply |
|---|---|
| `/today` | today's spent and received |
| `/month` | this month's spent and received, the overall budget, then each category budget, fullest first |
| `/lang vi\|en` | switches the reply language (the same setting as the web Settings page) |
| `/help`, `/start` without a code, any unknown command | the help text |
| text lines | one draft per line with an amount; if no line has an amount, the help text. Lines without a usable amount get a "not recorded" reply naming their line numbers |
| `ok` / `huy` | confirms / discards `chatLinks.pendingTransactionId` while it is still a draft, else the newest draft of this chat that still waits (several lines make several drafts); the reply names the next waiting draft. Works on both platforms |

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
- ⚠️ The payload shape comes from community SDKs (see sources in [06-deployment.md](06-deployment.md)). Log the first real webhook body during setup and adjust if it differs.

**WhatsApp specifics** *(planned, §2.10.4; Meta's WhatsApp Cloud API directly, `https://graph.facebook.com/<version>/…`)*:
- Webhook `/api/webhooks/whatsapp`, subscribed to the `messages` field (Meta app setup goes in [06-deployment.md](06-deployment.md)). `GET` is Meta's setup check: `hub.mode=subscribe` and `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN` → 200 with `hub.challenge` as plain text, otherwise 403. `POST` must carry `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of req.rawBody with WHATSAPP_APP_SECRET>` (raw bytes kept by the parser's `verify`, §4.1), compared in constant time; otherwise 401 and nothing is processed. A platform with missing settings is skipped by the webhook-registration script (`scripts/setWebhooks.js`); what that script does for WhatsApp is left to the builder.
- Body: read `entry[].changes[].value`. `messages[]` are handled; `statuses[]` (sent/delivered/read) are ignored. Both get 200, so Meta doesn't retry.
- Incoming message → core message: `platformUserId` and `chatId` are the user's **business-scoped user ID** (BSUID: `from_user_id` on the message, `user_id` on the contact). Meta omits `from` (the phone number) for users who adopted a WhatsApp username, so the phone number is never the key and is never stored. `displayName` is `value.contacts[0].profile.name`; `messageId` is the message `id` (`wamid…`). `type: text` → `text.body`; `type: image` → `photo` = `image.id`; `type: interactive` with `button_reply` → a button press (`handleButton`) decoded from `button_reply.id`; other types (audio, sticker, location…) → the help text. §2.10.4 names no group-chat check like step 3; that is left to the builder.
- Sending: `POST https://graph.facebook.com/<version>/<WHATSAPP_PHONE_NUMBER_ID>/messages` with the access token, `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `recipient: <BSUID>` (no `to`: Meta reserves `to` for phone numbers), and either `type: "text"` or `type: "interactive"` with `interactive.type: "button"`. The Graph API version is one constant in the adapter, pinned at build time. `sendText` splits long replies at 4096 characters. A button message's body is at most 1024 characters and each button title at most 20 (§2.4). Meta lets the bot reply only within 24 hours of the user's last message (§2.10.1).
- Drafts (`sendDraft`): a button message with **✅ Lưu**, **❌ Huỷ**, **✏️ Sửa**. The button ids carry the same action and draft id as Telegram's `callback_data` (`c:<txId>` / `x:<txId>`), so `handleButton`'s existing confirm/discard path is reused; how the ids are encoded within WhatsApp's 256-character id limit is left to the builder. Reply buttons cannot open a URL, so ✏️ Sửa makes the bot reply with `<APP_URL>/bot`. §2.10.4 does not say how the `{ ok, text }` result of a press is shown in the chat; left to the builder.
- Receipts (`downloadPhoto`): `GET /<image.id>` with the access token gives a `url` valid for 5 minutes; download it with the same token and pass the bytes to KIE as on the other platforms.
- Every closed list of platforms gains `whatsapp` (§2.10.5): the Mongoose enums `chatLinks.platform`, `transactions.source` and `transactions.chatRef.platform` (without the last, every WhatsApp draft fails validation), the zod `source` filter of `GET /transactions` (`routes/transactions.js`), and the platform/source lists of `GET /admin/stats` (`services/admin.js`).
- Privacy: no phone number is stored or returned; the web shows the WhatsApp profile name, and admin stats count chats per platform without identifiers.
- Locked accounts, `/today`, `/month`, `/lang`, `/help` and budget alerts behave exactly as on Telegram and Zalo.

## 4.7 Text parser

Specified in [02-features.md §2.5](02-features.md#25-text-parser-rules-rule-based-no-ai). It is a pure function with **unit tests** (Vitest, case TC-F8-01/02 in [07-testing.md](07-testing.md)), one table-driven test per row of the rules. The same function serves the web quick-add preview (`POST /transactions/parse`). This is the easiest part to demo and explain.

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

## 4.9 Vercel limits that shape the code

| Limit (Hobby) | Effect |
|---|---|
| Function max duration **300 s** (default 300 s with Fluid compute) | Covers the KIE call (~20 s; 120 s timeout). `waitUntil` work shares this limit |
| Request/response body **4.5 MB** | Web receipt uploads are resized in the browser (≤ 1600 px JPEG). Bots download photos server-side, so no limit there |
| One Express function, 250 MB bundle | Keep server dependencies small; nothing native |
| `express.static` is ignored | The SPA is served by Vercel's CDN from `client/dist` |
| Instances are ephemeral | No in-memory state that matters (rate limit is best-effort); all state in MongoDB |

## 4.10 Security checklist

- [ ] `.env` git-ignored; `.env.example` lists names only; secrets set in Vercel → Settings → Environment Variables.
- [ ] Webhook secrets checked with timing-safe compare before the update is processed (the global `express.json` has already parsed the body).
- [ ] *Planned (§2.10.4):* WhatsApp `X-Hub-Signature-256` checked against an HMAC-SHA256 of `req.rawBody` with `WHATSAPP_APP_SECRET`, in constant time, before anything is processed (401 otherwise); the `GET` setup check answers 403 unless `hub.verify_token` equals `WHATSAPP_VERIFY_TOKEN`.
- [ ] *Planned (§2.10.3):* claim tokens are 24 random bytes, stored only as SHA-256, single use, 10 min, at most one live per chat; they travel in request bodies, never in a URL the server logs; claiming needs login plus the Confirm step and spends the token in one atomic update.
- [ ] *Planned (§2.10.4):* no WhatsApp phone number stored or returned (chats are keyed by BSUID).
- [ ] *Planned, open (not stated by §2.10):* `middleware/requestId.js` logs `req.originalUrl`, and Meta's `GET` setup check carries `hub.verify_token` in the query, so `WHATSAPP_VERIFY_TOKEN` would reach the Vercel logs. The builder either redacts the `hub.*` query in the request log for `/api/webhooks/whatsapp` or accepts it (the token only guards the setup check).
- [ ] Every query scoped by `userId`; admin cannot read users' transactions.
- [ ] Passwords hashed with bcrypt; refresh tokens and link codes stored hashed; link codes single-use, 10 min TTL.
- [ ] `helmet`; JSON body limit 1 MB; zod on every input; `mongoose.set('sanitizeFilter', true)` against operator injection.
- [ ] Atlas: dedicated DB user with `readWrite` on one database only; strong password (the network allows `0.0.0.0/0`, see deployment doc).
- [ ] KIE protected by `X-KIE-Key`.
- [ ] Last admin cannot demote or lock themselves (`409 LAST_ADMIN`).
