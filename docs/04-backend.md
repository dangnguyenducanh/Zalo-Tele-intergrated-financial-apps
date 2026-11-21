# 4. Backend (Express 5 on Vercel)

## 4.1 How the API runs

- `server/src/app.js` builds and **exports** the Express app. It never calls `listen`.
- `api/index.js` re-exports that app, so Vercel turns it into **one Vercel Function** (Fluid compute, Hobby limit 300 s per invocation).
- `server/src/local.js` calls `app.listen(3000)` for local development. The Vite dev server proxies `/api` to it.
- `vercel.json` routes `/api/*` to the function and everything else to the SPA (see [06-deployment.md](06-deployment.md)).

**Middleware order** (in `app.js`):

```text
helmet → express.json({ limit: '1mb' }) → cookie-parser → requestId/logger
→ /api/webhooks/*   (secret-header check, no JWT)
→ /api/auth/*       (rate-limited)
→ requireAuth       (JWT) → routers for wallets, categories, transactions, budgets, stats, receipts, chat-links, sessions, users
→ requireRole('admin') → /api/admin/*
→ notFound (404) → errorHandler
```

## 4.2 Configuration

`server/src/config/env.js` validates `process.env` with zod at startup and fails fast if anything is missing.

| Variable | Example / rule |
|---|---|
| `MONGODB_URI` | `mongodb+srv://…/finance?retryWrites=true&w=majority` |
| `MONGODB_DB` | optional; overrides the database name (each agent worktree uses `finance_wt<n>`, set by `tools/wt-env.sh`) |
| `PORT` | local API port, default 4100 (worktrees: `4100+10n`; Vite uses `VITE_PORT`, `5300+10n`) |
| `JWT_ACCESS_SECRET` | ≥ 32 random bytes (`openssl rand -hex 32`) |
| `ACCESS_TOKEN_TTL` | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | `7` |
| `APP_URL` | `https://<project>.vercel.app` (used in bot links) |
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_BOT_USERNAME` | for deep links |
| `TELEGRAM_WEBHOOK_SECRET` | 1–256 chars `[A-Za-z0-9_-]` |
| `ZALO_BOT_TOKEN` | from Zalo Bot Platform |
| `ZALO_WEBHOOK_SECRET` | 8–256 chars |
| `KIE_URL` | `https://<tunnel-host>` |
| `KIE_API_KEY` | shared secret sent as `X-KIE-Key` (see §4.8) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | used by `npm run seed` only |

**DB connection on serverless:** `config/db.js` keeps a module-level cached `mongoose.connect()` promise, so warm invocations reuse one connection. It also calls `attachDatabasePool(mongoose.connection.getClient())` from `@vercel/functions` so idle connections are released properly under Fluid compute. Every route awaits `connectDb()` through a tiny middleware.

## 4.3 Authentication and authorization

| Piece | Design |
|---|---|
| Password hashing | `bcryptjs`, cost **10**. Min length 8. Hashes never leave the server (`select: false`). |
| Access token | **JWT HS256**, 15 min, claims `{ sub: userId, role, sid: sessionId }`. Sent as `Authorization: Bearer <jwt>`. Verified with `algorithms: ['HS256']`. |
| Refresh token | 32 random bytes (base64url). Sent only as cookie **`rt`**: `HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=7d`. Stored only as a SHA-256 hash in `sessions`. |
| Rotation | Every `/auth/refresh` revokes the old session row, creates a new one (`replacedBy`), and sets a new cookie. |
| Reuse detection | If a refresh token belonging to an **already rotated** session is presented, all of that user's sessions are revoked (the token was probably stolen) → 401. **Grace window (BUG-003):** if it comes back within **30 s** of its rotation and its replacement has never been refreshed, the answer was most likely lost (navigation, reload, network drop), so the unused replacement is revoked and the token is rotated once more (200). One valid chain remains, and a reuse after the replacement was refreshed, or after 30 s, is still treated as theft. **Revoke all wins races (BUG-006):** revoking every session first stamps `users.sessionsRevokedAt`; a refresh that was rotating at the same moment checks that stamp (and the account status) after opening its new session. If every session was revoked after the login that began its chain (`sessions.chainStartedAt`), it revokes the new session and answers 401 `INVALID_REFRESH`, or 403 `ACCOUNT_LOCKED` when the cause was an admin lock. |
| Logout | Revokes the current session, clears the cookie → 204. |
| Log out others | Revokes all sessions except `sid` → 204. |
| Lock user (admin) | `status = locked` + revoke all sessions. Login and refresh return 403 `ACCOUNT_LOCKED`. Existing access tokens expire within 15 min. |
| `requireAuth` | Verifies the JWT, sets `req.user = { id, role, sid }`. Missing or invalid → 401 `UNAUTHENTICATED`; expired → 401 `TOKEN_EXPIRED` (the client then refreshes). |
| `requireRole('admin')` | `req.user.role !== 'admin'` → 403 `FORBIDDEN`. |
| Ownership | Services always query `{ _id, userId: req.user.id, deletedAt: null }`. Not found → 404 (never reveals other users' data). |
| Brute force | `express-rate-limit` on `/auth/login` and `/auth/register` (10 per 15 min per IP). On serverless the counter lives in each instance's memory, so this is a best-effort guard. |
| CSRF | Only the refresh endpoint uses the cookie. `SameSite=Strict` + same origin + POST-only stops cross-site use. All other endpoints use the Bearer header. |

Idea credit: ezBookkeeping stores every login as a `token_record` row so logout and revocation are real. Here that becomes the `sessions` collection with JWT access tokens.

## 4.4 REST API reference

All paths are prefixed with `/api`. Bodies are JSON unless noted. 🔒 = needs JWT, 👑 = admin only.

### Auth and sessions

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| POST | `/auth/register` | — | `{name, email, password, language?}` | **201** `{accessToken, user}` + cookie | 400, 409 `EMAIL_TAKEN`, 429 |
| POST | `/auth/login` | — | `{email, password}` | **200** `{accessToken, user}` + cookie | 400, 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_LOCKED`, 429 |
| POST | `/auth/refresh` | cookie | — | **200** `{accessToken, user}` + new cookie | 401 `INVALID_REFRESH` |
| POST | `/auth/logout` | cookie | — | **204** | — |
| GET | `/auth/me` | 🔒 | — | **200** `{user}` | 401 |
| GET | `/sessions` | 🔒 | — | **200** `[{id, userAgent, ip, lastUsedAt, current}]` | 401 |
| DELETE | `/sessions/:id` | 🔒 | — | **204** | 404 |
| DELETE | `/sessions` | 🔒 | `?others=true` | **204** | — |
| PATCH | `/users/me` | 🔒 | `{name?, language?, theme?, defaultWalletId?}` | **200** `{user}` | 400, 404 |
| PATCH | `/users/me/password` | 🔒 | `{currentPassword, newPassword}` | **204** (also revokes other sessions) | 400, 401 `INVALID_CREDENTIALS` |

### Wallets, categories, budgets

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/wallets` | 🔒 | `?includeArchived=` | **200** `[{…, balance}]` | — |
| POST | `/wallets` | 🔒 | `{name, type, initialBalance, aliases?, color?, icon?}` | **201** | 400, 409 `NAME_TAKEN` |
| GET | `/wallets/:id` | 🔒 | — | **200** | 404 |
| PATCH | `/wallets/:id` | 🔒 | any field above, `archived?` | **200** | 400, 404, 409 |
| DELETE | `/wallets/:id` | 🔒 | — | **204** | 404, 409 `WALLET_IN_USE` |
| GET | `/categories` | 🔒 | `?type=expense\|income` | **200** | — |
| POST | `/categories` | 🔒 | `{type, name, keywords?, icon?, color?}` | **201** | 400, 409 |
| PATCH | `/categories/:id` | 🔒 | same fields | **200** | 400, 404 |
| DELETE | `/categories/:id` | 🔒 | — | **204** (its transactions move to the fallback category) | 404, 409 `FALLBACK_CATEGORY` |
| GET | `/budgets` | 🔒 | `?month=YYYY-MM` | **200** `[{…, spent, percent}]` | 400 |
| POST | `/budgets` | 🔒 | `{month, categoryId|null, limit}` | **201** | 400, 404, 409 `BUDGET_EXISTS` |
| POST | `/budgets/copy` | 🔒 | `{from: 'YYYY-MM', to: 'YYYY-MM'}` | **201** `{created: n}` | 400 |
| PATCH | `/budgets/:id` | 🔒 | `{limit}` | **200** | 400, 404 |
| DELETE | `/budgets/:id` | 🔒 | — | **204** | 404 |

### Transactions, statistics, receipts

| Method | Path | Auth | Body / query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/transactions` | 🔒 | `?from&to&type&walletId&categoryId&status&source&q&page=1&limit=20&sort=-occurredAt` | **200** `{items, page, limit, total}` | 400 |
| POST | `/transactions/parse` | 🔒 | `{text}` (web quick add; same parser as the bots) | **200** `{drafts:[{type, amount, categoryId, walletId, occurredAt, note}]}`; nothing is saved | 400, 422 `NO_AMOUNT_FOUND` |
| POST | `/transactions` | 🔒 | `{type, amount, walletId, categoryId, occurredAt, note?}` | **201** (status `confirmed`) | 400, 404 (wallet/category) |
| GET | `/transactions/:id` | 🔒 | — | **200** | 404 |
| PATCH | `/transactions/:id` | 🔒 | any editable field | **200** | 400, 404 |
| DELETE | `/transactions/:id` | 🔒 | — | **204** (soft) | 404 |
| POST | `/transactions/:id/restore` | 🔒 | — | **200** (undo delete) | 404 |
| POST | `/transactions/:id/confirm` | 🔒 | — | **200** `{transaction, budgetWarning?}` | 404, 409 `ALREADY_CONFIRMED` |
| GET | `/stats/summary` | 🔒 | `?month=YYYY-MM` | **200** `{income, expense, net, budget:{limit, spent}}` | 400 |
| GET | `/stats/by-category` | 🔒 | `?month=&type=expense` | **200** `[{categoryId, name, total, percent}]` | 400 |
| GET | `/stats/daily` | 🔒 | `?month=` | **200** `[{date, income, expense}]` | 400 |
| POST | `/receipts` | 🔒 | `multipart/form-data` field `image` (JPEG/PNG, ≤ 4 MB after client resize) | **201** `{transaction (draft)}` | 400, 413, 415, 422 `RECEIPT_UNREADABLE`, 502 `KIE_UNAVAILABLE`, 504 `KIE_TIMEOUT` |

### Bot linking

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/chat-links/code` | 🔒 | — | **201** `{code, expiresAt, telegramDeepLink}` | 429 |
| GET | `/chat-links` | 🔒 | — | **200** `[{id, platform, displayName, createdAt}]` | — |
| DELETE | `/chat-links/:id` | 🔒 | — | **204** | 404 |

### Admin 👑

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/admin/users` | `?q&role&status&page&limit` | **200** `{items, total}` | 403 |
| PATCH | `/admin/users/:id` | `{role?, status?}` | **200** | 400, 403, 404, 409 `LAST_ADMIN` |
| GET | `/admin/categories` | `?type=` | **200** templates | 403 |
| POST | `/admin/categories` | `{type, names:{vi,en}, keywords, icon, color}` | **201** | 400, 403 |
| PATCH | `/admin/categories/:id` | same | **200** | 400, 403, 404 |
| DELETE | `/admin/categories/:id` | — | **204** | 403, 404 |
| GET | `/admin/stats` | — | **200** `{users, activeUsers7d, chatLinks:{telegram, zalo}, transactionsBySource}` | 403 |

### Webhooks and health

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| POST | `/webhooks/telegram` | header `X-Telegram-Bot-Api-Secret-Token` | **200** (always, after the secret check) | 401 bad secret |
| POST | `/webhooks/zalo` | header `X-Bot-Api-Secret-Token` (timing-safe compare) | **200** | 401 bad secret |
| GET | `/health` | — | **200** `{status:'ok', db:'up'}` | 503 |

## 4.5 Errors and status codes

Every error goes through one `errorHandler` and has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "amount must be a positive integer", "details": [{ "path": "amount", "issue": "too_small" }] } }
```

| Status | When |
|---|---|
| 200 / 201 / 204 | OK / created / deleted or no body |
| 400 `VALIDATION_ERROR` | zod validation failed (body, query, params, bad ObjectId) |
| 401 | Not logged in, bad or expired token, wrong password, bad webhook secret |
| 403 | Logged in but not allowed (role), account locked |
| 404 | Resource not found **or not yours** |
| 409 | Unique conflict (email, budget per month), resource in use, already confirmed |
| 413 / 415 | Image too large / not JPEG or PNG |
| 422 | Receipt read but no total found |
| 429 | Rate limited |
| 502 / 504 | KIE service down / timed out |
| 500 `INTERNAL` | Anything unexpected (logged with request id; the message is hidden from clients) |

Implementation: an `AppError(status, code, message, details)` class; Mongoose `E11000` → 409; `CastError` → 400; zod error → 400. Express 5 forwards rejected async handlers to the error middleware without wrappers.

## 4.6 Bot core and adapters

```text
server/src/bot/
├── core.js        handleText(link, text), handlePhoto(link, imageBytes), handleCommand(...), confirm(...), discard(...)
├── parser.js      parseLine(text, {categories, wallets, now}) → {type, amount, categoryId, walletId, occurredAt, note} | null
├── messages.vi.js / messages.en.js   all bot reply texts
├── telegram.js    verify secret, map update → core calls, sendMessage/editMessageText/answerCallbackQuery/getFile
└── zalo.js        verify secret, map event → core calls, sendMessage
```

**Adapter contract** (what `core.js` needs from each platform):

```js
{
  platform: 'telegram' | 'zalo',
  sendText(chatId, text),
  sendDraft(chatId, draft, lang),   // Telegram: inline keyboard; Zalo: text + "ok / huy" hint
  downloadPhoto(ref) → Buffer
}
```

**Webhook handling** (both platforms):

1. Check the secret header, comparing with `crypto.timingSafeEqual`. A mismatch returns 401.
2. Reply **200 immediately**, then run `waitUntil(processUpdate(body))`. The platform does not retry, and the slow work (KIE ~20 s) continues inside the 300 s function limit.
3. `processUpdate` looks up `chatLinks` by `(platform, platformUserId)`. If there is none, only `/start CODE` and `/link CODE` are accepted; everything else gets the "please link" reply.
4. Idempotency: drafts carry `chatRef.messageId`, and the unique partial index ignores duplicate deliveries.

**Telegram specifics** (Bot API):
- Register with `setWebhook(url, secret_token, allowed_updates: ["message","callback_query"])`. Telegram sends the secret back in `X-Telegram-Bot-Api-Secret-Token`.
- Text: `update.message.text`. Photo: `update.message.photo` (array of sizes; take the last, i.e. largest) → `getFile(file_id)` → download `https://api.telegram.org/file/bot<TOKEN>/<file_path>` (bots can download files up to 20 MB).
- Buttons: `reply_markup.inline_keyboard` with `callback_data` `c:<txId>` / `x:<txId>` (≤ 64 bytes). Then `answerCallbackQuery` and `editMessageText`.
- Deep link: `https://t.me/<bot>?start=<CODE>` → arrives as `/start <CODE>`.

**Zalo specifics** (Zalo Bot Platform, `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>`):
- Register with `setWebhook { url, secret_token }` (secret 8–256 chars). Zalo sends it back in `X-Bot-Api-Secret-Token`. Webhook and `getUpdates` polling are mutually exclusive.
- Body: `{ event_name, message }`. Handle `message.text.received` (`message.text`) and `message.image.received` (`message.photo_url`, older payloads used `photo`; optional `message.caption`). Ignore `message.sticker.received`, `message.voice.received` and `message.unsupported.received`.
- Reply target: `message.chat.id`. Sender: `message.from.id`, `message.from.display_name`.
- `sendMessage { chat_id, text }`, max 2000 chars. **No buttons**, so `ok`/`huy` replies resolve `chatLinks.pendingTransactionId` while it is still a draft, else the newest draft of this chat that still waits (several lines make several drafts); the reply names the next waiting draft. A one-line reply that is only an amount (`55k`) corrects that draft's amount through the same update service as the web Bot inbox.
- Every line of a message is saved before any reply is sent, so a failed `sendMessage` (monthly quota, timeout) never loses the lines after it.
- ⚠️ The payload shape comes from community SDKs (see sources in [06-deployment.md](06-deployment.md)). Log the first real webhook body during setup and adjust if it differs.

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
| Errors | network error → 502 `KIE_UNAVAILABLE`; timeout → 504 `KIE_TIMEOUT`; no total → 422 `RECEIPT_UNREADABLE`. The bot turns each into a friendly message |

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
- [ ] Webhook secrets checked with timing-safe compare before parsing.
- [ ] Every query scoped by `userId`; admin cannot read users' transactions.
- [ ] Passwords hashed with bcrypt; refresh tokens and link codes stored hashed; link codes single-use, 10 min TTL.
- [ ] `helmet`; JSON body limit 1 MB; zod on every input; `mongoose.set('sanitizeFilter', true)` against operator injection.
- [ ] Atlas: dedicated DB user with `readWrite` on one database only; strong password (the network allows `0.0.0.0/0`, see deployment doc).
- [ ] KIE protected by `X-KIE-Key`.
- [ ] Last admin cannot demote or lock themselves (`409 LAST_ADMIN`).
