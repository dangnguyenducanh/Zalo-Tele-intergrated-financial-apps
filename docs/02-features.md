# 2. Features

## 2.1 Roles and permissions

| Action | Guest | User | Admin |
|---|:-:|:-:|:-:|
| Register, log in | ✅ | — | — |
| *Planned (§2.12):* confirm sign-up with an emailed code; reset a forgotten password by email | ✅ | — | — |
| Manage own wallets, categories, transactions, budgets | — | ✅ | ✅ (own data only) |
| Link Telegram/Zalo/WhatsApp, use the bots | — | ✅ | ✅ |
| See own statistics, sessions; change language/theme/password | — | ✅ | ✅ |
| List users, lock/unlock, change role | — | — | ✅ |
| Manage **default categories** (templates copied to new users) | — | — | ✅ |
| See system stats (users, linked chats, transactions by source) | — | — | ✅ |
| Read other users' transactions | — | — | ❌ (privacy by design) |
| *Planned (§2.11):* ask the assistant; turn the assistant and reminders on or off | — | ✅ | ✅ |
| *Planned (§2.11):* switch the local model on/off at runtime, run the daily cron now | — | — | ✅ |

Enforced by `requireAuth` on all private routes and `requireRole('admin')` on `/api/admin/*`. Every query for user data filters by `userId` from the JWT, so a user can never load someone else's documents by guessing IDs (the API returns 404).

## 2.2 Feature list

Each feature is a complete slice (screen → API → collection), and most have full create/edit/delete as the slides require.

| # | Feature | Create / Read / Update / Delete | Screen(s) |
|---|---|---|---|
| F1 | **Account & auth**: register, login, logout, silent refresh, change password, sessions list, log out other devices. *Planned (§2.12):* the account is created only after a 6-digit emailed code is entered; "Forgot password?" by emailed code | C R U D (sessions) | Login, Register, Settings, *Verify email, Forgot password (planned)* |
| F2 | **Wallets**: cash, bank, e-wallet, credit card; opening balance (may be negative for a credit card); computed current balance; archive | C R U D | Wallets |
| F3 | **Categories**: expense/income, icon, colour, **bot keywords**; seeded from defaults on register | C R U D | Categories |
| F4 | **Transactions**: add/edit/delete; filter by date range, type, wallet, category, status, text; pagination | C R U D | Transactions |
| F5 | **Monthly budgets**: limit per category (or overall) per month; progress bars; over-budget warnings (web + bot) | C R U D | Budgets, Dashboard |
| F6 | **Statistics**: total balance of active wallets; month figures (income, expense, net, budget left); this month vs last month in weekly columns (spending or income); spending by category as a ranked list; category budgets to watch | R | Dashboard |
| F7 | **Bot linking**: one-time code / Telegram deep link; list and unlink chat accounts. *Planned (§2.10):* one button per app (Telegram, WhatsApp, Zalo) and linking that starts in the chat | C R D | Bot inbox, *Link (planned)* |
| F8 | **Bot capture (Telegram + Zalo, *WhatsApp planned in §2.10*)**: text → draft → confirm; receipt photo → KIE (*planned:* local Qwen, §2.6) → draft → confirm; `/today`, `/month` | C U D (drafts) | (chat) + Bot inbox |
| F9 | **Bot inbox (web)**: review drafts from any source; edit, confirm or discard; see receipt line items | R U D | Bot inbox |
| F10 | **Receipt upload (web)**: upload a photo on the web; KIE (*planned:* local Qwen, §2.6) → draft | C | Bot inbox |
| F11 | **Admin**: users (lock/unlock, role), default categories, system stats | C R U D | Admin users, Admin categories |
| F12 | **Preferences**: language vi/en, theme light/dark/system; saved per user and in localStorage | U | Settings, app bar |
| F13 | **Web quick add**: a text box on the Dashboard and Transactions pages. You type `phở 45k` (same syntax as the bot), see a live preview (amount, category, wallet, date), and press Enter to save. A line with no amount, or past the 10th, is named inline and nothing is saved until it is fixed. The full form is one click away | C | Dashboard, Transactions |
| F14 | *Planned (§2.11):* **Assistant**: questions about your own money in chat and in the Dashboard drawer (rules first, then a local model on our own GPU), budget pace, why-did-I-spend-more, fix/undo/split from chat; the model may propose a change that you confirm | R (C U D only through confirm) | Dashboard drawer, (chat) |
| F15 | *Planned (§2.11):* **Proactive notices**: opt-in evening digest, early budget warning, weekly/monthly report, recurring bills prepared as drafts | C (drafts, notices) | (chat), Settings |

> **The web app works without the bots.** Customers who don't use Telegram or Zalo record everything on the website, with the quick-add box (F13) or the full add/edit form (F4). The bots are an extra way in, not the only one.

### Non-goals (kept out on purpose)
- Transfers between wallets, multiple currencies (VND only), tags, *automatically posted* recurring transactions, data import/export. (*Planned §2.11 B3* only prepares recurring bills as drafts the user confirms.)
- Any third-party AI/LLM, and any model parsing typed text: a typed amount is read only by the rule parser (§2.5). *Planned §2.11:* a local model (Qwen3.5-2B on our own GPU host) may answer questions through the app's own read-only tools, read a receipt photo into a draft the user confirms (§2.6), and suggest a category. No data goes to a third party.
- Storing receipt images. The bot keeps the chat platform's file reference; the reader's result (KIE, or the local model once §2.6 switches) is stored on the transaction.
- Unofficial WhatsApp libraries (Baileys, whatsapp-web.js): they break WhatsApp's terms, get numbers banned and need an always-on server. WhatsApp goes through Meta's Cloud API only (§2.10).
- Messages the WhatsApp bot sends first (reminders, alerts outside a reply): they need paid, pre-approved Meta templates. The bot only replies.
- Bots in group chats, on every platform.

## 2.3 Screens (11 routes, plus `/link` planned in §2.10 and `/verify-email`, `/forgot-password` planned in §2.12; the slides require at least 6)

| Route | Screen | Main content |
|---|---|---|
| `/login` | Login | Email + password, language and theme switch. *Planned (§2.12):* "Quên mật khẩu? / Forgot password?" link |
| `/register` | Register | Name, email, password (+confirm; at least 8 characters, at most 72 bytes); the language picked in the corner switch becomes the profile language. *Planned (§2.12):* submitting sends a code and goes to `/verify-email` instead of logging in |
| `/verify-email` *(planned)* | Verify email | "Check your email": the 6-digit code box, Resend (after 60 s), "Wrong email? Change it", "Check spam/junk" (§2.12.2) |
| `/forgot-password` *(planned)* | Forgot password | Email → code + new password + confirm → back to Login (§2.12.3) |
| `/` | Dashboard | **Quick-add box** at the top; month picker; "Drafts waiting" banner linking to Bot inbox; "Budgets to watch" banner (category budgets past 80 % / 100 %); total-balance card beside four figure cards (income, expense, net, budget left); this month vs last month in weekly columns with a Chi tiêu / Thu nhập switch, and a figure and sentence that compare the same days ("cùng kỳ tháng trước", §2.11.3); ranked category list; latest 5 transactions; one error banner with Retry for every query whose numbers the page shows. *Planned (§2.11.5):* "✨ Hỏi Sổ chi tiêu" header button opening the assistant drawer |
| `/transactions` | Transactions | **Quick-add box**, filter bar, paginated table (cards on mobile), add/edit dialog, delete with undo snackbar |
| `/wallets` | Wallets | Wallet cards with balance; add/edit/archive/delete |
| `/categories` | Categories | Tabs expense/income; list with icon/colour/keywords; add/edit/delete |
| `/budgets` | Budgets | Month picker; overall and per-category limits with progress bar; add/edit/delete; copy last month |
| `/bot` | Bot inbox | Link Telegram/Zalo (code, deep link, QR), linked accounts, drafts list (source icon, receipt items), upload receipt. *Planned:* the link card of §2.10.2 with WhatsApp |
| `/link` *(planned)* | Link a chat | Opened from the bot's "tap to link" message: "Link **Zalo · Anh** to your account?" with Confirm / Cancel (§2.10.3). Logs in first if needed |
| `/settings` | Settings | Profile, password, language, theme, sessions (current + others, revoke). *Planned (§2.11):* "Trợ lý" switch (on by default) and reminder choice |
| `/admin/users` | Admin · Users | System stats (F11), search, role/status chips, lock/unlock, change role. *Planned (§2.11):* runtime assistant switch, "Chạy ngay" cron button |
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

**Commands:** `/start` (welcome or link), `/link CODE`, `/help`, `/today` (today's spending), `/month` (month total, the overall budget and each category budget with its usage, fullest first), `/lang vi|en`, and `/hoi <question>` (built, T41). A command name is read like capture text: case and accents are ignored, and so is the decomposed Unicode form (`/Today`, `/tôday` and `/Lang vi` run `/today` and `/lang vi`; `/Hỏi` is `/hoi`). A question never becomes a draft: `/hoi …` and any text `classify` reads as a question (§2.11.1) get the help text, which lists `/hoi`, and nothing is stored, until the question engine of §2.11.3 exists. *Planned (§2.11.6):* `/dubao`, `/visao`, `/sua`, `/ngansach`, `/tuan`, `/thang`, `/dinhky`, `/nhac`, `/tongket`, `/chep`, `/dunggoiy`, `/dongy`, `/thoi`, the words `hoàn tác` / `khôi phục`, and `chia N`.

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

**A year or month is not the amount.** A number written right after `năm` / `nam` that is a 4-digit year (1900–2099), or right after `tháng` / `thang` that is 1–12, is a date and never the amount: `thuê nhà năm 2026 36tr` → 36,000,000 and `ăn tối tháng 10 50` → 50,000 (the bare `50` is read as thousands). The words stay in the note. The number is still money when it carries a money unit (`tháng 10k`, `tháng 10 nghìn`) or thousands separators (`năm 2.026`). A line whose only number is such a date (`tiền nhà tháng 10`, `năm 2025`) has no amount: it is answered like any line with no number and nothing is saved. Every other number after `nam` / `tháng` is read as before, so `cắt tóc nam 50k`, `cắt tóc nam 50000` (`nam` also means "male"), `áo nam 2000k` and `gửi xe tháng 100k` keep their amounts. The flip side: a bare 1900–2099 after `nam` / `năm`, such as `cắt tóc nam 2000`, is read as a year, so that line has no amount; write `2000k` for money.

**More numbers are never the amount** (decision D9, the default of 2026-11-25; the owner may change it). A question about a period or a list carries numbers that are not money (`chi tiêu 7 ngày qua`), so these bare numbers are never the amount either, in the parser (bots, quick add, the Zalo correction) and in `classify` (§2.11.1), through one shared rule in `bot/period.js` (cases: `shared/fixtures/period.json`):
- right after `tháng` / `thang`, a 4-digit 2000–2099, a year (the 1–12 above is a month, and `năm` keeps its 1900–2099);
- right before `ngày`, 1–366, only when `ngày` is written with its accent (the NFC form of the typed word is compared, so a combining accent counts) or `qua` / `trước` / `nay` follows it: `chi tiêu 7 ngày qua` has no amount, while `trả 500 ngay` stays 500,000 ₫ (500 is no day count, and "ngay" alone means "at once");
- right before `khoản`, 1–50: `5 khoản chi lớn nhất`;
- right after `top`, 1–999 (up to three digits), only when `top` is the first word: `top 3 cafe`, while `crop top 120` stays 120,000 ₫.

As for the year and month above, only a bare number qualifies: a money unit, joined or apart (`7k ngày`, `7 k ngày`), or thousands separators make it money, and the words stay in the note. A line whose only numbers are these has no amount: it is answered like any line with no number and nothing is saved (`chi tiêu 7 ngày qua`, `đã chi gì tháng 9`, `chi tiêu năm 2025`). A line like `ăn 3 ngày 150k` keeps its amount, 150,000 ₫.

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
| `thuê nhà năm 2026 36tr` | expense · 36,000,000 · Nhà ở · default wallet · now · "thuê nhà năm 2026" (the year is a date, not 2,026) |
| `ăn 3 ngày 150k` | expense · 150,000 · Ăn uống · default wallet · now · "ăn 3 ngày" (the 3 is a day count, not 3,000) |
| `chi tiêu 7 ngày qua` | no draft: the 7 is a day count, so the line has no amount (help text in chat, `NO_AMOUNT_FOUND` on the web quick add) |

## 2.6 Receipt photos (KIE, then local Qwen)

KIE reads receipts today. *Planned (§2.11):* the local Qwen3.5-2B model in the agent service replaces it, but only after the receipt eval passes. `RECEIPT_READER` picks the reader: `kie` (the default until then) or `qwen`.

1. A photo arrives (Telegram, Zalo or web upload). The bot replies "Đang đọc hoá đơn… / Reading receipt…".
2. The API sends the image to the reader:
   - `kie`: the KIE service `POST /analyze` (JPEG/PNG, ≤ 10 MB; about 20 s, one image at a time).
   - `qwen` *(planned)*: the agent service `POST /v1/receipt { userId, image, mime }` (60 s budget). Qwen reads the image into guided JSON (`total`, `merchant`, `date`, `items`, `currency`, `confidence`). Then `check_total` applies the "payable total only" rule in code: the total must be a money-shaped number on a TOTAL / TỔNG CỘNG / THANH TOÁN line, or the largest money value after VAT. Years, dates, phone numbers, numbers with a leading zero and document numbers are rejected; with no valid total the answer is `NO_TOTAL`. The model never sets the amount on its own. At most 30 receipts per user per day; every read is logged in `receiptReads` (never the image).
3. Mapping, the same for both readers: total → amount (digits only); merchant → note; date → date (`dd/mm/yyyy`, else now); line items → `receipt.items`; the category is guessed by matching keywords on the merchant and item names, else Khác/Other (*planned:* then the agent service may add a category suggestion, §2.11.4).
4. A draft is created and the bot shows merchant · total · category, plus the line count and whether the items add up to the total (`reconciliation`).
5. If the reader finds no total, or cannot read the photo, the bot says so and asks the user to type the amount. With `kie`: KIE unreachable or timed out (120 s) → the same. With `qwen` *(planned)*: the agent service down, busy or timed out → KIE when `KIE_URL` is still set, else "type the amount". A third-party AI is never used.
6. *Planned:* **the switch.** The receipt eval runs Qwen and KIE side by side on the 5 MC-OCR receipts in `server/test/fixtures/receipts/` plus at least 25 real receipts, each with its true payable total. Only when Qwen reads at least as many true totals as KIE, with p95 ≤ 15 s, does the default become `qwen`; then the KIE container is retired.

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
10. **Assistant and agent features (§2.11, planned):** Stage R (rules; needs the agent service but not the LLM) first, then Stage AI with the local model on vLLM, then the receipt switch from KIE to Qwen after its eval (§2.11.7).
11. **Email codes (§2.12, planned):** the mailer and verified sign-up first, then forgot password. Independent of §2.10 and §2.11, so it can ship before them.

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

**Why.** Today the bots and the web only *record* money. The assistant answers questions about the user's own money ("tháng này ăn uống hết bao nhiêu?"), looks ahead (budget pace, bills due), messages first when something needs the user, and does small jobs on request (fix, undo, split a bill, set a budget). The feature ideas, alternatives and reviewer notes are in [09-agent-features.md](09-agent-features.md); its provider and backend parts (Claude, the Tool Runner, cost) are superseded by this section. The graph, skills, tools and embeddings follow the Energy Copilot of `github.com/dangnguyenducanh/environmental-text2sql-`. This section is the part to build.

**The rule everything follows.** The bot never saves or changes money data without the user's confirmation (a tap, `ok`, or a command the user types), and **every number in a reply comes from our code and MongoDB**: the guard rejects any digit that is not in the tool results. **Nothing goes to a third-party model.** A typed amount is still parsed only by the rule parser (§2.5); the local model may read a receipt photo (the user confirms the draft) and may pick a category id from the user's own list.

**Decided** (design change of 2026-11-25: a local model instead of Claude). Each ⚑ is a recommendation: change it here before the build if you want otherwise.
- ⚑ **Model: `Qwen/Qwen3.5-2B`** (Apache-2.0, 2B parameters, vision-language, 262k native context) on **vLLM `0.31.0`** (pinned), served as `qwen3.5-2b`, **non-thinking mode only** (the model card warns that the 2B model loops in thinking mode). One model for questions, receipts and categories.
- ⚑ **Agent backend in Python:** FastAPI `0.162.5` + LangGraph `1.2.24`, with uvicorn `0.54.0`, pymongo `4.18.3`, the openai `3.59.0` client for vLLM's OpenAI-compatible API and sentence-transformers `6.3.0`. It copies the reference repo's graph shape. Not LangGraph.js inside Express: the model and the embedder are Python on the GPU anyway, and the reference repo is Python. Kept as the alternative: LangGraph.js in Express calling vLLM through the tunnel.
- ⚑ **The question engine moves into the agent service.** The skills, routing, typed query and templates of §2.11.3 are Python there, not `server/src/ask/`. Express keeps `classify` (§2.11.1, pure JS, rules unchanged) and forwards a question.
- ⚑ **Express stays the only public API.** It keeps capture (parser, drafts, `ok`/`huy`, buttons), `classify`, the plain commands (`/today`, `/month` …), every write, auth and the cron entry point. It calls the agent service server to server through a Cloudflare tunnel, like KIE today.
- ⚑ **Receipts:** `RECEIPT_READER=kie|qwen`. `kie` until the receipt eval passes, then `qwen`, and the KIE container is retired (§2.6).
- ⚑ **Categorizer:** keyword rules first, as today. Only when they fall back to Khác/Other does the agent service suggest a category: the nearest one by embedding, and the LLM only on a near tie, choosing from the user's own category ids (§2.11.4).
- ⚑ **No AI opt-in and no admin grant.** They existed because data went to a third party; now it never leaves our machines. Kept: the Settings switch "Trợ lý" (on by default), the admin runtime switch, and per-user daily caps that protect the one GPU (§2.11.4).
- ⚑ **Embeddings: `BAAI/bge-m3`** (1024 dimensions, multilingual including Vietnamese), searched in memory in the agent service with hybrid ranking (lexical + vector, RRF), as the reference repo's `find_skills`. Atlas Vector Search is the upgrade path, not used now.
- ⚑ **Writes stay in Express.** The agent service reads the app's collections and writes only its own `agent*` collections, `receiptReads` and `pendingActions`. A write it proposes comes back in its response, and Express performs it through the same services as the web, after the user's confirm.
- ⚑ **Scope:** every call carries `userId` from Express (JWT or ChatLink). The LLM never sees or sets it (§2.11.3, tools).
- ⚑ **Hosting:** the team's GPU host (RTX 5880 Ada 48 GB), one compose project `sochitieu-agent` with `vllm`, `agent` and `tunnel`. vLLM is never exposed (§2.11.4).
- ⚑ **Channels:** web, Telegram, Zalo, and WhatsApp once §2.10 ships, each with its own daily cap, under the Zalo and WhatsApp quota guards of §2.11.6.
- ⚑ **Proactive messages are opt-in**, from one daily cron at about 20:00; Telegram gets them directly, Zalo only on the user's next reply, WhatsApp only within 24 h of the user's last message.
- ⚑ **Chat may change confirmed data only through typed commands or a confirm card** (`/sua`, `hoàn tác`, `/ngansach`, C3 cards). The bot may *prepare* a draft on its own (B3), never save one.
- ⚑ **A week is Monday–Sunday** in every reply, stated in the reply's period line.
- **Removed** with the earlier Claude design: the Anthropic key and SDK, the Tool Runner, the monthly and per-user spending caps, the AI opt-in and the admin grant.
- **Not in this spec:** savings goals (B5), Atlas Vector Search.

**Success looks like:** "tháng 10 thu bao nhiêu" typed anywhere never creates a transaction; the 8 starter questions in §2.11.3 get exact answers with vLLM stopped; the defense can flip the local model on and off without a redeploy and show the same numbers both ways; no request leaves our own machines.

### 2.11.1 Who answers what

The first match wins, in this order inside `handleMessage` (Telegram button presses are handled before all of it, as today):

| # | Incoming | Answered by |
|---|---|---|
| 1 | `/start CODE`, `/link CODE`, unlinked or locked chat | Rules, as today (§2.4, §2.10) |
| 2 | Photo | The receipt reader of §2.6 (KIE, or Qwen in the agent service once `RECEIPT_READER=qwen`) → draft → confirm |
| 3 | `/hoi <question>` | The agent service (§2.11.3), explicit. Built (T41): until that service exists, the help text, and nothing is stored |
| 4 | Any other command (§2.11.6) | Rules / templates (B-tier reports through the agent service's pipeline skills) |
| 5 | Reserved words `ok`, `huy`, `hoàn tác`, `khôi phục` | Rules (drafts, A4 undo) |
| 6 | Everything else | `classify(text, { followUp })` → **question** → the agent service (§2.11.3) (built, T41: until it exists, the help text; `followUp` is false until T50), or **capture** → `createDrafts` as today |

**`classify` is a pure function in `bot/ask.js` (Express), no database, no model.** The first rule that fires decides:
1. Starts with `?` → question.
2. More than one non-empty line → capture.
3. Ends with `?` → question, even with an amount.
4. Last word `chưa`, `không` or `ko`, or `bao nhiêu` anywhere → question.
5. Time phrases, `top N`, `N khoản` and `N ngày` are taken out first (by `period.js`, with the never-amount rules of §2.5), so a year or month after `năm`/`tháng` or a day count is never an amount. Then an explicit amount in the remaining words (a money unit, joined or apart, like `45k`, `45 k`, `1tr2`; thousands separators; 5+ digits) → capture. A bare number of 1–4 digits is not explicit.
5b. A text with a `top N` (`top` is the first word) or an `N khoản`, and no other number left once rule 5 has taken the time phrases and counts out, not even a bare one → question (decision D10, the default of 2026-11-25; the owner may change it): "5 khoản chi lớn nhất tuần trước" and "top 3 cafe" are questions, not 5.000 ₫ and 3.000 ₫ drafts. "top 3 cafe 50" keeps its other number and is a capture.
6. A strong question marker (`bao giờ`, `khi nào`, `thế nào`, `tại sao`, `vì sao`, `tổng kết`, `so với`, `how much`, `why`; `sao` as the first or last word; `mấy` only with diacritics) → question. Weak cues (`top`, `tìm` with its accent, `còn lại`) count only at the start of a message that has no number left after rule 5, not even a bare one, so "tìm phở" is a question while "tim heo 50" and "crop top 120" stay captures.
7. `followUp` (an assistant answer went to this chat in the last 10 minutes; always true in the web drawer) → question (decision D11, the default of 2026-11-25; the owner may change it). While `followUp` is true a bare number is not an amount, so everything that reaches this rule is a question: an explicit amount was already a capture at rule 5, and two or more lines at rule 2. "còn 3 tháng trước" and "phở 45" are questions then; with `followUp` false they are captures (a 3.000 ₫ and a 45.000 ₫ draft, as today), and "phở 45k" is a capture either way.
8. Anything else → capture (a bare number is still guessed as thousands; no amount → help text).

Ties lean to *question*: a capture read as a question saves nothing, while a question read as a capture creates money data. **On the web**, `POST /api/transactions/parse` runs the same `classify` (`followUp: false`) in the route, before the parser and without reading the user's categories or wallets, and returns `{ question: true, drafts: [], noAmountLines: [], truncated: false }`; QuickAdd's Enter then saves nothing. Built (T41): QuickAdd shows the non-clickable notice "Đây là câu hỏi" instead of the preview, and Enter, Save, Shift+Enter and "Open full form" do nothing (§5.10.2); T51 turns the notice into the chip "Đây là câu hỏi · Hỏi Sổ chi tiêu ›" that opens the drawer.

**Agent service down, busy or not built yet:** a question gets the help text plus the plain commands (`/today`, `/month`; since T41 the help text also lists `/hoi`), and the web gets 503 `AGENT_UNAVAILABLE` or `AGENT_BUSY` once there is an agent endpoint to ask. Capture never waits on the agent service.

### 2.11.2 Rule-based features (no LLM)

None of these needs the LLM; they work with vLLM stopped. A1 and the B-tier reports run as **pipeline skills** in the agent service (§2.11.3); the rest live in Express.

| # | Feature | In chat | What it does | Built on |
|---|---|---|---|---|
| A1 | **Ask in plain Vietnamese** | any question, `/hoi` | Exact answer from the user's data, through the skills of §2.11.3. Every reply names the period and filter it used | the agent service |
| A2 | **Budget pace and month-end forecast** | `/dubao` | "Còn 900.000 ₫ cho 6 ngày → tối đa 150.000 ₫/ngày; theo nhịp này cuối tháng ≈ 8.520.000 ₫, vượt khoảng 29/11". Shown from day 5 of the month | new pure `pace({spent, limit, day, daysInMonth})` in `services/budgets.js`; `listBudgets()` adds it to every budget, so `/month`, the confirm warning line and a Budgets page chip show the same number; the agent's `get_budget_pace` tool uses the same formula |
| A3 | **Why did I spend more** | `/visao`, "sao tháng này tiêu nhiều vậy" | The 3 categories that changed most against the same days last month, unusual rows (> 3× the category's 90-day median), and one tip from a fixed numbered rule list (R2 category spike, R3 pace over budget, R5 top category without a budget) with an action button | skill `giai_thich_tang_chi` (tools `compare_periods`, `find_unusual`, `pick_tip`); `compareRange()` in Express for the Dashboard |
| A4 | **Fix or undo from chat** | `/sua <changes>`, `hoàn tác`, `khôi phục` | `/sua` edits the waiting draft, or else the transaction this chat confirmed in the last 15 minutes. `hoàn tác` deletes the last one confirmed (restorable with `khôi phục`). Not "sửa …" without the slash: "sửa xe 150k" is a real expense | `updateTransaction`, `deleteTransaction`, `restoreTransaction`; new `chatLinks.lastConfirmedId` |
| A5 | **Split the bill** | `cơm 1tr2 chia 4`, or `chia 3` alone | Amount = ceil(total ÷ N ÷ 1000) × 1000, note gets "(1.200.000 ₫ ÷ 4)". `chia N` alone divides the waiting draft (receipt drafts too). N from 2 to 50 | one parser rule, applied before `findAmount()` |
| A6 | **Draft check** | (on every draft) | Up to 2 extra lines on the draft: an amount ≥ 5× the category's 90-day median (needs ≥ 5 samples; 3× when the amount was guessed), and the same amount + category drafted in the last 10 minutes | `draftHints()`; the quick-add preview gets the same `hints` |
| A7 | **Learns your words** | tap a category on a fallback draft | When the parser fell back to Khác/Other, the bot offers the top 3 expense categories; the tap moves the draft and adds the note's first word to that category's `keywords` (skipped if another category owns it). On Zalo, type the category name. When the agent service is up, its suggestion (§2.11.4) is offered first, and a tap also stores a hint in `agentMemory` | `$addToSet` on `categories.keywords`; tool `remember` |
| B1 | **Evening digest** (opt-in) | `/nhac toi\|tuan\|tat`, `/tongket` | Today's spending, drafts still waiting (sent again with working buttons), the daily budget limit from A2, and the logging streak. A quiet day sends nothing; a day with nothing logged gets one line | skill `ban_tin_toi`, cron engine below |
| B2 | **Early over-budget warning** | (in the digest) | From day 5, when the projection is ≥ 110 % and usage is still < 80 %. At most one per budget per week | `pace()` / `get_budget_pace` |
| B3 | **Recurring bills → draft on the due day** | `/dinhky` | Groups 180 days of confirmed expenses by the note's first 2 words (≥ 3 times, ≥ 6 days apart); confidence = 0.2 + 0.4·min(n/10, 1) + 0.4·clamp(1 − CV). The day before it is due, at confidence ≥ 0.7 (≥ 0.85 on Zalo), the cron creates a **draft** in one chat only; the user confirms it | `detectRecurring()` in Express; `chatRef.messageId = rec:<date>:<key>` makes a rerun a no-op |
| B4 | **Weekly and monthly report** | `/tuan`, `/thang`, `/chep`, `/dunggoiy` | Sunday evening: `tong_ket_tuan`. Day 1: `tong_ket_thang` plus next month's suggested budgets (median of the last 3 months, rounded up to 50.000 ₫) with [Chép T11] [Dùng gợi ý]. Same skills as chat, so chat and cron say the same thing | skills; `copyBudgets()`, `createBudget()` (skip 409) in Express |

**Same numbers in JS and Python.** `pace()`, `compareRange()`, the period rules and `money()` exist in Express and in the agent service. ⚑ One shared fixture file of cases is run by both vitest and pytest, so the Dashboard, `/month` and the assistant never disagree. `shared/fixtures/compare-range.json` exists (T43: vitest on the server and the client read it; the agent service's pytest reads it when that service is built).

**Cron engine (B tier).** `vercel.json` gets one cron `0 13 * * *` (20:00–20:59 Vietnam time; Hobby runs it once a day, production only, no retry) calling `GET /api/cron/daily` with `Authorization: Bearer ${CRON_SECRET}`, checked with the existing `sameSecret()`. One sequential loop over opted-in users: Express calls the agent service with `trigger: schedule` and the skill (`ban_tin_toi`, `tong_ket_tuan`, `tong_ket_thang`) and sends the reply. A `notices` collection, unique on `(userId, kind, key)`, gets a row *before* each send, so a double fire sends nothing twice. Every Zalo and WhatsApp send adds to `channelUsage {platform, month, sent}` (Zalo built in T49, WhatsApp with T70); proactive Zalo sends stop at 2,000 a month. A user linked on several apps gets proactive messages on Telegram only. Admins get `POST /api/admin/cron/daily` ("Chạy ngay") for the demo, because crons don't fire locally.

### 2.11.3 The question engine (skills, rules first)

The engine lives in the **agent service** (Python, FastAPI + LangGraph), not in Express. Pipeline skills answer by rules; the LLM is used only where the tables below say so. Express's `services/agent.js` sends every question, confirm reply and scheduled report to one endpoint of the agent service, with `Authorization: Bearer ${AGENT_SECRET}`:

`POST /v1/turn { trigger: chat|confirm|schedule|event, userId, channel, threadKey, requestId, text?, actionId?, skill?, language, today }` → `{ route: rules|agent, text, facts[], sources[], action?, followups[], card?, steps[], timingsMs }`

The bots, the web drawer and the QuickAdd chip use the same call. Time budget: 25 s in chat, 40 s on the web. `today` is the Asia/Ho_Chi_Minh date. **Idempotency:** `requestId` is the chatRef `(platform, chatId, messageId)` or the web `requestId`, unique per user in `agentTurns`, so a redelivered webhook or a double click answers once.

**The graph** (one compiled LangGraph `StateGraph`, after the reference repo's `copilot_graph`):

```
ingress → load_context ─┬─ chat ───────→ rewrite_question → recall_memory → find_skills ─┐
                        ├─ schedule / event ──────────────────────────────→ decide ←─────┘
                        ├─ confirm ───→ act                                 decide ⇄ act
                        └─ declined / expired ─→ generate_answer
   … → generate_answer → guard_output → suggest_followups → save_turn
```

| Node | LLM? | What it does |
|---|---|---|
| `ingress` | no | Input guard: length ≤ 500, strips control characters, checks the daily cap and the runtime switch |
| `load_context` | no | User, language, categories, wallets; the last 6 turns of this thread (`agentTurns`, short-term memory); a pending action when the message confirms or declines one |
| `rewrite_question` | rules first, LLM only for a follow-up | Links words to the user's categories and wallets (accent-folded lexicon), resolves dates with `period.py` (same rules as `period.js`: "hôm qua", "tuần trước" Mon–Sun, "tháng 10", "20/11"), and turns a follow-up ("còn tháng trước?") into a standalone question |
| `recall_memory` | no | Embeds the standalone question once; reads the user's long-term memory rows (`agentMemory`) with cosine ≥ 0.6 |
| `find_skills` | no | Hybrid search over the enabled skills; returns the top 3 with scores and `retrieval: direct`, `choose` or `none` |
| `decide` | only for `choose` and agent-mode skills | Picks the skill among the top 3 and fills the tool arguments as **guided JSON** (enums = the user's category and wallet ids, the skill's allowed periods). A pipeline skill needs no LLM |
| `act` | no (LLM only inside `read_receipt`) | Runs the tool calls: preset args over LLM args → pydantic validation → handler with a timeout; at most `max_steps` (4) rounds of decide ⇄ act. A write tool only creates a `pendingActions` proposal |
| `generate_answer` | template, or LLM wording | Templates (vi/en) for cards, no data, failures and every pipeline skill, with a sources line, e.g. "Nguồn: So sánh cùng kỳ 11/2026". The LLM only phrases agent-mode answers, writing `[[factId]]` placeholders that our code fills |
| `guard_output` | no | The guard of §2.11.4. A failure → the template answer |
| `suggest_followups` | no | The skill's `followups` (2–3 chips) |
| `save_turn` | no | One `agentTurns` row with the steps, timings and tool calls |

**Routing = `find_skills` + `decide`.**
- `find_skills` ranks every enabled skill twice: lexically (accent-folded triggers and keywords; a pair of question phrase + linked entity is decisive, e.g. `bao nhiêu` + category → `chi_theo_danh_muc`, `còn bao nhiêu` + wallet → `so_du_vi`) and by vector cosine of the bge-m3 embeddings. The two lists are fused with reciprocal-rank fusion (RRF, k = 60). One clear winner (score gap ≥ 0.15, or an exact trigger) → `direct`; several close → `choose`; nothing → `none`.
- `decide`: `direct` with a pipeline skill runs it without the LLM. `choose` asks the LLM to pick among the top 3. With the LLM off, `choose` asks back with numbered options instead (buttons on Telegram and WhatsApp; reply `1`–`3` within 10 minutes on Zalo; a bare `1`–`3` after that, while the chat's last ask-back expired less than 24 h ago, gets "Câu hỏi đã hết hạn, hãy hỏi lại" and never reaches `createDrafts` or the Zalo amount correction). `none` goes to `hoi_tu_do` when the LLM is on, else the help text with 3 example questions.
- Required slots come from the linking or the skill's default. A linked filter the skill doesn't accept is not dropped silently: the reply adds "Bỏ qua điều kiện: …".

**Skills** (`agentSkills`, seeded from `agent/skills/*.yaml` and synced on start; system skills have `userId: null`). Stage R ships the first 8; the next 3 follow A2/A3; the two agent-mode skills come with Stage AI (§2.11.7).

| Skill | Mode | Triggers | Tools (in order) | Example |
|---|---|---|---|---|
| `thu_chi_ky` | pipeline | chat | `get_period_summary` | "hôm nay tiêu bao nhiêu?", "tháng 10 thu bao nhiêu" |
| `tong_ket_tuan` | pipeline | chat, schedule (Sun) | `get_period_summary`, `get_category_totals`, `get_budget_pace` | "tổng kết tuần trước", `/tuan` |
| `tong_ket_thang` | pipeline | chat, schedule (day 1) | `get_period_summary`, `get_category_totals`, `get_budgets`, `suggest_budgets` | "tổng kết tháng 10", `/thang` |
| `chi_theo_danh_muc` | pipeline | chat | `get_category_totals` | "tháng này ăn uống hết bao nhiêu?" |
| `so_sanh_ky` | pipeline | chat | `compare_periods` | "tháng này so với tháng trước?" |
| `top_khoan_chi` | pipeline | chat | `list_transactions` | "5 khoản chi lớn nhất tuần trước" |
| `so_du_vi` | pipeline | chat | `get_wallet_balances` | "momo còn bao nhiêu?" |
| `ngan_sach_con_lai` | pipeline | chat | `get_budgets`, `get_budget_pace` | "ngân sách ăn uống còn bao nhiêu" |
| `du_bao_cuoi_thang` | pipeline | chat, schedule | `get_budget_pace` | `/dubao`, "cuối tháng tiêu hết bao nhiêu" |
| `giai_thich_tang_chi` | pipeline | chat | `compare_periods`, `find_unusual`, `pick_tip` | `/visao`, "sao tháng này tiêu nhiều vậy" |
| `tim_giao_dich` | pipeline | chat | `search_transactions` | "tìm phở", "đã mua gì ở Circle K tháng này" |
| `hoi_tu_do` | agent | chat | any read tool + `query_transactions`, ≤ 4 steps | a question no pipeline skill fits |
| `de_xuat_thao_tac` | agent | chat | read tools + `propose_action` | "đặt ngân sách ăn uống 3 triệu" |
| `ban_tin_toi` | pipeline | schedule (20:00) | `get_period_summary`, `list_drafts`, `get_budget_pace`, `get_streak` | B1 digest |

**Tools** (`agentTools`, from the handlers in `agent/tools/`). Every tool is read-only unless marked. The arguments the LLM may fill are listed; `FORBIDDEN_ARGS` (`userId`, `token`, `query`) never come from the LLM, and every tool closes over `userId` from the request.

| Tool | Side effect | Arguments (LLM-visible) | Reads |
|---|---|---|---|
| `get_period_summary` | read | `start`, `end` (local days) | `transactions` (confirmed, not deleted) |
| `get_category_totals` | read | `start`, `end`, `type`, `categoryIds?`, `top?` | `transactions`, `categories` |
| `compare_periods` | read | `start`, `end`, `categoryIds?` (previous period: see the number rules below) | `transactions`, `categories` |
| `list_transactions` | read | `start`, `end`, `type?`, `categoryIds?`, `walletIds?`, `order`, `limit ≤ 20` | `transactions`, `categories`, `wallets` |
| `search_transactions` | read | `text`, `start`, `end`, `limit ≤ 20` (accent-folded on `note`, `receipt.merchant`) | `transactions` |
| `query_transactions` | read | the typed query below | `transactions`, `categories`, `wallets` |
| `get_wallet_balances` | read | `walletIds?` | `wallets`, `transactions` |
| `get_budgets` | read | `month`, `categoryIds?` | `budgets`, `transactions`, `categories` |
| `get_budget_pace` | read | `month`, `categoryIds?` | `budgets`, `transactions` |
| `suggest_budgets` | read | `month` (median of the last 3 months, rounded up to 50.000 ₫) | `transactions`, `budgets` |
| `find_unusual` | read | `start`, `end` (> 3× the category's 90-day median) | `transactions` |
| `pick_tip` | read | none (numbered rules R2, R3, R5) | `transactions`, `budgets` |
| `list_drafts` | read | none | `transactions` (status draft) |
| `get_streak` | read | none | `transactions` |
| `propose_action` | **write proposal** | `kind` ∈ `set_budget`, `copy_budgets`, `delete_transaction`; `args` | writes `pendingActions` only |
| `read_receipt` | read | none (the image comes from the request, not the LLM) | none (vLLM) |
| `suggest_category` | read | `note`, `merchant?` | `categories`, `agentCategoryVectors`, `agentMemory` |
| `remember` | write (`agent*`) | `fact` (e.g. "cafe → Ăn uống"), only after a confirmed A7 tap | `agentMemory` |

**Typed query.** `query_transactions` takes a `QueryIR` (pydantic, strict): `kind aggregate|list`, `measure`, `type`, `period {from, to}`, `compareTo`, `filters {categoryIds, walletIds, weekdays, minAmount, maxAmount, text}`, `groupBy`, `order`, `orderBy value|key`, `limit`. Validation checks that every id is the user's own, `from ≤ to ≤ today`, a span ≤ 400 days, `min ≤ max`. Our compiler (never the model) builds the MongoDB aggregation: always `userId` and `status: 'confirmed'`, soft-deleted rows excluded, `maxTimeMS(5000)`, and `$limit` applied after totals and shares are computed. The model never writes raw MongoDB.

**Number rules the build must keep:**
- **Comparisons shift by one calendar unit of the period**, based on the period, not on today: Mon 23–Wed 25/11 → Mon 16–Wed 18/11; 01–25/11 → 01–25/10; 01–31/10 → 01–30/09. `compare_periods` in the agent service and `compareRange({ from, to }, unit?)` in `utils/vnTime` (Express, built in T43) follow this rule and share the fixture `shared/fixtures/compare-range.json` of §2.11.2. Details of the rule:
  - A period is Vietnam calendar days `YYYY-MM-DD`, both ends included. The caller passes the unit (`day`, `week`, `month`, `year`) when it knows it, because dates alone are ambiguous: 01–07/06/2026 is a week and a month to date. Without a unit, the first line that fits decides: one day = day; starts on 1/1 and runs past January = year; starts on the 1st = month; starts on a Monday and spans at most 7 days = week; otherwise the period shifts back by its own length.
  - Month and year move both ends back by that many months, keeping the day of the month and capping it at the shorter month's last day (31/03 → 28/02, or 29/02 in a leap year).
  - Gap fill for dates alone: `compareRange()` sees only dates, so a period from the 1st to a month's last day is taken as a whole month and goes to the whole month before (01–28/02 → 01–31/01, 01–30/04 → 01–31/03), which is what a past month needs (whole against whole). It cannot tell that from "February to date on the 28th", so a caller that knows its range is a month to date builds the previous range itself, as the Dashboard does. The spec's own examples, 01–31/10 → 01–30/09 and the 31/03 and 30/03 cases, are unchanged by this.
  - A date that does not exist, a `from` after `to` and an unknown unit are refused (`RangeError`).
  - **The Dashboard's MonthCompare follows this rule** (`sameDays()` in `client/src/features/dashboard/sameDays.ts`, the browser's side of it). Current month: days 1..N in both months, N = today's day (Vietnam time) capped at the last day of the month before, so both sides have the same number of days: 28/02 meets 01–28/01 (01–29/01 in a leap year), 30/04 meets 01–30/03, 30/11 meets 01–30/10, 31/03 stops at 28/02 on both sides, and 25/11 meets 01–25/10. Past month: the whole month against the whole month before (a past February meets all of January). A month still to come is compared whole as well, the safe default, since the card names only the current and a past month. The big figure and the sentence say "cùng kỳ tháng trước" ("the same days last month" in English); the weekly columns still show both whole months. "Hai tháng này chưa có giao dịch nào" is shown only when both whole months have nothing for the chosen flow; when just the same days add up to 0, the sentence says so with 0 ₫.
- "Biggest month/weekday" questions sort by value (`orderBy: value`), not by date.
- Previous period = 0 → no percentage; the line says there was no spending before.
- Every `agentTurns` read (follow-ups, ask-back replies, Telegram `q:` buttons) filters by `userId` too, and carried slots are validated again.

### 2.11.4 Local model layer (Qwen3.5-2B on vLLM)

The LLM runs only inside the agent service, in these places: `decide` (for `choose` and agent-mode skills), `rewrite_question` (follow-ups only), the wording in `generate_answer` (agent mode only), `read_receipt` and `llm_choose`. It is called only when the **model gate** is open: `ASSISTANT_ENABLED=true` and the admin runtime switch on (`appSettings`, no redeploy); the user's "Trợ lý" switch on; the channel in `ASSISTANT_CHANNELS`; the user under the daily cap; and vLLM healthy. Otherwise pipeline skills and templates answer, exactly as in Stage R. ⚑ The user's switch covers questions only; a receipt photo the user sends follows `RECEIPT_READER`.

**Model and serving.** The full `vllm serve` command and the setup steps are in [06-deployment.md](06-deployment.md).

| Setting | Value |
|---|---|
| Model | `Qwen/Qwen3.5-2B`, revision pinned in `agent/models.lock`, served as `qwen3.5-2b` |
| Server | vLLM `0.31.0` (image `vllm/vllm-openai:v0.31.0`), OpenAI-compatible API on `127.0.0.1:8300/v1` only; the tunnel exposes the agent service, never vLLM |
| GPU memory | `--gpu-memory-utilization 0.25` (≈ 12 GB of the 48 GB card: 2B BF16 weights ≈ 4.5 GB + KV cache), `--max-model-len 16384`; bge-m3 ≈ 2.3 GB more in the agent process |
| Images | `--limit-mm-per-prompt '{"image": 1}'` |
| Concurrency | `--max-num-seqs 8`; the agent service queues at most 16 requests and answers 503 `AGENT_BUSY` beyond that |
| Mode | Non-thinking only. Temperature 0.2 for `decide` and `llm_choose`; 0.7 with top_p 0.8 for `read_receipt` and wording (the model card's settings); `max_tokens` 512 (1024 for receipts) |
| Prompts | One system prompt per node in `agent/prompts/` (vi + en) |

**Guided JSON.** `decide`, `read_receipt` and `llm_choose` use vLLM structured outputs (`response_format: {type: json_schema}`). The schema's enums are the user's own category and wallet ids and the skill's allowed periods, so the model cannot name another user's data or an unknown id. The output is validated again with pydantic; a failure falls back to the template answer, `NO_TOTAL` or Khác.

**The guard (`guard_output`).** The model's own text may contain no digits, no number words (`hai`, `triệu`, `gấp đôi`, `million`…), no verdict words (`vượt`, `tăng`, `giảm`, `over`, `more`…), no ids, JSON, URL, @handle or email, and no claim of a change that did not happen. It writes `[[factId]]`, and our code replaces it with `label: display`, so a figure always carries its own label. Any failure, timeout, 503 or cap → the template answer built from this turn's tool results (or the help text).

**C3, the model proposes, you tap.** `propose_action` (`set_budget`, `copy_budgets`, `delete_transaction`) writes nothing else: it inserts one `pendingActions` row (10 minutes) and the user gets a confirm card: Telegram buttons ✅ Đồng ý / ✖️ Thôi (`ao:<id>` / `an:<id>`), WhatsApp reply buttons, Zalo typed `/dongy` / `/thoi`, web card buttons. Express shows the card only if the user's *own message* has a change verb (`đặt`, `sửa`, `xoá`, `chép`, `set`, `delete`, `copy`); a budget limit must be the one amount the parser's `findAmount()` finds in that message, never a model value; a transaction id must be one this turn's tool calls returned (`agentTurns.toolCalls`). The tap flips the row `pending → done` atomically, Express runs the same service as the web, then calls `/v1/turn` with `trigger: confirm` for the reply.

**Category suggestion (A7).** `POST /v1/categorize { userId, note, merchant?, items? }` → `{ categoryId, score, method: embedding|llm, alternatives[2] }`. It embeds the note and finds the nearest of the user's categories (name + keywords in `agentCategoryVectors`, plus `agentMemory` hints). The LLM (`llm_choose`) runs only when the top 2 scores are within 0.05, and picks from the user's own category ids only (an enum). Express asks only for a Khác/Other fallback draft, sends the draft first and adds the suggestion within 3 s or skips it. It is shown as a suggestion and never moves the draft by itself.

**Caps** (they protect the one GPU, not a budget). Per user per day: 30 questions on the web, 20 on Telegram, 10 on Zalo, 5 on WhatsApp, counted from `agentTurns`; 30 receipt reads, counted from `receiptReads`. "Xoá" in the drawer hides the thread but does not reset the count. Over a cap → one line saying so, plus the plain commands, which still work.

**Privacy rule.** Prompts go to `127.0.0.1` and never to a third party. The model still sees only what it needs: every number, date, period and verdict is a fact `{ id, label, display }`; notes are cut to 60 characters; a run of 8+ digits or an email in free text becomes `•••`; never the user's name, email, phone, chat names, BSUIDs or chat ids. vLLM request logging stays off.

**Embedding space** (`BAAI/bge-m3`, 1024 dimensions, normalised for cosine, loaded with sentence-transformers in the agent process):

| What is embedded | Text | Stored in | Searched by |
|---|---|---|---|
| Skills | `labelVi`, `labelEn`, description, examples, triggers | `agentSkills.embedding` + `embedHash` | `find_skills` |
| Tool descriptions | name + description | `agentTools.embedding` | `decide` (agent mode: offers the 6 closest tools) |
| User categories | name + keywords (vi, accent-folded) | `agentCategoryVectors {userId, categoryId, embedding, embedHash}` | `suggest_category`, `/v1/categorize` |
| Long-term memory | short facts the user confirmed ("cafe → Ăn uống", "ví chính là MoMo") | `agentMemory.embedding` | `recall_memory`, `suggest_category` |

Vectors live in MongoDB documents and are searched in memory (a few dozen skills, a few hundred memory rows and categories per user). A row whose `embedHash` (SHA-256 of its text) changed is re-embedded on the next start or the next read; nothing else is.

### 2.11.5 Web: the "Hỏi Sổ chi tiêu" drawer

- **Where:** a "✨ Hỏi Sổ chi tiêu" button in the Dashboard header beside the month picker (icon only on phones) opens an MUI `Drawer` (420 px from `sm`, full width on phones). The QuickAdd question chip opens it with the text already sent. No new route.
- **Inside:** 4 starter chips when empty; the thread (the last 6 turns go along as context); every answer has a badge "Theo mẫu" (template) or "AI" (worded by the local model; the numbers are ours either way) and a sources line; action cards with Đồng ý / Thôi; "Còn N câu hỏi hôm nay"; a Dừng button while waiting; "Xoá" hides the thread. A capture typed here (`phở 45k`) gets the quick-add preview card.
- **Endpoints** (`routes/assistant.js`, `requireAuth`, zod; Express calls `/v1/turn`): `POST /api/assistant/chat { message 1–500, month?, requestId }` → `{ route, text, sources, action?, capture?, remainingToday }` (the same `requestId` twice → 409 `DUPLICATE`; agent service down → 503 `AGENT_UNAVAILABLE`; queue full → 503 `AGENT_BUSY`); `GET` / `DELETE /api/assistant/thread`; `POST /api/assistant/actions/:id/confirm` and `/cancel` (404 not this user's or expired, 409 already done).
- **Settings:** a "Trợ lý" switch, on by default, with the line "Câu hỏi được trả lời trên máy chủ của Sổ chi tiêu, không gửi cho bên thứ ba.", and the B1 reminder choice. **Admin users page:** the runtime assistant switch next to "Chạy ngay". No per-user grant.
- **Accessibility:** the drawer is labelled by its title; focus goes to the input on open and back to the button on close; the list is `role="log"` and the finished answer is announced once; chips and card buttons have full labels; no spinner animation under `prefers-reduced-motion`; Enter sends, Shift+Enter adds a line.

### 2.11.6 Channels, commands and data

| | Telegram | Zalo | WhatsApp (§2.10) | Web |
|---|---|---|---|---|
| Assistant | on | on | on once §2.10 ships | on |
| Questions per user per day | 20 | 10 | 5 | 30 |
| Reply | one message, ≤ 1,500 chars, "typing" every 4 s | one message, ≤ 1,500 chars, never split | one message, ≤ 1,500 chars; cards as reply buttons | JSON |
| Quota guard | — | *built (T49, below):* proactive off at 2,000 messages a month, assistant answers off at 2,400; from 2,850 only capture and linking replies | assistant answers off at 800; at 950 all replies stop, captures still land in the Bot inbox | — |
| Proactive (B tier) | sent directly | rides on the next reply | only within 24 h of the user's last message | banner on the next visit |

**Zalo send counter and quota guard (built, card T49).** `channelUsage {platform, month, sent}` has one row per platform and month, unique on `(platform, month)`; the month is the Vietnam `YYYY-MM`. Every `sendMessage` Zalo accepts adds 1 (one atomic `$inc` upsert), counted in one place, the Zalo adapter's send function, so replies, drafts, the claim success message and any later send all count, once each. A send Zalo refuses adds nothing, and a counting failure is logged and never loses a message or a draft (the draft is saved first, the message is already gone). Telegram has no quota and is not counted; WhatsApp counting arrives with its card (T70).

One helper, `maySend(platform, kind)` in `services/channelUsage.js`, answers whether a kind of message may go out now:

| Kind | What it is | Off from (Zalo, messages this month) |
|---|---|---|
| `proactive` | a message the bot starts: digest, early warning, reports (no caller yet) | 2,000 |
| `assistant` | every answer to a question, template or model (no caller yet) | 2,400 |
| `other` | commands and help (including the help text for a message with no amount), the locked-account notice, and any send not named here | 2,850 |
| `capture` | the reply to money the user sent: draft messages (text and receipt), the receipt reading and failure messages, the note about lines with no amount, and the results of `ok`, `huy` and an amount correction | never |
| `link` | linking a chat: the please-link prompt with its tap-to-link URL, every reply to `/start CODE` and `/link CODE` (linked, already linked, invalid code), and the claim success message | never |

From 2,850 only `capture` and `link` replies are sent. A command's effect still happens (`/lang` still switches the language); only its reply is not sent. ⚑ **Linking replies stay on past 2,850** (decision D20, the default of 2026-11-25; the owner may change it), so a user can still finish linking; the help replies stop. The core sends every text reply through one function that names its kind (an unnamed send is `other`, so a new send is guarded unless it says otherwise). If the count cannot be read, the message is sent and the failure is logged. The check reads the count and then sends, so two replies at 2,849 can both go out; the 150 messages between 2,850 and Zalo's 3,000 absorb that.

**New commands** (Vietnamese only: the one English alias is `undo`, for `hoàn tác`, built by T59; no other new command has one): `/hoi` (built, T41), `/dubao`, `/visao`, `/sua`, `/ngansach <danh mục> <số tiền>`, `/tuan`, `/thang`, `/dinhky`, `/nhac toi|tuan|tat`, `/tongket`, `/chep`, `/dunggoiy`, `/dongy`, `/thoi`; reserved words `hoàn tác`, `khôi phục`; the parser rule `chia N`. `/help` lists them as they are built: `/hoi` since T41. Every command name, old or new, is read without case and accents (`/Hỏi`, `/HỎI` and `/hoi` are one command, also in the decomposed Unicode form); the arguments keep what was typed.

**Data:**
- New collections written by the agent service:
  - `agentSkills` `{code (unique with userId), userId|null, labelVi, labelEn, description, examples[], mode: pipeline|agent, triggers[], schedule?, tools: [{name, ord, preset}], followups[], maxSteps (4), enabled, version, embedding[1024], embedHash}`.
  - `agentTools` `{name (unique), description, parameters (JSON Schema), sideEffect: read|proposal|write_agent, timeoutMs, collections[], enabled, version, embedding, embedHash}`.
  - `agentTurns` (replaces the earlier `askTurns`) `{userId, channel, threadKey, requestId (unique per user), trigger, question ≤ 500, standalone, skill, retrieval, toolCalls: [{tool, args, ok, ms, error?}], facts[], answer, route, guard: pass|fail, model, promptTokens, completionTokens, steps[], timingsMs[], clearedAt?, createdAt}`. TTL 30 days; admins never see it. The daily caps count from it; "Xoá" sets `clearedAt` and never deletes rows.
  - `agentMemory` `{userId, text, kind: alias|category_hint|preference, source: a7_tap|settings, embedding, embedHash, createdAt, lastUsedAt}`, at most 200 per user (the oldest unused is dropped).
  - `agentCategoryVectors` `{userId, categoryId (unique pair), embedding, embedHash}`.
  - `receiptReads` `{userId, platform, fileRef, reader: qwen|kie, total, merchant, date, itemsCount, reconciliation, confidence, ms, error?, createdAt}`. TTL 90 days, for the eval and debugging; never the image.
- Shared with Express (Express writes them too): `pendingActions` (TTL 10 minutes after expiry), `notices` (unique `(userId, kind, key)`), `channelUsage`, `appSettings` (`{_id: 'global', assistantEnabled}`).
- `users` gains `assistantOn` (default `true`, the "Trợ lý" switch) and `notify` (`off|daily|weekly`, default `off`). `chatLinks` gains `lastConfirmedId`. `note` and `receipt.merchant` are saved NFC-normalized.
- **Access per component.** Express (the app's MongoDB user) can read and write everything but never writes `agent*`. The agent service uses its own MongoDB user `sochitieu_agent` with a custom role: `find` on `usersForAgent`, a MongoDB view on `users` that keeps only `_id`, `language` and `assistantOn` (the role has **no right on `users`**, so the agent cannot read password hashes, sessions, chat links or tokens; agent code reads users only through the view), and `find` on `categories`, `wallets`, `transactions`, `budgets`; `find/insert/update` on `pendingActions`; `find/insert/update/remove` on `agentSkills`, `agentTools`, `agentTurns`, `agentMemory`, `agentCategoryVectors`, `receiptReads`. The role has no index, collection or drop right, and the service creates nothing when it starts: `python -m agent.setup`, run with the app user's connection string, creates the collections, their indexes and the view, and is run again after any change to them (defaults D14 and D15, taken 2026-11-25). Every query a tool runs starts with `{userId}` from the request.
- **Environment variables on Vercel** (all optional; a missing one turns its feature off, as with KIE): `AGENT_URL` (its value comes from `AGENT_PUBLIC_URL`, like `KIE_URL` from `KIE_PUBLIC_URL`; unset → questions get the help text), `AGENT_SECRET` (`openssl rand -hex 32`), `RECEIPT_READER` (`kie` until the receipt eval passes), `ASSISTANT_ENABLED` (the runtime switch's starting value, default `false`), `ASSISTANT_CHANNELS` (default `web,telegram,zalo,whatsapp`), `CRON_SECRET` (unchanged). **On the GPU host** (`agent/.env`, never on Vercel): `AGENT_SECRET`, `MONGODB_URI_AGENT` (the `sochitieu_agent` user), `VLLM_BASE_URL=http://127.0.0.1:8300/v1`, `LLM_MODEL=qwen3.5-2b`, `EMBED_MODEL=BAAI/bge-m3`, `HF_HOME`.
- **Logs** carry only the turn id, node and error class, never the question, notes, figures or tool arguments, in Express and in the agent service.
- `docs/01` (components and flows), `docs/03` (collections and the agent's role), `docs/04` (`services/agent.js`, endpoints, error codes), `docs/05` (drawer, chips, Settings and admin switches), `docs/06` (GPU host, vLLM, tunnel, secrets) and `docs/07` (pytest, evals, cases below) describe this design and are updated again in the PR that builds each part.

### 2.11.7 Build order

**Stage R, rules only.** It needs the agent service (FastAPI + LangGraph, the bge-m3 embedder, the tunnel and the `sochitieu_agent` user) but **not the LLM**: vLLM can stay stopped, because pipeline skills and templates need no model.
1. `classify` + `/hoi` + the router slot in `handleMessage` + `question: true` from `/transactions/parse` and the QuickAdd chip. Express only, no agent service yet (a question gets the help text). Fixes the "question becomes a draft" risk on its own. **Built (T41):** `bot/ask.js`, `bot/period.js`, the router slot, the parse flag and QuickAdd's notice; the chip's button comes with the drawer (T51).
2. A2 `pace()` and `/dubao`.
3. The agent service without vLLM: the compose project with `agent` and `tunnel`, `/health`, `services/agent.js` with its down and busy fallbacks; the graph with the 8 v1 pipeline skills, `agentSkills` and `agentTools` seeded and embedded, `agentTurns`; the drawer in rules-only mode; the `compareRange()` fix in MonthCompare and the shared JS/Python fixture (the Express and browser halves are built, T43; the agent service adds `period.py` and its pytest on the same file).
4. B1 digest on Telegram, with the cron, `notices` and `channelUsage` engine.
5. A5, A6, A3, A4, A7, then B2, B4, B3.

**Stage AI (after Stage R ships; needs vLLM on the GPU host):** a half-day spike on the host (GPU memory, latency, guided JSON); vLLM added to the compose project; the model gate, caps and guard; `decide` for `choose` and `hoi_tu_do` on the **web**, with the skill eval; then Telegram; then C3 cards (`de_xuat_thao_tac`); Zalo and WhatsApp last, under their quota guards. **Receipts:** the receipt eval, then `RECEIPT_READER=qwen` and the KIE container retired (§2.6). **Categories:** the categorizer eval, then the A7 suggestion.

### 2.11.8 Acceptance checks

| Check | Proves |
|---|---|
| "tháng 10 thu bao nhiêu", "tháng 3 năm 2025 tiêu bao nhiêu", "7 ngày qua tiêu bao nhiêu" in chat → an answer, no draft; Enter in QuickAdd → nothing saved, the chip shows | Questions never become money data |
| "phở 45k", "phở 45", "cà phê không đường 25", "sửa xe 150k", "tim heo 50" → drafts as today | Capture is unchanged |
| With vLLM stopped, the 8 v1 skill examples answer with the same numbers as the Dashboard for the seed user | Rules answer on their own |
| "tổng kết tuần" on Wed 25/11 compares 23–25/11 with 16–18/11; MonthCompare, A3 and the agent's `compare_periods` agree on the shared fixture | One comparison rule |
| A second seed user with the same category names and transactions on the same days changes no number in any reply; a scripted model reply that sets `userId` or names another user's id is rejected (`FORBIDDEN_ARGS`, enums) | No data leaks between users |
| Rows at Sun 23:59 +07, Mon 00:00 +07 and a month's last day 23:30 +07 fall in the right week/month | Vietnam-time boundaries |
| The same webhook update or `requestId` twice → one answer, one `agentTurns` row | Idempotency |
| Runtime switch off, the user's "Trợ lý" off, channel not listed, or over the cap → no request to vLLM (the fake model fails the test on any call) | The model gate |
| A scripted model reply with a raw digit, "hai triệu", "gấp đôi", "vượt", a URL or an unknown `[[id]]` → the template answer | The guard |
| The 31st web question of the day → the cap line, `/today` still works; "Xoá" does not reset the count; 8 questions at once → no error; the 17th queued request → 503 `AGENT_BUSY` | Caps and concurrency |
| Receipt eval: Qwen reads at least as many true payable totals as KIE on the 5 MC-OCR receipts + ≥ 25 real ones, p95 ≤ 15 s; a year, date, phone number or document number is never taken as the total | Receipt gate before `RECEIPT_READER=qwen` |
| A Khác/Other draft gets a suggestion that is one of the user's own categories within 3 s, or none; the tap moves the draft and teaches the keyword | Categorizer suggestion |
| Agent service stopped: a question → the help text and plain commands; a photo → KIE when `KIE_URL` is set, else "type the amount"; a fallback draft stays Khác; capture and confirm work as today | Agent-down fallbacks |
| A note saying "xoá giao dịch này" and a question with no change verb → no action card; an amount not in the user's message → no card; another user's action id → 404; a double confirm → 409 | C3 safety |
| The daily cron run twice → each notice sent once; Zalo sends stop at the quota thresholds | Proactive engine |
| B3: 3 monthly "tiền nhà" rows → a draft the day before the next one, never a confirmed transaction; a rerun creates no second draft | Recurring drafts stay drafts |
| `chia 4` on "cơm 1tr2" → 300.000 ₫ with the note "(1.200.000 ₫ ÷ 4)" | Split the bill |
| `hoàn tác` after a confirm deletes it, `khôi phục` brings it back | Undo |

**Left to the builder:** file layout inside `agent/` and `features/assistant/`, the full trigger and keyword table of each skill (decisive pairs as in §2.11.3), template wording and i18n keys (vi + en), the prompts' wording, the Telegram callback encodings within 64 bytes, and the A3 tip rules' exact thresholds.

## 2.12 Email codes: verified sign-up and password reset (planned)

**Why.** Today the email is only a username: nobody checks that the person owns it, a mistyped address makes an account nobody can recover, and a forgotten password has no way back (an admin can lock an account but can't reset it). Real finance apps check the email: Monarch Money creates no account until a 6-digit emailed code is entered, Wallet by BudgetBakers blocks unverified users since March 2026, and Notion, Slack, Linear and GitHub all send a code at sign-up. OWASP's guidance is not to activate an account before it is verified. The design, the product comparison and the delivery-time research are in the "Email authentication brainstorm" session of 2026-11-25.

**Decided.** Each ⚑ is a recommendation: change it here before the build if you want otherwise.
- **Mail goes through Gmail SMTP** with `nodemailer` and a Google app password. Free, about 500 emails a day, no domain needed, and mail signed by Gmail rarely lands in spam. Resend's free plan (100 a day) was ruled out: it only sends to other people from a domain you own and verify with DNS records, and the app lives on `*.vercel.app`. Vercel blocks only port 25, so port 465 to `smtp.gmail.com` works.
- **A code, not a link.** 6 digits, typed or pasted. Work-mail scanners "click" links and use them up; a code also works when the email is read on another device.
- ⚑ **No account until the code is entered** (brainstorm option B). Register saves a *pending sign-up*; the right code creates the user. So no unverified user ever exists, and login, refresh, sessions, `requireAuth` and the three bots need **no change**: the session code with its ten race fixes (BUG-003 to BUG-011) is not touched, and nobody can squat someone else's address by signing up with it first. (Option A, an unverified user plus checks in login, refresh, every route and every bot, is what ezBookkeeping does.)
- ⚑ **"Forgot password?" is in scope**: the same code, then a new password.
- ⚑ **Existing accounts are left as they are**: the admin, test users A and B and everyone already registered keep logging in; nobody is asked to verify.
- The §2.2 non-goal "Email verification and password-reset emails" is removed.

**Success looks like:** a new user gets the code within about 5–15 s (Gmail delivers to Gmail in about 5 s and to Outlook in about 10 s; connecting to Gmail adds 1–3 s), enters it and lands on the Dashboard exactly as after today's register; a typo'd address never becomes an account; a user who forgot the password gets back in without an admin.

### 2.12.1 Codes and limits

| Rule | Value | Why |
|---|---|---|
| Code | 6 random digits (`crypto.randomInt`), single use | What Monarch, Clerk and Notion send |
| Lifetime | 10 minutes | Long enough for slow mail, short enough to guess |
| Storage | Only the SHA-256 of the code, compared in constant time (`timingSafeEqual`) | Same rule as refresh tokens and link codes |
| Wrong tries | 5 per code; the 5th kills the code ("request a new one") | A 6-digit code must not be guessable |
| Resend | Not before 60 s after the last send; at most 5 sends per address per hour. A resend replaces the code | 5 codes × 5 tries = 25 guesses an hour at most, a 1 in 40,000 chance |
| Per IP | 10 code emails per IP per 15 minutes across register, resend and forgot, counting successful requests too (a `mailRateLimit` beside `authRateLimit`; in-memory per instance like it) | Too many mails to fake or mistyped addresses make Google stop the Gmail account sending for up to 24 h, and then nobody can sign up |

**The email:** from `"Sổ chi tiêu" <GMAIL_USER>`, in the user's language (vi/en), plain text plus simple HTML. Subject "Mã xác nhận Sổ chi tiêu: 123456" / "Your Sổ chi tiêu code: 123456". The body says what the code is for (sign-up or password reset), that it is valid for 10 minutes, and "If you didn't ask for this, ignore this email". No links, no images, no tracking.

### 2.12.2 Sign-up with a code (`/register` → `/verify-email`)

```
/register  →  POST /api/auth/register  →  /verify-email

  Kiểm tra email của bạn / Check your email
  We sent a 6-digit code to a***@gmail.com
  [ ______ ]   [Confirm]
  Didn't get it? Check spam/junk · Resend (in 60 s) · Wrong email? Change it
```

1. The Register form is unchanged. `POST /api/auth/register` checks the body as today; an email that already has an account → 409 `EMAIL_TAKEN` as today, no mail.
2. Otherwise it upserts the `emailCodes` row for `(purpose: 'signup', email)` with the name, language and **bcrypt hash** of the password (never the password), a new code, and sends the mail. The send is awaited: if Gmail refuses, the row is deleted and the answer is 503 `EMAIL_SEND_FAILED` ("We couldn't send the email. Try again in a few minutes."). Success → **202** `{ email: "a***@gmail.com", resendAfter: 60 }`; no cookie, no token.
3. Registering again with the same address while a code is live replaces the name, password and code, and counts as a send (60 s, 5 an hour).
4. The client keeps the email in `sessionStorage` (never the password) and goes to `/verify-email`. One input with `inputmode="numeric"`, `autocomplete="one-time-code"` and `maxLength=6` (not six boxes, so paste and screen readers work); it submits on the 6th digit or Confirm.
5. `POST /api/auth/register/verify { email, code }`: one atomic `$inc` of `attempts` on a live row with `attempts < 5`, then the hash comparison. Wrong → 400 `CODE_INVALID` with `details.attemptsLeft`. No live row, or out of tries → 400 `CODE_EXPIRED` ("This code has expired. Send a new one."). Right → the row is deleted (`findOneAndDelete` on its id *and* code hash, so only one request wins), the user is created with the stored hash, `onUserRegistered()` seeds the wallet and categories, and the answer is today's register answer: **201** `{ accessToken, user }` + the `rt` cookie. If the address was registered meanwhile, the unique index gives 409 `EMAIL_TAKEN`.
6. **Resend** calls `POST /api/auth/register/resend { email }` → 202 `{ resendAfter: 60 }`, the same answer whether or not a sign-up is pending (no list of pending addresses leaks); too early or over 5 an hour → 429 `RATE_LIMITED` with `details.retryAfter` (seconds) and the button counts down.
7. **Wrong email? Change it** goes back to `/register` with name and email filled in; the old row expires on its own.

### 2.12.3 Forgot password (`/login` → `/forgot-password`)

1. Login shows "Quên mật khẩu? / Forgot password?" under the password field.
2. Step 1, email: `POST /api/auth/password/forgot { email }` → always **202** `{ resendAfter: 60 }`, whether or not the account exists, so the page can't be used to find out who has an account. Only for an existing, **active** user does it upsert the `(purpose: 'reset', email)` row and send the code. The send runs in `waitUntil()` from `@vercel/functions` (already a dependency), so "has an account" and "has none" answer equally fast. The same 60 s / 5 per hour / per-IP limits apply.
3. Step 2, the same screen: code, new password and confirm (same rules as Register: ≥ 8 characters, ≤ 72 bytes). `POST /api/auth/password/reset { email, code, newPassword }` checks the code exactly as in §2.12.2 step 5, then sets the new hash and calls `revokeAllSessions(userId)`, so every device, including a thief's, is logged out. → **204**; the client goes to `/login` with "Mật khẩu đã được đổi, hãy đăng nhập lại / Password changed, please log in". No auto-login.
4. A user locked by an admin gets no code; if they were locked after the code was sent, reset answers 403 `ACCOUNT_LOCKED` and the code is spent.
5. Settings → change password stays as today (current password, other sessions revoked).

### 2.12.4 When mail isn't configured

`GMAIL_USER` and `GMAIL_APP_PASSWORD` are optional in `config/env.js` (built, T35), like the bot and KIE variables; both must be set for mail to be on. Neither has a `NODE_ENV=test` default, and the Vitest setup file deletes both before every test, so a real value can never turn mail on in a test.
- **Development and test** without them: the API boots, and the code is written to the server log (`[mail] signup code for a***@gmail.com: 123456`) instead of sent, so the whole flow works locally without Gmail. Unit tests replace `services/mail.js` and read the code from the mock; the Playwright server (`e2e-server.js`) uses a test-only mail stub, like `bot-api-stub.js`, which never loads in production. The mailer has one test seam, `setMailSender()`, that replaces delivery in every mode; nothing in `server/src` calls it.
- **Production** without them: register works as today (201, logged in, no code), so a missing secret never stops sign-ups; the Register page therefore handles both answers (201 → Dashboard, 202 → `/verify-email`). `forgot` answers 503 `FEATURE_NOT_CONFIGURED` ("Password reset by email isn't set up; ask the admin").
- **The escape hatch:** if Google stops the Gmail account sending (bounces or the 500-a-day limit), switch mail off: delete both variables in the Vercel dashboard of each project, or run `tools/set-secret.sh --remove GMAIL_USER GMAIL_APP_PASSWORD` (built, T35: it asks for nothing, deletes the lines from `server/.env` if they are there, and removes the variables from both projects), then redeploy. Sign-up then works without codes until the account recovers.

### 2.12.5 Data, settings and setup

- New collection **`emailCodes`**: `purpose` (`signup` | `reset`), `email` (lower-cased), `codeHash`, `codeExpiresAt` (now + 10 min), `attempts` (0–5), `sends` (dates of the last sends, at most 5, for the 60 s and hourly limits), `signup` sub-document (`name`, `language`, `passwordHash`; only for `purpose: 'signup'`), `expiresAt` (last send + 1 hour, TTL index so MongoDB deletes it). Unique index `(purpose, email)`. Admins never see it.
- `users` is unchanged: with option B every account made after this ships has a verified email by construction.
- New endpoints (all public, `zod` bodies, the `mailRateLimit` from §2.12.1): `POST /api/auth/register` (now 202), `POST /api/auth/register/verify`, `POST /api/auth/register/resend`, `POST /api/auth/password/forgot`, `POST /api/auth/password/reset`. New error codes: `CODE_INVALID` (400), `CODE_EXPIRED` (400), `EMAIL_SEND_FAILED` (503).
- New dependency: `nodemailer` 10.6.1 (server only), one module `services/mail.js` with `sendCode({ to, purpose, code, language })`. **Built (T35); nothing calls it yet**, so the app behaves as before.
- New environment variables: `GMAIL_USER` (the sending address) and `GMAIL_APP_PASSWORD` (a 16-character app password: Google account → Security → 2-Step Verification on → App passwords). **Set only in the Vercel dashboard of both projects, never in `server/.env`** (decision D8): worktrees get a copy of that file, so a value there would send real mail from every agent worktree. They stay empty locally, which is the log-only mode of §2.12.4. Never committed. Changing the Google password revokes the app password, so it must be made again.
- **Logs** never contain the code or the password in production; the email is masked (`a***@gmail.com`).
- `docs/03` (`emailCodes`), `docs/04` (endpoints, error codes, the register status change, configuration), `docs/05` (the two screens, the Login link, i18n namespace), `docs/06` (making the app password) and `docs/07` (cases below) are updated in the PR that builds each part.

### 2.12.6 Acceptance checks

| Check | Proves |
|---|---|
| Register → 202 and one mail with a 6-digit code; no user exists yet; the right code → 201, logged in, the Cash wallet and default categories exist | Verified sign-up works end to end |
| Register with a taken email → 409, no mail; a user created meanwhile → verify answers 409 | Existing accounts are safe |
| 5 wrong codes → `CODE_INVALID` with `attemptsLeft` 4…0, then even the right code → `CODE_EXPIRED`; a code after 10 minutes → `CODE_EXPIRED` | Codes can't be guessed or reused late |
| The same right code sent twice at once → one 201, one `CODE_EXPIRED`; exactly one user | Single use under a race |
| Resend within 60 s → 429 with `retryAfter`; the 6th send in an hour → 429; after a resend the old code fails | Resend limits, replaced codes |
| The 11th code email from one IP in 15 minutes → 429 | Gmail account protected from abuse |
| `forgot` for an unknown, a locked and an active email → the same 202 body, and only the active one gets a mail | No account enumeration |
| Reset with the right code → 204; the old password fails; every session of that user is revoked; a code for `signup` doesn't work for `reset` and the other way round | Password reset |
| The database holds no code and no password in plain text; production logs show no code | Storage and logging rules |
| No `GMAIL_*` in development → the code appears in the server log and the flow completes; in production → register logs straight in and `forgot` → 503 | Works without mail, escape hatch |
| Login, refresh, the bots and the existing test users behave exactly as before | Option B touches nothing else |

**Left to the builder:** file layout (`services/emailCodes.js` or inside `services/auth.js`), i18n keys and the exact wording (vi + en), the HTML of the email, how the code box shows its countdown, and the `nodemailer` version pinned at build time.
