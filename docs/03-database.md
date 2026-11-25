# 3. Database (MongoDB Atlas + Mongoose)

## 3.1 Rules that apply to every collection

- **Ownership:** every user-owned document has `userId` (ref `User`). Every query filters by the `userId` from the JWT.
- **Money:** integer **VND** (`Number`, validated `Number.isSafeInteger`, `> 0` for amounts). One value (amount, opening balance, budget limit) is at most **10^13 ₫** (±10^13 for an opening balance), so sums of them stay below 2^53 and exact. The models check the ceiling for `transactions.amount` and `wallets.initialBalance`; for `budgets.limit` only the route (zod) checks it. No floats, no currency field.
- **Soft delete:** `wallets`, `categories` and `transactions` have `deletedAt: Date | null`. Normal queries add `deletedAt: null`, and "delete" sets the date (as in ezBookkeeping). `budgets` and `chatLinks` are deleted for real; `sessions` and `linkCodes` are removed by their TTL index.
- **Timestamps:** `timestamps: true` on all schemas (`createdAt`, `updatedAt`).
- **IDs:** MongoDB `ObjectId`.
- **Time zone:** dates are stored in UTC. Day and month boundaries are computed in `Asia/Ho_Chi_Minh` (UTC+7) for statistics and budgets.

## 3.2 Relationships

```mermaid
erDiagram
    USER ||--o{ SESSION : "logs in with"
    USER ||--o{ WALLET : owns
    USER ||--o{ CATEGORY : owns
    USER ||--o{ TRANSACTION : records
    USER ||--o{ BUDGET : plans
    USER ||--o{ CHAT_LINK : "links chats"
    USER ||--o{ LINK_CODE : "requests codes"
    WALLET ||--o{ TRANSACTION : "paid from"
    CATEGORY ||--o{ TRANSACTION : classifies
    CATEGORY ||--o{ BUDGET : "limited by"
    CHAT_LINK |o--o| TRANSACTION : "pending draft"
    USER |o--o| WALLET : "default wallet"
```

8 collections. The slides require at least 3 with relations.

*Planned (§2.10, see §3.6):* no new collection. A claim link in `linkCodes` has no `userId`, so a `LINK_CODE` will belong to one user or to none (`USER |o--o{ LINK_CODE`).

## 3.3 Collections

### `users`

| Field | Type | Notes |
|---|---|---|
| `email` | String | required, lower-cased, **unique** |
| `passwordHash` | String | bcrypt hash (cost 10); `select: false` |
| `name` | String | 1–60 chars |
| `role` | String | `user` \| `admin`, default `user` |
| `status` | String | `active` \| `locked`, default `active` |
| `language` | String | `vi` \| `en`, default `vi` |
| `theme` | String | `light` \| `dark` \| `system`, default `system` |
| `defaultWalletId` | ObjectId → Wallet \| null | used by the bot parser and for receipt drafts; cleared when that wallet is archived or deleted. `PATCH /users/me` accepts any of the user's own non-deleted wallets, archived ones included. |
| `sessionsRevokedAt` | Date \| null | set by "revoke every session" (theft, admin lock) and by "log out other devices" / a password change (BUG-010) **before** they revoke sessions; a refresh that was already rotating re-reads it after opening its new session and revokes that session too if the stamp is not older than the chain's login (`sessions.chainStartedAt`) (BUG-006). Never sent to the client. |

Indexes: `{ email: 1 }` unique.

### `sessions` (refresh tokens)

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User | required |
| `tokenHash` | String | SHA-256 of the refresh token; **unique** |
| `userAgent`, `ip` | String | shown on the Settings → Sessions list |
| `expiresAt` | Date | now + 7 days |
| `lastUsedAt` | Date | updated on refresh |
| `revokedAt` | Date \| null | set by logout, "log out others", admin lock, reuse detection |
| `replacedBy` | ObjectId → Session | rotation chain, used to detect a stolen token being reused |
| `chainStartedAt` | Date | when the login that began this rotation chain happened; set at login/register and copied forward by every rotation. A revoke-all kills every chain whose login is not newer than `users.sessionsRevokedAt` (BUG-006); "log out others" first moves the kept session's value just past its stamp (BUG-010). Rows from before T22 lack it and fall back to `createdAt`. |
| `chainEndedAt` | Date \| null | set on **every** row of a chain when that one device is logged out (logout, Settings → log out this device), before its live row is revoked; a refresh that was already rotating re-reads it on the rows it claimed and revokes its new session too (BUG-010). |

Indexes: `{ tokenHash: 1 }` unique; `{ userId: 1, revokedAt: 1 }`; **TTL** `{ expiresAt: 1 }, expireAfterSeconds: 0` (Atlas deletes expired sessions automatically).

### `wallets`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User | required |
| `name` | String | 1–40 chars, unique per user among non-deleted, ignoring case (duplicate → 409 `NAME_TAKEN`); an archived wallet keeps its name |
| `type` | String | `cash` \| `bank` \| `ewallet` \| `credit` |
| `initialBalance` | Number (int) | ±10^13; below 0 only when `type` is `credit` (a model `pre('validate')` hook checks it when the wallet is created or its `type` or `initialBalance` changes, so older rows can still be renamed or archived, and then saves both fields together, so two edits at once cannot mix their halves; BUG-038) |
| `aliases` | [String] | bot shortcuts, e.g. `["mm","momo"]` |
| `color`, `icon` | String | UI only |
| `archived` | Boolean | hidden from pickers, kept in stats; archiving the user's default wallet clears `users.defaultWalletId` |
| `deletedAt` | Date \| null | soft delete; blocked (409) while confirmed transactions use it; deleting the user's default wallet also clears `users.defaultWalletId` |

Current balance is computed, not stored: `initialBalance + Σincome − Σexpense` over confirmed, non-deleted transactions (one aggregation).

Indexes: `{ userId: 1, deletedAt: 1 }`; `{ userId: 1, name: 1 }` **unique, partial** (only `deletedAt: null`), collation `vi` strength 2 (case-insensitive).

### `categories`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User \| **null** | `null` = **system default template** (managed by admin) |
| `type` | String | `expense` \| `income` |
| `name` | String | ≤ 40 chars; display name for user-created categories and renamed copies. Unique per user and type among non-deleted, ignoring case, also against both `names.vi`/`names.en` of unrenamed default copies (duplicate → 409 `NAME_TAKEN`). Checked in the service, not by an index. |
| `names` | `{ vi: String, en: String }` | for defaults; shown in the current UI language |
| `keywords` | [String] | stored lower-case without diacritics; used by the bot parser |
| `icon`, `color` | String | |
| `isFallback` | Boolean | marks the "Khác / Other" category per type |
| `deletedAt` | Date \| null | soft delete; its transactions move to the fallback of the same type. The fallback cannot be deleted (409). |

On **register**, every template (`userId: null`) is copied to the new user. Admin edits to templates affect only users who register afterwards.

Indexes: `{ userId: 1, type: 1, deletedAt: 1 }`.

### `transactions`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User | required |
| `walletId` | ObjectId → Wallet | required |
| `categoryId` | ObjectId → Category | required |
| `type` | String | `expense` \| `income` |
| `amount` | Number (int) | > 0, VND |
| `note` | String | ≤ 200 chars |
| `occurredAt` | Date | when the money moved |
| `status` | String | `draft` \| `confirmed` (web entries are created `confirmed`) |
| `source` | String | `web` \| `telegram` \| `zalo` \| `receipt` |
| `chatRef` | `{ platform, chatId, messageId }` | for bot drafts; used to edit/answer the bot message and for idempotency |
| `receipt` | `{ merchant, address, date, total, items:[{name, quantity, unitPrice, amount}], reconciled: Boolean, kieMs: Number, fileRef: String }` | only for receipt drafts |
| `deletedAt` | Date \| null | |

Indexes:
- `{ userId: 1, status: 1, occurredAt: -1 }`: lists, dashboard
- `{ userId: 1, categoryId: 1, occurredAt: -1 }`: budgets, stats by category
- `{ userId: 1, walletId: 1 }`: wallet balance
- `{ "chatRef.platform": 1, "chatRef.chatId": 1, "chatRef.messageId": 1 }` **unique, partial** (only when `chatRef` exists). `messageId` is `"<platform message id>:<line>"` (a receipt uses line 1). If Telegram/Zalo retries the same webhook, no second draft is created.

*Planned (§2.10, see §3.6):* `source` and `chatRef.platform` gain `whatsapp`.

### `budgets`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User | required |
| `categoryId` | ObjectId → Category \| null | `null` = overall monthly budget; otherwise one of the user's non-deleted **expense** categories (not found → 404, income → 400) |
| `month` | String | `YYYY-MM` (Vietnam time) |
| `limit` | Number (int) | > 0 VND, ≤ 10^13 (ceiling checked by the route) |

Indexes: `{ userId: 1, month: 1, categoryId: 1 }` **unique** (one budget per category per month; duplicates → 409).
Budget usage = Σ confirmed expenses in that category and month (aggregation).
A budget whose category was deleted is hidden from the list and skipped by "copy last month".

### `chatLinks`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User | required |
| `platform` | String | `telegram` \| `zalo` |
| `platformUserId` | String | Telegram `from.id` / Zalo `from.id` |
| `chatId` | String | where to send replies |
| `displayName` | String | shown on the Bot inbox |
| `pendingTransactionId` | ObjectId → Transaction \| null | the draft a typed `ok`/`huy` (Telegram and Zalo) or a Zalo amount-only correction acts on; set by text and receipt drafts. If it is no longer a waiting draft, the newest waiting draft from that chat is used. |

Indexes: `{ platform: 1, platformUserId: 1 }` **unique** (one web account per chat account); `{ userId: 1 }`.

*Planned (§2.10, see §3.6):* `platform` gains `whatsapp`; for WhatsApp, `platformUserId` and `chatId` are the user's business-scoped user ID (BSUID), never the phone number. Two fields are added for the claim-link notice: `viaClaim` and `claimNoticeDismissedAt`.

### `linkCodes`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User | required |
| `codeHash` | String | SHA-256 of the 6-char code (A–Z, 2–9, no look-alikes) |
| `expiresAt` | Date | now + 10 minutes |
| `usedAt` | Date \| null | one-time use |

Indexes: `{ codeHash: 1 }` unique; **TTL** `{ expiresAt: 1 }`.

*Planned (§2.10, see §3.6):* `userId` becomes optional and a `chat` sub-document is added, so a row is either a code (made on the website) or a claim link (made by the bot).

## 3.4 Key aggregations

| Purpose | Pipeline sketch |
|---|---|
| Month summary | `$match {userId, status:'confirmed', deletedAt:null, occurredAt in month}` → `$group {_id:'$type', total:{$sum:'$amount'}}` |
| By category | same `$match` + `type` (query param, `expense` by default, `income` allowed) → `$group {_id:'$categoryId', total}` → names from the user's categories (deleted ones too) |
| Daily trend | same `$match` → `$group {_id:{$dateToString:{format:'%Y-%m-%d', date:'$occurredAt', timezone:'Asia/Ho_Chi_Minh'}}, total}` |
| Wallet balances | `$match {userId, status:'confirmed', deletedAt:null}` → `$group {_id:'$walletId', net:{$sum: income ? amount : -amount}}`; no join: the code adds `initialBalance + net` to each wallet in JS, on every read |
| Budget usage | by-category result joined with `budgets` for the month |

## 3.5 Seed data

**Admin user:** created by `npm run seed` from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (env only, never committed). `npm run seed:test` also creates userA and userB from `TEST_USER_A_EMAIL` / `TEST_USER_A_PASSWORD` and `TEST_USER_B_EMAIL` / `TEST_USER_B_PASSWORD`. Accounts are only created when missing.

**Older accounts:** every seed run gives the default wallet and categories to any account that has no wallets / no categories yet.

**Default categories (templates):**

| Type | vi | en | Keywords (examples) |
|---|---|---|---|
| expense | Ăn uống | Food & drinks | pho, bun, com, banh mi, cafe, ca phe, tra sua, an sang, an trua, coffee, lunch, dinner |
| expense | Đi lại | Transport | grab, be, xanh sm, taxi, xang, gui xe, bus, ve xe, parking, fuel |
| expense | Mua sắm | Shopping | shopee, lazada, tiki, quan ao, giay, sieu thi, circle k, winmart, shopping |
| expense | Hoá đơn | Bills | dien, nuoc, internet, wifi, dien thoai, 4g, electricity, water |
| expense | Nhà ở | Housing | tien nha, tien tro, thue nha, rent |
| expense | Giải trí | Entertainment | phim, cgv, netflix, spotify, game, movie |
| expense | Sức khoẻ | Health | thuoc, kham, benh vien, nha khoa, pharmacy |
| expense | Giáo dục | Education | sach, hoc phi, khoa hoc, book, course |
| expense | Khác *(fallback)* | Other | — |
| income | Lương | Salary | luong, salary |
| income | Thưởng | Bonus | thuong, bonus |
| income | Được tặng | Gifts | li xi, qua, gift |
| income | Thu khác *(fallback)* | Other income | nhan, received |

**Default wallets on register:** "Tiền mặt / Cash" (`cash`, aliases `tm`, `cash`) set as the default wallet.

## 3.6 One-tap linking and WhatsApp (planned, §2.10)

None of this is built yet. It lists what docs/02 §2.10 changes against §3.3; as each part is built, its change moves into §3.3 and is removed here. Each build PR updates the planned sections in the docs its card's Scope lists; where a card's Scope doesn't list them (T32), the orchestrator opens a docs-only follow-up PR after the merge. §2.10 adds no collection and no index.

### `linkCodes`: codes and claim links (planned)

| Field | Today | Planned |
|---|---|---|
| `userId` | ObjectId → User, required | ObjectId → User, **optional**: set only on a code made on the website |
| `chat` | — | **new** `{ platform, platformUserId, chatId, displayName }`: set only on a claim link made by the bot. The four fields mean the same as in `chatLinks` |
| `codeHash` | SHA-256 of the 6-char code | unchanged for codes; for a claim link, the SHA-256 of its token (§2.10 adds no second hash field) |
| `expiresAt`, `usedAt` | now + 10 minutes; one-time use | unchanged, for both kinds |

| | Code (F7, as today) | Claim link (new, §2.10.3) |
|---|---|---|
| Created by | `POST /api/chat-links/code` on the website | the bot, when a chat that is not linked sends anything except `/start CODE` or `/link CODE` (a wrong or expired code counts as anything) |
| Field set | `userId` (the user who asked) | `chat` (the chat that asked) |
| Secret | 6 characters, A–Z and 2–9 without look-alikes | random 24 bytes, sent as a 32-character base64url token |
| Stored | SHA-256 only, in `codeHash` | SHA-256 only, in `codeHash` |
| Lifetime | 10 minutes, single use | 10 minutes, single use |
| Used by | the chat: `/start CODE` (Telegram deep link) or `/link CODE` | the website: `POST /api/chat-links/claim { token }`, after `/link?t=<token>` and Confirm |
| Matches only rows with | `userId` | `chat` |
| How many | at most 5 new codes per user per 10 minutes (rate limit, F7) | at most one live claim link per chat |

- **Exactly one of `userId` and `chat` is set.** `userId` loses `required`. §2.10 states the rule but not where it is checked (model validator or the code that writes rows): left to the builder. Every existing row has `userId` and no `chat`, so it is already a valid code; no migration.
- **Neither kind works in the other's place.** Redeeming in the chat keeps today's single atomic update (`codeHash`, `usedAt: null`, `expiresAt` in the future → set `usedAt`) and adds "`userId` is set". `POST /api/chat-links/claim` is the same single atomic update with "`chat` is set" instead, then creates the `chatLinks` row from `chat` plus the logged-in user's `userId`. `POST /api/chat-links/claim/preview` matches the same way and changes nothing, so Cancel leaves the token to expire. No match (unknown, used, expired, or a code) → 404 `LINK_TOKEN_INVALID`.
- **Hashing.** The same SHA-256 (hex) as today, so both kinds share the unique `{ codeHash: 1 }` index. A code is trimmed and upper-cased before hashing; base64url is case-sensitive, so a token is hashed exactly as received.
- **One live claim link per chat.** Before creating one, the bot deletes any older live (unused, unexpired) claim link for the same chat, so a second message gives a new link and the first stops working (§2.10.6). §2.10 does not name the key for "the same chat"; `chat.platform` + `chat.platformUserId`, the pair `chatLinks` is unique on, is the natural one. Delete-then-create is two writes, not one atomic step, and §2.10 asks for no index to enforce it.
- **Indexes unchanged.** `{ codeHash: 1 }` unique serves both kinds, and the TTL index `{ expiresAt: 1 }, expireAfterSeconds: 0` removes both. No index covers the delete-by-`chat` query; the collection only holds rows from about the last 10 minutes, and §2.10 leaves adding one to the builder.

### `chatLinks` (planned)

| Field | Today | Planned |
|---|---|---|
| `platform` | `telegram` \| `zalo` | `telegram` \| `zalo` \| `whatsapp` |
| `platformUserId` | Telegram / Zalo `from.id` | WhatsApp: the user's business-scoped user ID (BSUID): `from_user_id` on the message, `user_id` on the contact. Meta omits `from` (the phone number) for users who adopted a WhatsApp username, so the phone number is never the key |
| `chatId` | where to send replies | WhatsApp: the same BSUID; replies are sent with `recipient_type: "individual"` and `recipient: <BSUID>`, never `to` (§2.10.4) |
| `displayName` | shown on the Bot inbox | WhatsApp: `value.contacts[0].profile.name` |
| `viaClaim` | — | **new** Boolean, default `false`; `true` for a link made by a claim link (§2.10.5) |
| `claimNoticeDismissedAt` | — | **new** Date \| null, default `null`; when the user dismissed the "Not you? [Unlink]" notice for this link |

- Rows are created two ways: by `/start CODE` / `/link CODE` in the chat (from the message plus the code's `userId`, as today, now from WhatsApp too; `viaClaim` keeps its default `false`) and by `POST /api/chat-links/claim` (from the claim link's `chat` plus the logged-in user, with `viaClaim: true`).
- `GET /api/chat-links` also returns `viaClaim` and `claimNoticeDismissedAt`. The Bot inbox shows the notice for every link with `viaClaim && !claimNoticeDismissedAt`; `PATCH /api/chat-links/:id/claim-notice` (own links only) sets `claimNoticeDismissedAt` to now. Existing rows read as `viaClaim: false` through the schema default, so no migration.
- Indexes unchanged. `{ platform: 1, platformUserId: 1 }` unique now also means one web account per WhatsApp user (BSUID), and it is the backstop when a chat was linked between the claim link and Confirm: 409 `CHAT_ALREADY_LINKED`, and the token stays spent (§2.10.3).

### `transactions` (planned)

| Field | Today | Planned |
|---|---|---|
| `source` | `web` \| `telegram` \| `zalo` \| `receipt` | adds `whatsapp` for drafts from the WhatsApp bot, text and receipt photos alike (a bot photo already takes its platform as `source`; `receipt` stays for web uploads) |
| `chatRef.platform` | `telegram` \| `zalo` | adds `whatsapp` (§2.10.5); without it every WhatsApp draft fails validation |
| `chatRef.chatId` | the chat's `chatId` | WhatsApp: the BSUID, not a phone number |
| `chatRef.messageId` | `"<platform message id>:<line>"` | WhatsApp: `"<wamid>:<line>"`, from the message `id` (§2.10.4) |

- Indexes unchanged. The unique partial `chatRef` index is what turns a second delivery of the same `wamid` into no second draft (§2.10.4).
- Adding enum values needs no data migration.

### Privacy (planned)

- **Unlinked chats.** Today the bot stores nothing for a chat that is not linked. With claim links it stores one `linkCodes` row per unlinked chat that writes in (its `chat` ids and display name) until the TTL index removes it. MongoDB's TTL sweep runs about once a minute, so a row can outlive `expiresAt` briefly; the claim query checks `expiresAt` itself, as redeeming a code does today.
- **Tokens.** Only the SHA-256 of a claim token is stored, like codes and refresh tokens. The token travels in the bot's reply, in `/link?t=…` (which the page removes from the address bar) and in request bodies, never in a URL the server logs (§2.10.3).
- **WhatsApp: no phone number is stored.** The key is the BSUID (§2.10.4), so `chatLinks`, `linkCodes.chat` and `transactions.chatRef` hold the BSUID, never a phone number. The web shows `displayName` (the WhatsApp profile name), and admin stats count chats per platform without identifiers. Transaction responses still carry `chatRef` as today (the model's `toJSON` keeps it), so a WhatsApp draft's response carries the BSUID, not a phone number.
