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
| `initialBalance` | Number (int) | may be 0 or negative (credit) |
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

### `linkCodes`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → User | required |
| `codeHash` | String | SHA-256 of the 6-char code (A–Z, 2–9, no look-alikes) |
| `expiresAt` | Date | now + 10 minutes |
| `usedAt` | Date \| null | one-time use |

Indexes: `{ codeHash: 1 }` unique; **TTL** `{ expiresAt: 1 }`.

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
