# 2. Features

## 2.1 Roles and permissions

| Action | Guest | User | Admin |
|---|:-:|:-:|:-:|
| Register, log in | ✅ | — | — |
| Manage own wallets, categories, transactions, budgets | — | ✅ | ✅ (own data only) |
| Link Telegram/Zalo/WhatsApp, use the bots | — | ✅ | ✅ |
| See own statistics, sessions; change language/theme/password | — | ✅ | ✅ |
| List users, lock/unlock, change role | — | — | ✅ |
| Manage **default categories** (templates copied to new users) | — | — | ✅ |
| See system stats (users, linked chats, transactions by source) | — | — | ✅ |
| Read other users' transactions | — | — | ❌ (privacy by design) |

Enforced by `requireAuth` on all private routes and `requireRole('admin')` on `/api/admin/*`. Every query for user data filters by `userId` from the JWT, so a user can never load someone else's documents by guessing IDs (the API returns 404).

## 2.2 Feature list

Each feature is a complete slice (screen → API → collection), and most have full create/edit/delete as the slides require.

| # | Feature | Create / Read / Update / Delete | Screen(s) |
|---|---|---|---|
| F1 | **Account & auth**: register, login, logout, silent refresh, change password, sessions list, log out other devices | C R U D (sessions) | Login, Register, Settings |
| F2 | **Wallets**: cash, bank, e-wallet, credit card; opening balance (may be negative for a credit card); computed current balance; archive | C R U D | Wallets |
| F3 | **Categories**: expense/income, icon, colour, **bot keywords**; seeded from defaults on register | C R U D | Categories |
| F4 | **Transactions**: add/edit/delete; filter by date range, type, wallet, category, status, text; pagination | C R U D | Transactions |
| F5 | **Monthly budgets**: limit per category (or overall) per month; progress bars; over-budget warnings (web + bot) | C R U D | Budgets, Dashboard |
| F6 | **Statistics**: total balance of active wallets; month figures (income, expense, net, budget left); this month vs last month in weekly columns (spending or income); spending by category as a ranked list; category budgets to watch | R | Dashboard |
| F7 | **Bot linking**: one-time code / Telegram deep link; list and unlink chat accounts. *Planned (§2.10):* one button per app (Telegram, WhatsApp, Zalo) and linking that starts in the chat | C R D | Bot inbox, *Link (planned)* |
| F8 | **Bot capture (Telegram + Zalo, *WhatsApp planned in §2.10*)**: text → draft → confirm; receipt photo → KIE → draft → confirm; `/today`, `/month` | C U D (drafts) | (chat) + Bot inbox |
| F9 | **Bot inbox (web)**: review drafts from any source; edit, confirm or discard; see receipt line items | R U D | Bot inbox |
| F10 | **Receipt upload (web)**: upload a photo on the web; KIE → draft | C | Bot inbox |
| F11 | **Admin**: users (lock/unlock, role), default categories, system stats | C R U D | Admin users, Admin categories |
| F12 | **Preferences**: language vi/en, theme light/dark/system; saved per user and in localStorage | U | Settings, app bar |
| F13 | **Web quick add**: a text box on the Dashboard and Transactions pages. You type `phở 45k` (same syntax as the bot), see a live preview (amount, category, wallet, date), and press Enter to save. A line with no amount, or past the 10th, is named inline and nothing is saved until it is fixed. The full form is one click away | C | Dashboard, Transactions |

> **The web app works without the bots.** Customers who don't use Telegram or Zalo record everything on the website, with the quick-add box (F13) or the full add/edit form (F4). The bots are an extra way in, not the only one.

### Non-goals (kept out on purpose)
- Transfers between wallets, multiple currencies (VND only), tags, recurring transactions, data import/export.
- Any AI/LLM text parsing (decided: rule-based only).
- Storing receipt images. The bot keeps the chat platform's file reference; the KIE result is stored on the transaction.
- Email verification and password-reset emails (no mail provider in the free setup).
- Unofficial WhatsApp libraries (Baileys, whatsapp-web.js): they break WhatsApp's terms, get numbers banned and need an always-on server. WhatsApp goes through Meta's Cloud API only (§2.10).
- Messages the WhatsApp bot sends first (reminders, alerts outside a reply): they need paid, pre-approved Meta templates. The bot only replies.
- Bots in group chats, on every platform.

## 2.3 Screens (11 routes, plus `/link` planned in §2.10; the slides require at least 6)

| Route | Screen | Main content |
|---|---|---|
| `/login` | Login | Email + password, language and theme switch |
| `/register` | Register | Name, email, password (+confirm; at least 8 characters, at most 72 bytes); the language picked in the corner switch becomes the profile language |
| `/` | Dashboard | **Quick-add box** at the top; month picker; "Drafts waiting" banner linking to Bot inbox; "Budgets to watch" banner (category budgets past 80 % / 100 %); total-balance card beside four figure cards (income, expense, net, budget left); this month vs last month in weekly columns with a Chi tiêu / Thu nhập switch; ranked category list; latest 5 transactions; one error banner with Retry for every query whose numbers the page shows |
| `/transactions` | Transactions | **Quick-add box**, filter bar, paginated table (cards on mobile), add/edit dialog, delete with undo snackbar |
| `/wallets` | Wallets | Wallet cards with balance; add/edit/archive/delete |
| `/categories` | Categories | Tabs expense/income; list with icon/colour/keywords; add/edit/delete |
| `/budgets` | Budgets | Month picker; overall and per-category limits with progress bar; add/edit/delete; copy last month |
| `/bot` | Bot inbox | Link Telegram/Zalo (code, deep link, QR), linked accounts, drafts list (source icon, receipt items), upload receipt. *Planned:* the link card of §2.10.2 with WhatsApp |
| `/link` *(planned)* | Link a chat | Opened from the bot's "tap to link" message: "Link **Zalo · Anh** to your account?" with Confirm / Cancel (§2.10.3). Logs in first if needed |
| `/settings` | Settings | Profile, password, language, theme, sessions (current + others, revoke) |
| `/admin/users` | Admin · Users | System stats (F11), search, role/status chips, lock/unlock, change role |
| `/admin/categories` | Admin · Default categories | Template list (vi/en names, keywords), add/edit/delete |
| `*` | 404 | Link home |

## 2.4 Bot behaviour (Telegram, Zalo, and WhatsApp planned)

The same **bot core** serves every platform. Only sending/receiving and confirm UI differ. The WhatsApp column is planned (§2.10).

| | Telegram | Zalo | WhatsApp *(planned)* |
|---|---|---|---|
| Link account | Deep link `https://t.me/<bot>?start=<CODE>` (one tap) or `/link CODE` | Send `/link CODE` (*planned:* "Copy & open Zalo" button) | `https://wa.me/<number>?text=%2Flink%20<CODE>` opens the chat with `/link CODE` typed; the user taps Send |
| Confirm a draft | Inline buttons **✅ Lưu / ❌ Huỷ** (callback query) | Reply **`ok`** to save or **`huy`** to discard (Zalo Bot API has no buttons). After a message with several lines, each `ok`/`huy` acts on the newest draft still waiting, and the reply names the next one | Reply buttons **✅ Lưu / ❌ Huỷ / ✏️ Sửa** (interactive `button` message); the tap arrives as `interactive.button_reply.id` |
| Edit a draft | Button **✏️ Sửa** opens the web Bot inbox | Reply with just the right amount (e.g. `55k`): it replaces the waiting draft's amount and keeps its note and category. Anything else is edited on the web | Button **✏️ Sửa** makes the bot reply with the Bot inbox URL (reply buttons can't open a URL) |
| Receive photo | `message.photo` → `getFile` → download | `message.photo_url` → download | `message.image.id` → `GET /<media-id>` → `url` → download with the access token (the URL lives 5 minutes) |
| Message limit | 4096 chars | 2000 chars | 4096 chars for text; 1024 for the body of a button message; button titles ≤ 20 chars |

**Commands:** `/start` (welcome or link), `/link CODE`, `/help`, `/today` (today's spending), `/month` (month total, the overall budget and each category budget with its usage, fullest first), `/lang vi|en`.

**Unlinked chats** get: "Please link your account: open `<app>/bot` and send `/link CODE`" (in both languages). *Planned:* the reply also carries a one-tap link to the website (§2.10.3).

**Locked accounts:** when an admin locks the web account, its linked chats get "account locked" for every other message and button press (only `/start CODE` and `/link CODE` still answer "already linked"), and nothing is recorded.

**Budget alert:** after an expense draft is confirmed, the category's budget or the overall budget for that month, whichever is fuller, is checked. At ≥ 80 % or ≥ 100 % used, the bot adds a warning line, and on the web the Bot inbox shows a warning snackbar. The Dashboard lists category budgets past 80 % in its "Budgets to watch" banner (the overall budget has its own card).

## 2.5 Text parser rules (rule-based, no AI)

Input is one line per transaction (up to 10 lines per message). Text is lower-cased and **diacritics are stripped for matching only** (`phở` → `pho`), while the original text is kept as the note.

**Amount (required):**

| Written | Value (VND) |
|---|---|
| `45k`, `45 k`, `45 nghìn`, `45 ngàn`, `45ng` | 45,000 |
| `1tr`, `1 triệu`, `1m` | 1,000,000 |
| `1tr2`, `1tr25`, `1.5tr`, `1,5tr` | 1,200,000 / 1,250,000 / 1,500,000 / 1,500,000 |
| `150.000`, `150,000`, `150000`, `150000đ`, `150000 vnd` | 150,000 |
| bare number below 1,000, e.g. `phở 45` | 45,000 *(proposed: treated as thousands; the confirm message shows the value, so a wrong guess is caught)* |

The amount is rounded to whole đồng and must be from 1 ₫ to 10^13 ₫. A line whose amount is 0 or above that ceiling counts as having no amount. If no line in the message has an amount, the bot replies with help text and examples. Otherwise it saves the lines it can read and names the line numbers it did not record. Lines after the 10th are ignored without a message (the web quick add says so).

**Type:** **income** if the line starts with `+`, or contains an income keyword (`lương`, `thưởng`, `nhận`, `salary`, `bonus`, `received`) or a keyword of an income category. Otherwise it's an **expense**.

**Category:** the longest keyword match across the user's categories of that type (e.g. `grab` → Đi lại, `phở` → Ăn uống). Otherwise the fallback category of that type: **Khác / Other** for expenses, **Thu khác / Other income** for income.

**Wallet:** matches an alias the user gave a wallet (e.g. `mm` on a MoMo wallet). After register the only wallet is **Tiền mặt / Cash**, with aliases `tm` and `cash`. Otherwise the user's default wallet if it is still active, else the oldest active wallet.

**Date:** `hôm qua`, `hqua`, `yesterday` → yesterday; `dd/mm` or `dd/mm/yyyy` → that date; otherwise now. All dates use the **Asia/Ho_Chi_Minh** time zone.

**Note:** the original line with the amount, wallet and date tokens removed.

Examples:

| Message | Draft |
|---|---|
| `phở 45k` | expense · 45,000 · Ăn uống · default wallet · now · "phở" |
| `grab 32k hôm qua mm` | expense · 32,000 · Đi lại · MoMo (if a wallet has alias `mm`) · yesterday · "grab" |
| `+lương 15tr` | income · 15,000,000 · Lương · default wallet · now · "lương" |
| `coffee 30k` | expense · 30,000 · Ăn uống (English keyword) · now · "coffee" |

## 2.6 Receipt photos (KIE)

1. A photo arrives (Telegram, Zalo or web upload). The bot replies "Đang đọc hoá đơn… / Reading receipt…".
2. The API sends the image to the KIE service `POST /analyze` (JPEG/PNG, ≤ 10 MB; about 20 s, one image at a time).
3. Mapping: `fields.total` → amount (digits only); `fields.merchant` → note; `fields.date` → date (`dd/mm/yyyy`, else now); `line_items` → `receipt.items`; the category is guessed by matching keywords on the merchant and item names, else Khác/Other.
4. A draft is created and the bot shows merchant · total · category, plus the line count and whether the items add up to the total (`reconciliation`).
5. If KIE is unreachable, times out (120 s) or finds no total, the bot says so and asks the user to type the amount. There is no AI fallback.

## 2.7 Languages and themes

- **UI languages:** Vietnamese (default) and English. All UI strings live in `client/src/i18n/{vi,en}/<namespace>.json` (one namespace per feature, e.g. `dashboard`, `errors`). Numbers and dates are formatted with `Intl` (`vi-VN` / `en-US`, currency VND).
- **API errors** return a stable `code` (e.g. `WALLET_NOT_FOUND`) that the frontend translates; `message` is English for logs.
- **Bot replies** use the user's `language` (changeable with `/lang` or in Settings).
- **Default categories** have names in both languages; user-created categories have one name.
- **Themes:** light, dark, or system. The app bar button switches between light and dark (picking the OS scheme stores "system"); the full three-way choice is in Settings. The choice is stored in localStorage (instant) and in the user profile (follows the user across devices). Charts use theme colours.
- **Report language:** English.

## 2.8 Slide requirements checklist

| Slide requirement | How this project meets it |
|---|---|
| 1. React + Vite + React Router, ≥ 6 screens, responsive | 11 routes (§2.3); MUI breakpoints: drawer on desktop, bottom navigation and card lists on phones |
| 2. Context for login; Redux Toolkit or Zustand | `AuthContext` (user, access token, login/logout/refresh); Redux Toolkit store with RTK Query API slice + `uiSlice` |
| 3. Express REST, correct methods and status codes, error middleware | Resource routes in [04-backend.md](04-backend.md); 200/201/204/400/401/403/404/409/422/429/500; one `errorHandler` + `notFound` |
| 4. MongoDB + Mongoose, ≥ 3 related collections | 8 collections with `ObjectId` refs (transactions → users, wallets, categories; budgets → categories; …), see [03-database.md](03-database.md) |
| 5. Regular commits, README with run steps, no `.env` leak | One commit per feature step; README run guide; `.env` git-ignored, `.env.example` committed; GitHub push protection on |
| 6. Advanced: JWT, bcrypt, roles, deploy | JWT access + rotating refresh, bcrypt hashes, `user`/`admin` roles, live on Vercel + Atlas |
| Per-person feature with full add/edit/delete | Solo: README "Phân công" lists F1–F13 as one person's work, matching the commit history |

## 2.9 Build order for today's Vercel demo

Each step ends deployable, so there is always something to show.

1. **Skeleton live:** npm workspaces, `GET /api/health` reads from Atlas, and the SPA shows it on Vercel. This proves Vercel + Atlas + `vercel.json` first.
2. **Auth (F1):** register/login/refresh/logout, AuthContext, protected routes, seed admin.
3. **Core money (F2–F4, F13):** wallets, default categories seeded on register, transactions CRUD with filters, and the web quick-add box, so customers can track spending before any bot exists.
4. **Telegram bot (F7, F8 text):** link code, parser, draft → buttons → confirm.
5. **Zalo bot (F8 text):** same core, `ok`/`huy` confirm.
6. **Dashboard + budgets (F5, F6).**
7. **Receipts (F8 photo, F9, F10):** KIE in Docker + Cloudflare Tunnel, bot inbox.
8. **Admin (F11), i18n and theme polish (F12), sessions page.**
9. **One-tap linking and WhatsApp (§2.10, planned):** the new link card and `wa.me`/Zalo buttons first (no new platform needed to ship it), then linking from the chat with `/link`, then the WhatsApp adapter.

## 2.10 One-tap linking and WhatsApp (planned)

**Why.** Linking a chat app must take as few steps as each app allows, the same way on all three, for real users, not only demo phones. D2AI Lab (`d2ai.ript.vn/ho-so`) links Telegram with a one-time deep link and "open Telegram and press Start"; F7 already does that for Telegram. The gaps: Zalo users type `/link CODE` by hand, and there is no WhatsApp bot.

**Decided.**
- WhatsApp goes through **Meta's WhatsApp Cloud API directly** (not a provider like Twilio, not an unofficial library). It is one more adapter behind the same bot core and webhook pattern as Telegram and Zalo, on Vercel.
- Linking works **from both ends**: start on the website (§2.10.2) or start in the chat (§2.10.3). Both use the existing `linkCodes` collection.

**Success looks like:** Telegram is linked in 1 tap + Start, WhatsApp in 1 tap + Send, Zalo in 1 tap + paste + send from the website, or 1 tap + Confirm when starting from any chat. No one has to read a code and type it.

### 2.10.1 Platform facts this design rests on

| | Telegram | Zalo Bot Platform | WhatsApp Cloud API |
|---|---|---|---|
| Open the bot with data in it | `t.me/<bot>?start=<payload>`: the bot receives `/start <payload>` after the user taps Start | No payload in the bot link, and the bot can't message first | `wa.me/<number>?text=<urlencoded>`: the chat opens with the text typed; the user taps Send |
| Buttons | Inline keyboard | None | Up to 3 reply buttons per message |
| Cost and limits | Free | Free Basic plan: 50 users per bot, 3,000 messages a month | Messages from users are free; the bot's replies are free up to 1,000 a month per business number (since 1 Oct 2026), then billed per message. The bot may reply only within 24 hours of the user's last message |
| Owner setup | BotFather | Zalo Bot Creator (phone app) | Meta app with the WhatsApp use case, a Meta business portfolio, a phone number not already on WhatsApp, an approved display name, a permanent (system user) access token, and a payment method once past the free replies |

### 2.10.2 Linking from the website (`/bot` link card)

Same button and code as F7 today; what changes is what the card shows once a code exists:

```
Link a chat app                                  code ABC123 · 9:41 left
( Telegram | WhatsApp | Zalo )        ← pick the app; the default is the first one not linked yet
[ ✈ Open Telegram ]   One tap, then press Start.
[ QR of the same link ]               ← for people on a computer: scan with the phone
→ "Linked ✓ Telegram · Anh" appears as soon as the bot redeems the code
```

| App | Button | What it does | Instruction line |
|---|---|---|---|
| Telegram | **Open Telegram** | Opens `https://t.me/<bot>?start=<CODE>` (as today) | One tap, then press Start |
| WhatsApp | **Open WhatsApp** | Opens `https://wa.me/<WHATSAPP_NUMBER>?text=%2Flink%20<CODE>` | `/link CODE` is already typed: tap Send |
| Zalo | **Copy & open Zalo** | Copies `/link CODE` to the clipboard (`navigator.clipboard.writeText`), then opens `ZALO_BOT_URL` in a new tab | Paste and send. If copying fails, the card says "Copy it yourself" and the `/link CODE` text stays visible and selectable |

- The QR code encodes the selected app's link. For Zalo the phone still needs the code, so the code stays large on screen.
- An app whose settings are missing on the server (its link is `null`) is left out of the picker.
- Unchanged from F7: 6-character code, 10 minutes, single use, 5 codes per user per 10 minutes, checking for the new link every 5 s while the code is live, and focus moving to the code.
- **API change:** `POST /api/chat-links/code` returns `{ code, expiresAt, links: { telegram, whatsapp, zalo } }` (each a URL or `null`) instead of `telegramDeepLink`. The client changes in the same PR.

### 2.10.3 Linking from the chat (`/link` screen)

1. A chat that is not linked sends anything except `/start CODE` or `/link CODE` (a wrong or expired code counts as "anything").
2. The bot creates a **claim link**: a random 32-character base64url token (24 bytes), 10 minutes, single use. It is stored in `linkCodes` as its SHA-256 with the chat's details (`chat: { platform, platformUserId, chatId, displayName }`) and no `userId`. Any older live claim link for the same chat is deleted first, so a chat has at most one.
3. The bot replies in both languages: the current "please link" text, plus "Or tap to link: `<APP_URL>/link?t=<token>` (valid 10 minutes)".
4. `/link?t=…` on the website: the page reads the token, removes it from the address bar (`history.replaceState`), and sends the user to log in first if needed (back to `/link` after login, token kept in memory/sessionStorage, not in the URL).
5. It calls `POST /api/chat-links/claim/preview { token }` and shows: "Link **Zalo · Anh** to **<your name> (<your email>)**? [Confirm] [Cancel]". Cancel goes to `/bot` and leaves the token to expire.
6. Confirm calls `POST /api/chat-links/claim { token }`. In one atomic update the token must be unused, unexpired and a claim link (has `chat`); it is marked used and a `chatLinks` row is created for the logged-in user.
7. The website goes to `/bot` with "Linked ✓ Zalo · Anh". The bot sends the chat "Đã liên kết với tài khoản <name>" in the user's language (the same text as `/link CODE` success).

**Why the Confirm step:** a claim link links the chat that asked for it to whoever opens it. If someone forwards the link, the person who opens it sees whose chat it is and must say yes. A forwarded link can't take over a web account; at worst it sends the sender's chat into the receiver's account, and the sender sees "Linked to <name>" in their chat and can ask for it to be unlinked.

**API (both need login; tokens travel in the body, never in a URL the server logs):**

| Endpoint | Success | Errors |
|---|---|---|
| `POST /api/chat-links/claim/preview { token }` | 200 `{ platform, displayName }` | 404 `LINK_TOKEN_INVALID` (unknown, used or expired) |
| `POST /api/chat-links/claim { token }` | 201 `{ id, platform, displayName, createdAt }` | 404 `LINK_TOKEN_INVALID`; 409 `CHAT_ALREADY_LINKED` (that chat was linked meanwhile; the token is still spent) |

**Screen states:** loading; confirm; done (redirect); "This link has expired or was already used. Send any message to the bot to get a new one."; "This chat is already linked to an account." Both error screens have a "Go to Bot inbox" button.

### 2.10.4 The WhatsApp bot

- **Webhook:** `/api/webhooks/whatsapp`, subscribed to the `messages` field.
  - `GET` is Meta's setup check: if `hub.mode=subscribe` and `hub.verify_token` equals `WHATSAPP_VERIFY_TOKEN`, answer 200 with `hub.challenge` as plain text; otherwise 403.
  - `POST` must carry `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET>`, compared in constant time; otherwise 401 and nothing is processed. The raw body is needed, so this route reads it before JSON parsing.
  - Read `entry[].changes[].value`: `messages[]` are handled, `statuses[]` (sent/delivered/read) are ignored, and both still get 200 so Meta doesn't retry.
  - Duplicate deliveries are skipped by the message `id` (`wamid…`), the same way as Telegram's `update_id` and Zalo's message id.
- **Incoming message → bot core message:** `platformUserId` and `chatId` are `from` (the user's WhatsApp ID, which is their phone number); `displayName` is `value.contacts[0].profile.name`; `type: text` → `text.body`; `type: image` → photo by `image.id`; `type: interactive` with `button_reply` → a button press with `button_reply.id`. Other types (audio, sticker, location…) get the help text.
- **Sending:** `POST https://graph.facebook.com/<version>/<WHATSAPP_PHONE_NUMBER_ID>/messages` with `messaging_product: "whatsapp"`, `to`, and either `type: "text"` or `type: "interactive"` with `interactive.type: "button"`. The Graph API version is one constant in the adapter. Long replies are split at 4096 characters.
- **Drafts:** each draft is sent as a button message (✅ Lưu, ❌ Huỷ, ✏️ Sửa) whose button ids carry the same action and draft id as Telegram's callback data, so the core's existing confirm/discard path is reused. ✏️ Sửa replies with `<APP_URL>/bot`.
- **Receipts:** `GET /<image.id>` with the access token gives a `url` valid for 5 minutes; download it with the same token and pass it to KIE as with the other platforms.
- **Privacy:** the phone number is stored only as `platformUserId`/`chatId`. The web shows the WhatsApp profile name, and admin stats count chats per platform without numbers.
- Locked accounts, `/today`, `/month`, `/lang`, `/help` and budget alerts behave exactly as in §2.4.

### 2.10.5 Data, settings and setup

- `chatLinks.platform` and `transactions.source` gain `whatsapp`; the Bot inbox and Transactions show a WhatsApp source icon; admin stats count WhatsApp chats.
- `linkCodes`: `userId` becomes optional and a `chat` sub-document is added. Exactly one of them is set: `userId` for a code made on the website, `chat` for a claim link made by the bot. Redeeming in the chat (`/link CODE`) only matches rows with `userId`; claiming on the website only matches rows with `chat`, so neither kind works in the other's place. The TTL index and the hash-only storage stay.
- New environment variables: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMBER` (international format, digits only, for `wa.me`), and `ZALO_BOT_URL` (the bot's share link from Zalo Bot Creator). A platform with missing settings is skipped by the webhook-registration script and hidden in the link card.
- `docs/03` (collections), `docs/04` (endpoints and error codes), `docs/05` (link card, `/link` screen), `docs/06` (Meta setup steps and secrets) and `docs/07` (cases below) are updated in the PR that builds each part.

### 2.10.6 Acceptance checks

| Check | Proves |
|---|---|
| Link card: each app's button opens the right URL with the live code; the QR matches the selected app; an app with no settings is hidden | Website linking for all three apps |
| Zalo button: the clipboard holds `/link CODE`; with the clipboard blocked, the fallback text shows | Zalo linking never dead-ends |
| `/link CODE` from WhatsApp links the chat and the card shows "Linked ✓" within 5 s | `wa.me` prefill works end to end |
| Unlinked chat message → claim link; a second message → a new link and the first stops working | One live claim link per chat |
| `/link?t=` logged out → login → confirm screen → Confirm → linked; the chat gets the success message | Linking from the chat |
| A used, expired or code-type token at `/claim` → 404 `LINK_TOKEN_INVALID`; a chat linked meanwhile → 409 | Claim rules |
| WhatsApp webhook: bad signature → 401 and nothing stored; `GET` setup check with the right/wrong token → challenge/403; a status update → 200, nothing stored; the same `wamid` twice → one draft | Webhook security and idempotency |
| WhatsApp `phở 45k` → button message → ✅ → saved; ❌ → discarded; ✏️ → Bot inbox URL; a receipt photo → KIE draft | WhatsApp capture matches Telegram |
| WhatsApp number never appears in any API response | Privacy |

**Left to the builder:** component and file layout, i18n keys and the exact wording of the instruction lines (vi + en), how the button ids are encoded within WhatsApp's 256-character id limit, and the Graph API version pinned at build time.
