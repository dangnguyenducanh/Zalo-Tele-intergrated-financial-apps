# 2. Features

## 2.1 Roles and permissions

| Action | Guest | User | Admin |
|---|:-:|:-:|:-:|
| Register, log in | ✅ | — | — |
| Manage own wallets, categories, transactions, budgets | — | ✅ | ✅ (own data only) |
| Link Telegram/Zalo, use the bots | — | ✅ | ✅ |
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
| F7 | **Bot linking**: one-time code / Telegram deep link; list and unlink chat accounts | C R D | Bot inbox |
| F8 | **Bot capture (Telegram + Zalo)**: text → draft → confirm; receipt photo → KIE → draft → confirm; `/today`, `/month` | C U D (drafts) | (chat) + Bot inbox |
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

## 2.3 Screens (11 routes; the slides require at least 6)

| Route | Screen | Main content |
|---|---|---|
| `/login` | Login | Email + password, language and theme switch |
| `/register` | Register | Name, email, password (+confirm; at least 8 characters, at most 72 bytes); the language picked in the corner switch becomes the profile language |
| `/` | Dashboard | **Quick-add box** at the top; month picker; "Drafts waiting" banner linking to Bot inbox; "Budgets to watch" banner (category budgets past 80 % / 100 %); total-balance card beside four figure cards (income, expense, net, budget left); this month vs last month in weekly columns with a Chi tiêu / Thu nhập switch; ranked category list; latest 5 transactions; one error banner with Retry for every query whose numbers the page shows |
| `/transactions` | Transactions | **Quick-add box**, filter bar, paginated table (cards on mobile), add/edit dialog, delete with undo snackbar |
| `/wallets` | Wallets | Wallet cards with balance; add/edit/archive/delete |
| `/categories` | Categories | Tabs expense/income; list with icon/colour/keywords; add/edit/delete |
| `/budgets` | Budgets | Month picker; overall and per-category limits with progress bar; add/edit/delete; copy last month |
| `/bot` | Bot inbox | Link Telegram/Zalo (code, deep link, QR), linked accounts, drafts list (source icon, receipt items), upload receipt |
| `/settings` | Settings | Profile, password, language, theme, sessions (current + others, revoke) |
| `/admin/users` | Admin · Users | System stats (F11), search, role/status chips, lock/unlock, change role |
| `/admin/categories` | Admin · Default categories | Template list (vi/en names, keywords), add/edit/delete |
| `*` | 404 | Link home |

## 2.4 Bot behaviour (Telegram and Zalo)

The same **bot core** serves both platforms. Only sending/receiving and confirm UI differ.

| | Telegram | Zalo |
|---|---|---|
| Link account | Deep link `https://t.me/<bot>?start=<CODE>` (one tap) or `/link CODE` | Send `/link CODE` |
| Confirm a draft | Inline buttons **✅ Lưu / ❌ Huỷ** (callback query) | Reply **`ok`** to save or **`huy`** to discard (Zalo Bot API has no buttons). After a message with several lines, each `ok`/`huy` acts on the newest draft still waiting, and the reply names the next one |
| Edit a draft | Button **✏️ Sửa** opens the web Bot inbox | Reply with just the right amount (e.g. `55k`): it replaces the waiting draft's amount and keeps its note and category. Anything else is edited on the web |
| Receive photo | `message.photo` → `getFile` → download | `message.photo_url` → download |
| Message limit | 4096 chars | 2000 chars |

**Commands:** `/start` (welcome or link), `/link CODE`, `/help`, `/today` (today's spending), `/month` (month total, the overall budget and each category budget with its usage, fullest first), `/lang vi|en`.

**Unlinked chats** get: "Please link your account: open `<app>/bot` and send `/link CODE`" (in both languages).

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
3. Mapping: the amount is the **total payable**, picked by our server from the text KIE read (`full_text`/`lines`); KIE's own `fields.total` is only one candidate, because it also takes subtotals, invoice numbers, years and account codes (BUG-034…037). In order:
   1. the amount in words ("Bằng chữ: Hai triệu năm trăm nghìn đồng"), when it matches a number printed on the receipt;
   2. subtotal + VAT − discounts, when that sum is printed: the subtotal is the value next to "Tổng/Cộng tiền hàng" or "Tạm tính", VAT the value on a "GTGT"/"VAT" line, discounts the negative amounts;
   3. the value of a grand-total label: an amount-due label first ("Khách cần/phải trả", "(Tiền cần) thanh toán", "Tổng (cộng) tiền thanh toán", "Tổng thanh toán"), else "Tổng cộng", "Tổng tiền", "Thanh toán", "Số tiền"; of several values, the one that is another less the discounts, else the largest. A label that says the VAT is included ("Tổng cộng (đã bao gồm VAT)") is a grand-total label, not a VAT line. Never "Tổng tiền hàng", "Chiết khấu", "Tích lũy", "Giá đăng ký", the cash handed over ("Khách đưa", "Khách thanh toán", "Số tiền nhận") or "Trả lại/Tiền thối";
   4. the same sum as in 2 with no label next to its value (a sideways photo read as columns), if the receipt has a subtotal label and exactly one total fits;
   5. KIE's total, if it is not just one item's price or a subtotal: KIE's items add up to it and it is printed (also without separators, "116000"), or it is printed as money on a grand-total line or a line with only numbers;
   6. else, if item lines are readable (a torn receipt): their sum less the discounts among them, **marked as an estimate** (`receipt.estimated`). An item line is a name with a price, or a name line followed by its "1 × 45.900 45.900" line. The bot reply and the inbox card say so and ask the user to check it.

   Money is only a number printed with thousands separators and no leading zero ("92.400", "92,400.00"), so invoice/voucher numbers (`004829`, `PT-09/2023`), dates, years, phone and tax numbers are never amounts; nor is any number on a line that starts with a phone, tax, account or document label ("ĐT: +84 912.345.678", "Mã GD: 2.611.240"). Labels match even when OCR drops accented vowels ("Tng cng tin").
   `fields.merchant` → note; `fields.date` → date (`dd/mm/yyyy`, else now); `line_items` → `receipt.items` (for an estimate: the item lines that were summed). A "Phiếu thu" is an expense draft too (other document types are a later feature). The category is guessed by matching keywords as whole words on the merchant and item names, else Khác/Other; receipt words that only look like a keyword once accents are dropped (phím, phố, bé, sạch; without accents "ban phim", "rau sach") don't count.
4. A draft is created and the bot shows merchant · total · category, plus the line count and whether the items add up to the total; for an estimate, that the amount is the sum of N item lines and should be checked.
5. If KIE is unreachable, times out (120 s) or nothing usable is printed (no total, no item line), the bot says so and asks the user to type the amount. There is no AI fallback.

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
