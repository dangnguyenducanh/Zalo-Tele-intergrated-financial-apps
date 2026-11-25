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
| *Planned (§2.11):* ask the assistant; opt in to AI answers and reminders | — | ✅ | ✅ |
| *Planned (§2.11):* grant AI per user, switch the AI on/off, run the daily cron now | — | — | ✅ |

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
| F14 | *Planned (§2.11):* **Assistant**: questions about your own money in chat and in the Dashboard drawer (rules first, optional AI), budget pace, why-did-I-spend-more, fix/undo/split from chat; the AI may propose a change that you confirm | R (C U D only through confirm) | Dashboard drawer, (chat) |
| F15 | *Planned (§2.11):* **Proactive notices**: opt-in evening digest, early budget warning, weekly/monthly report, recurring bills prepared as drafts | C (drafts, notices) | (chat), Settings |

> **The web app works without the bots.** Customers who don't use Telegram or Zalo record everything on the website, with the quick-add box (F13) or the full add/edit form (F4). The bots are an extra way in, not the only one.

### Non-goals (kept out on purpose)
- Transfers between wallets, multiple currencies (VND only), tags, *automatically posted* recurring transactions, data import/export. (*Planned §2.11 B3* only prepares recurring bills as drafts the user confirms.)
- Any AI/LLM text parsing (decided: rule-based only). *Planned §2.11:* capture stays rule-based; an optional assistant, off until the user opts in, may answer questions through the app's own read-only functions. The wording changes in the first Stage AI PR (§2.11.7).
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
| `/` | Dashboard | **Quick-add box** at the top; month picker; "Drafts waiting" banner linking to Bot inbox; "Budgets to watch" banner (category budgets past 80 % / 100 %); total-balance card beside four figure cards (income, expense, net, budget left); this month vs last month in weekly columns with a Chi tiêu / Thu nhập switch; ranked category list; latest 5 transactions; one error banner with Retry for every query whose numbers the page shows. *Planned (§2.11.5):* "✨ Hỏi Sổ chi tiêu" header button opening the assistant drawer; MonthCompare compares the same days of last month |
| `/transactions` | Transactions | **Quick-add box**, filter bar, paginated table (cards on mobile), add/edit dialog, delete with undo snackbar |
| `/wallets` | Wallets | Wallet cards with balance; add/edit/archive/delete |
| `/categories` | Categories | Tabs expense/income; list with icon/colour/keywords; add/edit/delete |
| `/budgets` | Budgets | Month picker; overall and per-category limits with progress bar; add/edit/delete; copy last month |
| `/bot` | Bot inbox | Link Telegram/Zalo (code, deep link, QR), linked accounts, drafts list (source icon, receipt items), upload receipt. *Planned:* the link card of §2.10.2 with WhatsApp |
| `/link` *(planned)* | Link a chat | Opened from the bot's "tap to link" message: "Link **Zalo · Anh** to your account?" with Confirm / Cancel (§2.10.3). Logs in first if needed |
| `/settings` | Settings | Profile, password, language, theme, sessions (current + others, revoke). *Planned (§2.11):* "Trợ lý AI" switch and reminder choice |
| `/admin/users` | Admin · Users | System stats (F11), search, role/status chips, lock/unlock, change role. *Planned (§2.11):* AI grant per user, runtime AI switch, "Chạy ngay" cron button |
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

**Commands:** `/start` (welcome or link), `/link CODE`, `/help`, `/today` (today's spending), `/month` (month total, the overall budget and each category budget with its usage, fullest first), `/lang vi|en`. *Planned (§2.11.6):* `/hoi`, `/dubao`, `/visao`, `/sua`, `/ngansach`, `/tuan`, `/thang`, `/dinhky`, `/nhac`, `/tongket`, `/chep`, `/dunggoiy`, `/dongy`, `/thoi`, the words `hoàn tác` / `khôi phục`, and `chia N`; a question typed without a command is answered instead of becoming a draft (§2.11.1).

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
10. **Assistant and agent features (§2.11, planned):** Stage R (rules only) first, then Stage AI behind the opt-in (§2.11.7).

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
5. It calls `POST /api/chat-links/claim/preview { token }` and shows: "Link **Zalo · Anh** to **<your name> (<your email>)**? [Confirm] [Cancel]", with a warning above the buttons: "Only confirm if you just messaged the bot yourself. The chat you link can see your spending and record money in this account." Cancel goes to `/bot` and leaves the token to expire.
6. Confirm calls `POST /api/chat-links/claim { token }`. In one atomic update the token must be unused, unexpired and a claim link (has `chat`); it is marked used and a `chatLinks` row is created for the logged-in user.
7. The website goes to `/bot` with "Linked ✓ Zalo · Anh". The bot sends the chat "Đã liên kết với tài khoản <name>" in the user's language (the same text as `/link CODE` success).

**Threat and why the Confirm step:** a claim link links the chat that asked for it to whoever opens it, so it can be used for phishing. An attacker messages the bot from their own unlinked chat, sends the claim link to a victim, and if the victim confirms, the attacker's chat is linked to the victim's account: it can read `/today` and `/month` and create and confirm transactions there. The display name on the confirm screen comes from the chat app and can be faked, so it is not proof. It can't take over the web login. Mitigations: the explicit warning on the confirm screen (step 5); the 10-minute single-use token; and after a link made this way, the Bot inbox shows a notice "New chat linked from a chat link: **Zalo · Anh**. Not you? [Unlink]" until the user dismisses it, and the linked accounts list keeps the unlink button. Linking from the website (§2.10.2) has no such risk because the code starts in the logged-in account.

**API (both need login; tokens travel in the body, never in a URL the server logs):**

| Endpoint | Success | Errors |
|---|---|---|
| `POST /api/chat-links/claim/preview { token }` | 200 `{ platform, displayName }` | 404 `LINK_TOKEN_INVALID` (unknown, used or expired) |
| `POST /api/chat-links/claim { token }` | 201 `{ id, platform, displayName, createdAt, viaClaim: true }` | 404 `LINK_TOKEN_INVALID`; 409 `CHAT_ALREADY_LINKED` (that chat was linked meanwhile; the token is still spent) |

**Screen states:** loading; confirm; done (redirect); "This link has expired or was already used. Send any message to the bot to get a new one."; "This chat is already linked to an account." Both error screens have a "Go to Bot inbox" button.

### 2.10.4 The WhatsApp bot

- **Webhook:** `/api/webhooks/whatsapp`, subscribed to the `messages` field.
  - `GET` is Meta's setup check: if `hub.mode=subscribe` and `hub.verify_token` equals `WHATSAPP_VERIFY_TOKEN`, answer 200 with `hub.challenge` as plain text; otherwise 403.
  - `POST` must carry `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET>`, compared in constant time; otherwise 401 and nothing is processed. The HMAC needs the exact bytes Meta sent, but the global `express.json` in `server/src/app.js` parses every body before the routers run, and re-serialising `req.body` does not give the same bytes. So `app.js` changes the global parser to `express.json({ limit, verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/webhooks/whatsapp')) req.rawBody = buf } })` and the route signs `req.rawBody`.
  - Read `entry[].changes[].value`: `messages[]` are handled, `statuses[]` (sent/delivered/read) are ignored, and both still get 200 so Meta doesn't retry.
  - Duplicate deliveries create no second draft: the message `id` (`wamid…`) goes into `chatRef.messageId` like Telegram's and Zalo's `message_id`, and the unique chatRef index stops the copy. (As on the other platforms, a redelivered command may be answered twice.)
- **Incoming message → bot core message:** `platformUserId` and `chatId` are the user's **business-scoped user ID** (BSUID, `from_user_id` on the message / `user_id` on the contact). Meta omits `from` (the phone number) for users who adopted a WhatsApp username, so the phone number is never the key and is not stored. Replies are sent with the `recipient` field set to the BSUID; `displayName` is `value.contacts[0].profile.name`; `type: text` → `text.body`; `type: image` → photo by `image.id`; `type: interactive` with `button_reply` → a button press with `button_reply.id`. Other types (audio, sticker, location…) get the help text.
- **Sending:** `POST https://graph.facebook.com/<version>/<WHATSAPP_PHONE_NUMBER_ID>/messages` with `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `recipient: <BSUID>` (no `to`: Meta reserves `to` for phone numbers, and BSUIDs must go in `recipient`), and either `type: "text"` or `type: "interactive"` with `interactive.type: "button"`. The Graph API version is one constant in the adapter. Long replies are split at 4096 characters.
- **Drafts:** each draft is sent as a button message (✅ Lưu, ❌ Huỷ, ✏️ Sửa) whose button ids carry the same action and draft id as Telegram's callback data, so the core's existing confirm/discard path is reused. ✏️ Sửa replies with `<APP_URL>/bot`.
- **Receipts:** `GET /<image.id>` with the access token gives a `url` valid for 5 minutes; download it with the same token and pass it to KIE as with the other platforms.
- **Privacy:** the phone number is never stored (the key is the BSUID). The web shows the WhatsApp profile name, and admin stats count chats per platform without identifiers.
- Locked accounts, `/today`, `/month`, `/lang`, `/help` and budget alerts behave exactly as in §2.4.

### 2.10.5 Data, settings and setup

- Every closed list of platforms gains `whatsapp`: `chatLinks.platform`, `transactions.source` and `transactions.chatRef.platform` (Mongoose enums; without the last one every WhatsApp draft fails validation), the zod `source` filter in `server/src/routes/transactions.js`, and the platform/source lists of the admin stats in `server/src/services/admin.js`. The Bot inbox and Transactions show a WhatsApp source icon; admin stats count WhatsApp chats.
- `chatLinks` gains `viaClaim` (boolean, default `false`; `true` for a link made by a claim link) and `claimNoticeDismissedAt` (date or `null`). `GET /api/chat-links` also returns `viaClaim` and `claimNoticeDismissedAt`; the Bot inbox shows the "Not you? [Unlink]" notice for every link with `viaClaim && !claimNoticeDismissedAt`. `PATCH /api/chat-links/:id/claim-notice` (own links only, no body) sets `claimNoticeDismissedAt = now` → 204; 404 for another user's or unknown id.
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
| A message without `from` (username user) links and captures by BSUID; no phone number is stored or returned | Identity and privacy |
| A claim link opened by someone else shows the warning; after Confirm the Bot inbox shows the "Not you? Unlink" notice | Phishing mitigation |

**Left to the builder:** component and file layout, i18n keys and the exact wording of the instruction lines (vi + en), how the button ids are encoded within WhatsApp's 256-character id limit, and the Graph API version pinned at build time.

## 2.11 Assistant and agent features (planned)

**Why.** Today the bots and the web only *record* money. The assistant answers questions about the user's own money ("tháng này ăn uống hết bao nhiêu?"), looks ahead (budget pace, bills due), messages first when something needs the user, and does small jobs on request (fix, undo, split a bill, set a budget). The full design, alternatives, cost workings and reviewer notes are in [09-agent-features.md](09-agent-features.md); this section is the part to build.

**The rule everything follows.** The bot never saves or changes money data without the user's confirmation (a tap, `ok`, or a command the user types), and **every number in a reply comes from our code and MongoDB**, never from an LLM. Capture (amounts, receipt photos, any money value) never goes to an LLM, on any channel.

**Decided.** The open decisions in docs/09 are filled with its recommended answers. Each is marked ⚑: change it here before the build if you want otherwise.
- ⚑ **LLM: yes, for questions only** (docs/09 D1). Rules answer first. Claude answers only an explicit question the rules cannot parse, only for a user who opted in and whom an admin granted AI, and only through our own read-only functions. With the AI off, everything in §2.11.2, §2.11.3 and §2.11.5 still works (the drawer answers with rules).
- ⚑ **Agent loop: the Messages API Tool Runner inside our Express function** (docs/09 D2 option B), not Managed Agents.
- ⚑ **Model `claude-opus-5-5`, effort `low`**, switchable with `ASSISTANT_MODEL` after the eval (D3).
- ⚑ **Spend: $10 a month in total, $1 per user**, on a dedicated prepaid key with auto-reload off (D4).
- ⚑ **AI channels: web and Telegram.** Zalo off (capture alone can use its 3,000 messages). WhatsApp off until §2.10 ships, then a ceiling of 950 replies a month for all replies (D5).
- ⚑ **Proactive messages are opt-in**, from one daily cron at about 20:00; Telegram gets them directly, Zalo only on the user's next reply, WhatsApp only within 24 h of the user's last message.
- ⚑ **Chat may change confirmed data only through typed commands or a confirm card** (`/sua`, `hoàn tác`, `/ngansach`, C3 cards). The bot may *prepare* a draft on its own (B3), never save one.
- ⚑ **A week is Monday–Sunday** in every reply, stated in the reply's period line.
- **Not in this spec** (stay in docs/09 as later options): embeddings (Voyage), the LLM query planner (`truy_van_tu_do`), LLM phrasing of facts (C2), savings goals (B5).

**Success looks like:** "tháng 10 thu bao nhiêu" typed anywhere never creates a transaction; the 8 starter questions in §2.11.3 get exact answers with the AI switched off; the defense can flip the AI on and off without a redeploy and show the same numbers both ways.

### 2.11.1 Who answers what

The first match wins, in this order inside `handleMessage` (Telegram button presses are handled before all of it, as today):

| # | Incoming | Answered by |
|---|---|---|
| 1 | `/start CODE`, `/link CODE`, unlinked or locked chat | Rules, as today (§2.4, §2.10) |
| 2 | Photo | KIE → draft → confirm, as today (§2.6) |
| 3 | `/hoi <question>` | The question path (§2.11.3), explicit |
| 4 | Any other command (§2.11.6) | Rules / templates |
| 5 | Reserved words `ok`, `huy`, `hoàn tác`, `khôi phục` | Rules (drafts, A4 undo) |
| 6 | Everything else | `classify(text, { followUp })` → **question** → §2.11.3, or **capture** → `createDrafts` as today |

**`classify` is a pure function in `bot/ask.js`, no database, no AI.** The first rule that fires decides:
1. Starts with `?` → question.
2. More than one non-empty line → capture.
3. Ends with `?` → question, even with an amount.
4. Last word `chưa`, `không` or `ko`, or `bao nhiêu` anywhere → question.
5. Time phrases, `top N`, `N khoản`, `N ngày` are consumed first (by `period.js`), so a year after `năm`/`tháng` or a day count is never an amount. Then an explicit amount in the remaining words (a unit like `45k`, `1tr2`; thousands separators; 5+ digits) → capture.
6. A strong question marker (`bao giờ`, `khi nào`, `thế nào`, `tại sao`, `vì sao`, `tổng kết`, `so với`, `how much`, `why`; `sao` as the first or last word; `mấy` only with diacritics) → question. Weak cues (`top`, `tìm` with its accent, `còn lại`) count only at the start of a message that has no amount at all, not even a bare number, so "tìm phở" is a question while "tim heo 50" and "crop top 120" stay captures.
7. `followUp` (an AI or skill answer went to this chat in the last 10 minutes; always true in the web drawer) and no amount → question.
8. Anything else → capture (a bare number is still guessed as thousands; no amount → help text).

Ties lean to *question*: a capture read as a question saves nothing, while a question read as a capture creates money data. **On the web**, `POST /api/transactions/parse` runs the same `classify` (`followUp: false`) and returns `{ question: true, drafts: [], noAmountLines: [], truncated: false }`; QuickAdd's Enter then saves nothing and shows the chip "Đây là câu hỏi · Hỏi Sổ chi tiêu ›".

### 2.11.2 Rule-based features (no LLM)

| # | Feature | In chat | What it does | Built on |
|---|---|---|---|---|
| A1 | **Ask in plain Vietnamese** | any question, `/hoi` | Exact answer from the user's data, through the skill engine (§2.11.3). Every reply names the period and filter it used | `ask/` engine |
| A2 | **Budget pace and month-end forecast** | `/dubao` | "Còn 900.000 ₫ cho 6 ngày → tối đa 150.000 ₫/ngày; theo nhịp này cuối tháng ≈ 8.520.000 ₫, vượt khoảng 29/11". Shown from day 5 of the month | new pure `pace({spent, limit, day, daysInMonth})` in `services/budgets.js`; `listBudgets()` adds it to every budget, so `/month`, the confirm warning line and a Budgets page chip show the same number |
| A3 | **Why did I spend more** | `/visao`, "sao tháng này tiêu nhiều vậy" | The 3 categories that changed most against the same days last month, unusual rows (> 3× the category's 90-day median), and one tip from a fixed numbered rule list (R2 category spike, R3 pace over budget, R5 top category without a budget) with an action button | `confirmedInRange(start, end)` (generalises `confirmedInMonth`), `compareRange()` |
| A4 | **Fix or undo from chat** | `/sua <changes>`, `hoàn tác`, `khôi phục` | `/sua` edits the waiting draft, or else the transaction this chat confirmed in the last 15 minutes. `hoàn tác` deletes the last one confirmed (restorable with `khôi phục`). Not "sửa …" without the slash: "sửa xe 150k" is a real expense | `updateTransaction`, `deleteTransaction`, `restoreTransaction`; new `chatLinks.lastConfirmedId` |
| A5 | **Split the bill** | `cơm 1tr2 chia 4`, or `chia 3` alone | Amount = ceil(total ÷ N ÷ 1000) × 1000, note gets "(1.200.000 ₫ ÷ 4)". `chia N` alone divides the waiting draft (receipt drafts too). N from 2 to 50 | one parser rule, applied before `findAmount()` |
| A6 | **Draft check** | (on every draft) | Up to 2 extra lines on the draft: an amount ≥ 5× the category's 90-day median (needs ≥ 5 samples; 3× when the amount was guessed), and the same amount + category drafted in the last 10 minutes | `draftHints()`; the quick-add preview gets the same `hints` |
| A7 | **Learns your words** | tap a category on a fallback draft | When the parser fell back to Khác/Other, the bot offers the top 3 expense categories; the tap moves the draft and adds the note's first word to that category's `keywords` (skipped if another category owns it). On Zalo, type the category name | `$addToSet` on `categories.keywords` |
| B1 | **Evening digest** (opt-in) | `/nhac toi\|tuan\|tat`, `/tongket` | Today's spending, drafts still waiting (sent again with working buttons), the daily budget limit from A2, and the logging streak. A quiet day sends nothing; a day with nothing logged gets one line | cron engine below |
| B2 | **Early over-budget warning** | (in the digest) | From day 5, when the projection is ≥ 110 % and usage is still < 80 %. At most one per budget per week | `pace()` |
| B3 | **Recurring bills → draft on the due day** | `/dinhky` | Groups 180 days of confirmed expenses by the note's first 2 words (≥ 3 times, ≥ 6 days apart); confidence = 0.2 + 0.4·min(n/10, 1) + 0.4·clamp(1 − CV). The day before it is due, at confidence ≥ 0.7 (≥ 0.85 on Zalo), the cron creates a **draft** in one chat only; the user confirms it | `detectRecurring()`; `chatRef.messageId = rec:<date>:<key>` makes a rerun a no-op |
| B4 | **Weekly and monthly report** | `/tuan`, `/thang`, `/chep`, `/dunggoiy` | Sunday evening: `tong_ket_tuan`. Day 1: `tong_ket_thang` plus next month's suggested budgets (median of the last 3 months, rounded up to 50.000 ₫) with [Chép T11] [Dùng gợi ý]. Same skills as chat, so chat and cron say the same thing | `copyBudgets()`, `createBudget()` (skip 409) |

**Cron engine (B tier).** `vercel.json` gets one cron `0 13 * * *` (20:00–20:59 Vietnam time; Hobby runs it once a day, production only, no retry) calling `GET /api/cron/daily` with `Authorization: Bearer ${CRON_SECRET}`, checked with the existing `sameSecret()`. One sequential loop over opted-in users. A `notices` collection, unique on `(userId, kind, key)`, gets a row *before* each send, so a double fire sends nothing twice. Every Zalo and WhatsApp send adds to `channelUsage {platform, month, sent}`; proactive Zalo sends stop at 2,000 a month. A user linked on several apps gets proactive messages on Telegram only. Admins get `POST /api/admin/cron/daily` ("Chạy ngay") for the demo, because crons don't fire locally.

### 2.11.3 The question engine (skills, rules first)

`answerQuestion({ user, channel, threadKey, text, month, explicit, requestKey })` → `{ route, text, sources, action?, remainingToday }` is the one entry point for the bots, the web drawer and the QuickAdd chip. Its stages, in `server/src/ask/`:

1. **Reserve the turn.** Insert the `askTurns` row first, unique on `requestKey` (the chatRef `(platform, chatId, messageId)` or the web `requestId`). A duplicate key stops here, so a redelivered webhook or a double click answers once. Rate limits count these rows.
2. **Normalize.** NFC, 1–500 characters. `period.js` reads time phrases (hôm nay, hôm qua, tuần này/trước, tháng này/trước, tháng N, năm YYYY, N ngày qua, cuối tuần) in Asia/Ho_Chi_Minh and consumes their words. Entity linking then finds categories, wallets and aliases. `type` is decided from the original words when the message has diacritics ("thứ hai" is a weekday, not "thu").
3. **Route by keywords.** Each skill has weighted phrases; a pair of (question phrase + linked entity) is decisive, e.g. `bao nhiêu` + category → `chi_theo_danh_muc`, `còn bao nhiêu` + wallet → `so_du_vi`. A clear winner goes on; a tie between two skills asks back with numbered options (buttons on Telegram and WhatsApp; reply `1`–`3` within 10 minutes on Zalo; a bare `1`–`3` after that, while the chat's last ask-back expired less than 24 h ago, gets "Câu hỏi đã hết hạn, hãy hỏi lại" and never reaches `createDrafts` or the Zalo amount correction); no match goes to the AI gate (§2.11.4), else the help text with 3 example questions.
4. **Fill slots and run.** Required slots come from the linking or the skill's default. A linked filter the skill doesn't accept is not dropped silently: the reply adds "Bỏ qua điều kiện: …". The skill runs its steps through existing services or `compileIR()`.
5. **Answer from a template** (vi/en) with a sources line, e.g. "Nguồn: So sánh cùng kỳ 11/2026". Templates format money with the server's `money()`.

**Starter skills.** v1 (rules only) ships the first 8; the next 3 follow A2/A3:

| Skill | Example | Reuses |
|---|---|---|
| `thu_chi_ky` | "hôm nay tiêu bao nhiêu?", "tháng 10 thu bao nhiêu" | `daily()`, `monthSummary()`, else the IR |
| `tong_ket_tuan` | "tổng kết tuần trước", `/tuan` | `rangeSummary`, `rangeByCategory`, `pace()` |
| `tong_ket_thang` | "tổng kết tháng 10", `/thang` | `monthSummary`, `listBudgets`, `byCategory` |
| `chi_theo_danh_muc` | "tháng này ăn uống hết bao nhiêu?" | `byCategory()`, else the IR |
| `so_sanh_ky` | "tháng này so với tháng trước?" | `monthSummary` ×2, else the IR |
| `top_khoan_chi` | "5 khoản chi lớn nhất tuần trước" | `list` IR (confirmed only) |
| `so_du_vi` | "momo còn bao nhiêu?" | `listWallets()` |
| `ngan_sach_con_lai` | "ngân sách ăn uống còn bao nhiêu" | `listBudgets()` + `pace()` |
| `du_bao_cuoi_thang` | `/dubao`, "cuối tháng tiêu hết bao nhiêu" | `pace()` (A2) |
| `giai_thich_tang_chi` | `/visao`, "sao tháng này tiêu nhiều vậy" | A3 |
| `tim_giao_dich` | "tìm phở", "đã mua gì ở Circle K tháng này" | `list` IR with an accent-folded search on `note` and `receipt.merchant` |

**Query IR.** A query skill becomes a `QueryIR` (zod, strict): `kind aggregate|list`, `measure`, `type`, `period {from, to}`, `compareTo`, `filters {categoryIds, walletIds, weekdays, minAmount, maxAmount, text}`, `groupBy`, `order`, `orderBy value|key`, `limit`. `validateIR` (pure) checks that every id is the user's own, `from ≤ to ≤ today`, a span ≤ 400 days, `min ≤ max`. `compileIR` (ours, never the LLM's) builds the aggregation: always `userId` and `status: 'confirmed'`, soft-deleted rows excluded, `maxTimeMS(5000)`, and `$limit` applied after totals and shares are computed.

**Number rules the build must keep:**
- **Comparisons shift by one calendar unit of the period**, based on the period, not on today: Mon 23–Wed 25/11 → Mon 16–Wed 18/11; 01–25/11 → 01–25/10; 01–31/10 → 01–30/09. One `compareRange()` in `utils/vnTime` serves A3, `so_sanh_ky` and the Dashboard's MonthCompare sentence, which changes to compare the same days ("cùng kỳ tháng trước").
- "Biggest month/weekday" questions sort by value (`orderBy: value`), not by date.
- Previous period = 0 → no percentage, the line says there was no spending before.
- Every `askTurns` read (follow-ups, ask-back replies, Telegram `q:` buttons) filters by `userId` too, and carried slots go through `validateIR` again.

### 2.11.4 Optional AI layer (Claude)

Runs only when the rules could not answer an **explicit** question (`?`, `/hoi`, the drawer, or a follow-up within 10 minutes of an AI answer) and the **AI gate** is open: `ANTHROPIC_API_KEY` set and `ASSISTANT_ENABLED=true` (redeploy to change); the admin runtime switch on (`appSettings`, no redeploy); the user opted in (`aiOptIn`, off by default, with the line "Câu hỏi và số liệu liên quan được gửi tới Anthropic để trả lời."); an admin granted AI to the user (`aiGranted`); the channel is in `ASSISTANT_CHANNELS`; and the turn's reservation fits every cap. Otherwise the client is never constructed and the user gets the rules' help text.

- **SDK and call:** the official `@anthropic-ai/sdk`, server only, imported lazily from the question branch so it never slows capture. `client.beta.messages.toolRunner({ model, max_tokens: 2000, max_iterations: 4, tools, system, messages, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })`, not streamed, with an `AbortController`: 25 s in chat, 40 s on the web; `maxRetries: 1`.
- **Tools are read-only** and close over `userId` from the JWT or ChatLink; no schema has a `userId`. They are the skills of §2.11.3 plus `get_month_summary`, `get_category_totals`, `get_budgets`, `list_transactions` (confirmed only, `limit ≤ 20`), `get_wallet_balances` and `propose_action`. Inputs are strict zod; category and wallet are passed by *name* and resolved on the server.
- **What the model sees:** one serializer, `toModel()`. Every number, date, period and verdict is a figure `{ id, label, display }`. Notes are cut to 60 characters, and any run of 8+ digits or an email in free text becomes `•••`. Never the user's name, email, phone, chat names, BSUIDs or chat ids.
- **Reference-only answers (the guard):** the model's own text may contain no digits, no number words (`hai`, `triệu`, `gấp đôi`, `million`…), no verdict words (`vượt`, `tăng`, `giảm`, `over`, `more`…), no URL, @handle or email. It writes `[[id]]` and our code replaces it with `label: display`, so a figure always carries its own label. Only a final `end_turn` passes. Any failure, refusal, timeout, 429/5xx or cap → the template answer built from this question's tool results (or the help text).
- **C3, the AI proposes, you tap:** `propose_action` (`set_budget`, `copy_budgets`, `delete_transaction`) writes nothing; it inserts one `pendingActions` row (10 minutes) and the user gets a confirm card: Telegram buttons ✅ Đồng ý / ✖️ Thôi (`ao:<id>` / `an:<id>`), WhatsApp reply buttons, Zalo typed `/dongy` / `/thoi`, web card buttons. It is accepted only if the user's *own message* has a change verb (`đặt`, `sửa`, `xoá`, `chép`, `set`, `delete`, `copy`); a budget limit is the one amount the parser's `findAmount()` finds in that message, never a model value; a transaction id must be one `list_transactions` returned in this question. The tap flips the row `pending → done` atomically, then runs the same service as the web.
- **Caps:** per user per day: 10 AI questions on Telegram, 5 on Zalo, 3 on WhatsApp, 20 on the web. $1 per user and `ASSISTANT_MONTHLY_USD_CAP` (10) in total per month, counted from the turns' `reservedUsd` ($0.32 worst case) and then their real `costUsd`.
- **Cost:** about $0.036 per AI question on Opus 5.5 with a cold cache (docs/09 §2.8); the $10 cap covers about 280 AI questions a month. Rule answers cost nothing.

### 2.11.5 Web: the "Hỏi Sổ chi tiêu" drawer

- **Where:** a "✨ Hỏi Sổ chi tiêu" button in the Dashboard header beside the month picker (icon only on phones) opens an MUI `Drawer` (420 px from `sm`, full width on phones). The QuickAdd question chip opens it with the text already sent. No new route.
- **Inside:** 4 starter chips when empty; the thread (the last 6 turns go along as context); every answer has a badge "Theo mẫu" or "AI" and a sources line; action cards with Đồng ý / Thôi; "Còn N câu hỏi AI hôm nay"; a Dừng button while waiting; "Xoá" clears the thread. A capture typed here (`phở 45k`) gets the quick-add preview card.
- **Endpoints** (`routes/assistant.js`, `requireAuth`, zod): `POST /api/assistant/chat { message 1–500, month?, requestId }` → `{ route, text, sources, action?, capture?, remainingToday }` (the same `requestId` twice → 409 `DUPLICATE`); `GET` / `DELETE /api/assistant/thread`; `POST /api/assistant/actions/:id/confirm` and `/cancel` (404 not this user's or expired, 409 already done).
- **Settings:** a "Trợ lý AI" switch with the disclosure line, and the B1 reminder choice. **Admin users page:** an "AI" grant toggle per user, and the runtime AI switch next to "Chạy ngay".
- **Accessibility:** the drawer is labelled by its title; focus goes to the input on open and back to the button on close; the list is `role="log"` and the finished answer is announced once; chips and card buttons have full labels; no spinner animation under `prefers-reduced-motion`; Enter sends, Shift+Enter adds a line.

### 2.11.6 Channels, commands and data

| | Telegram | Zalo | WhatsApp (§2.10) | Web |
|---|---|---|---|---|
| AI by default | on (opt-in still needed) | off | off until §2.10 ships | on (opt-in still needed) |
| Reply | one message, ≤ 1,500 chars, "typing" every 4 s | one message, ≤ 1,500 chars, never split | one message, ≤ 1,500 chars; cards as reply buttons | JSON |
| Quota guard | — | AI off at 2,400 messages a month; from 2,850 only capture replies | AI off at 800; at 950 all replies stop, captures still land in the Bot inbox | — |
| Proactive (B tier) | sent directly | rides on the next reply | only within 24 h of the user's last message | banner on the next visit |

**New commands** (vi, with English aliases where natural): `/hoi`, `/dubao`, `/visao`, `/sua`, `/ngansach <danh mục> <số tiền>`, `/tuan`, `/thang`, `/dinhky`, `/nhac toi|tuan|tat`, `/tongket`, `/chep`, `/dunggoiy`, `/dongy`, `/thoi`; reserved words `hoàn tác`, `khôi phục`; the parser rule `chia N`. `/help` lists them.

**Data:**
- New collections: `askTurns` (one row per question: `userId, channel, threadKey, requestKey` unique, question ≤ 500, answer, route, skill, slots, IR, status, model, usage, `reservedUsd`, `costUsd`, guard result, `pendingAsk`; TTL 30 days; admins never see it), `pendingActions` (TTL 10 minutes after expiry), `notices` (unique `(userId, kind, key)`), `channelUsage`, `appSettings` (`{_id: 'global', assistantEnabled}`).
- `users` gains `aiOptIn`, `aiGranted` (both default `false`) and `notify` (`off|daily|weekly`, default `off`). `chatLinks` gains `lastConfirmedId`. `note` and `receipt.merchant` are saved NFC-normalized.
- New environment variables (all optional; a missing one turns its feature off, as with KIE): `ANTHROPIC_API_KEY`, `ASSISTANT_ENABLED` (default `false`), `ASSISTANT_MODEL` (default `claude-opus-5-5`), `ASSISTANT_EFFORT` (`low`), `ASSISTANT_CHANNELS` (`web,telegram`), `ASSISTANT_MONTHLY_USD_CAP` (`10`), `CRON_SECRET`.
- **Logs** carry only the turn id, stage and error class, never the question, notes, figures or tool arguments; `ANTHROPIC_LOG` stays unset in production.
- `docs/01` (§1.6, §1.7 AI rows), `docs/03` (collections), `docs/04` (endpoints, the idempotency paragraph), `docs/05` (drawer, chips, Settings and admin switches), `docs/06` (cron, Anthropic key) and `docs/07` (cases below) are updated in the PR that builds each part.

### 2.11.7 Build order

**Stage R, rules only (no key, no decision needed):**
1. `classify` + `/hoi` + the router slot in `handleMessage` + `question: true` from `/transactions/parse` and the QuickAdd chip. Fixes the "question becomes a draft" risk on its own.
2. A2 `pace()` and `/dubao`.
3. The question engine with the 8 v1 skills, `askTurns`, and the drawer in rules-only mode, plus the `compareRange()` fix in MonthCompare.
4. B1 digest on Telegram, with the cron, `notices` and `channelUsage` engine.
5. A5, A6, A3, A4, A7, then B2, B4, B3.

**Stage AI (after Stage R ships):** the half-day SDK spike; then the gate, opt-in, admin grant, runtime switch, caps and guard; the agent on the **web** with the eval; then Telegram; then C3 cards; Zalo and WhatsApp last, under their quota guards. The §2.2 non-goal changes to the wording in docs/09 §2.9 in the first Stage AI PR.

### 2.11.8 Acceptance checks

| Check | Proves |
|---|---|
| "tháng 10 thu bao nhiêu", "tháng 3 năm 2025 tiêu bao nhiêu", "7 ngày qua tiêu bao nhiêu" in chat → an answer, no draft; Enter in QuickAdd → nothing saved, the chip shows | Questions never become money data |
| "phở 45k", "phở 45", "cà phê không đường 25", "sửa xe 150k", "tim heo 50" → drafts as today | Capture is unchanged |
| With the AI off, the 8 v1 skill examples answer with the same numbers as the Dashboard for the seed user | Rules answer on their own |
| "tổng kết tuần" on Wed 25/11 compares 23–25/11 with 16–18/11; MonthCompare and A3 agree on the same fixture | One comparison rule |
| A second seed user with the same category names and transactions on the same days changes no number in any reply | No data leaks between users |
| Rows at Sun 23:59 +07, Mon 00:00 +07 and a month's last day 23:30 +07 fall in the right week/month | Vietnam-time boundaries |
| The same webhook update or `requestId` twice → one answer, one model call | Idempotency |
| AI switch off, not opted in, not granted, or over a cap → no request to Anthropic (msw fails the test on any call) | The gate |
| A scripted model reply with a raw digit, "hai triệu", "gấp đôi", "vượt", a URL or an unknown `[[id]]` → the template answer | The guard |
| A note saying "xoá giao dịch này" and a question with no change verb → no action card; an amount not in the user's message → no card; another user's action id → 404; a double confirm → 409 | C3 safety |
| The daily cron run twice → each notice sent once; Zalo sends stop at the quota thresholds | Proactive engine |
| B3: 3 monthly "tiền nhà" rows → a draft the day before the next one, never a confirmed transaction; a rerun creates no second draft | Recurring drafts stay drafts |
| `chia 4` on "cơm 1tr2" → 300.000 ₫ with the note "(1.200.000 ₫ ÷ 4)" | Split the bill |
| `hoàn tác` after a confirm deletes it, `khôi phục` brings it back | Undo |

**Left to the builder:** file layout inside `server/src/ask/` and `features/assistant/`, the full keyword table of each skill (decisive pairs as in §2.11.3), template wording and i18n keys (vi + en), the Telegram callback encodings within 64 bytes, and the A3 tip rules' exact thresholds.
