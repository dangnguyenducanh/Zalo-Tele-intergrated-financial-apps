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
| F2 | **Wallets**: cash, bank, e-wallet; opening balance; computed current balance; archive | C R U D | Wallets |
| F3 | **Categories**: expense/income, icon, colour, **bot keywords**; seeded from defaults on register | C R U D | Categories |
| F4 | **Transactions**: add/edit/delete; filter by date range, type, wallet, category, status, text; pagination | C R U D | Transactions |
| F5 | **Monthly budgets**: limit per category (or overall) per month; progress bars; over-budget warnings (web + bot) | C R U D | Budgets, Dashboard |
| F6 | **Statistics**: month summary (income, expense, net), spending by category (pie), daily trend (bar), budget usage | R | Dashboard |
| F7 | **Bot linking**: one-time code / Telegram deep link; list and unlink chat accounts | C R D | Bot inbox |
| F8 | **Bot capture (Telegram + Zalo)**: text → draft → confirm; receipt photo → KIE → draft → confirm; `/today`, `/month` | C U D (drafts) | (chat) + Bot inbox |
| F9 | **Bot inbox (web)**: review drafts from any source; edit, confirm or discard; see receipt line items | R U D | Bot inbox |
| F10 | **Receipt upload (web)**: upload a photo on the web; KIE → draft | C | Bot inbox |
| F11 | **Admin**: users (lock/unlock, role), default categories, system stats | C R U D | Admin users, Admin categories |
| F12 | **Preferences**: language vi/en, theme light/dark/system; saved per user and in localStorage | U | Settings, app bar |
| F13 | **Web quick add**: a text box on the Dashboard and Transactions pages. You type `phở 45k` (same syntax as the bot), see a live preview (amount, category, wallet, date), and press Enter to save. The full form is one click away | C | Dashboard, Transactions |

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
| `/register` | Register | Name, email, password (+confirm), language |
| `/` | Dashboard | **Quick-add box** at the top; month picker; cards (income, expense, net, budget left); pie by category; daily bar chart; latest 5 transactions; pending drafts badge |
| `/transactions` | Transactions | **Quick-add box**, filter bar, paginated table (cards on mobile), add/edit dialog, delete with undo snackbar |
| `/wallets` | Wallets | Wallet cards with balance; add/edit/archive/delete |
| `/categories` | Categories | Tabs expense/income; list with icon/colour/keywords; add/edit/delete |
| `/budgets` | Budgets | Month picker; per-category limit with progress bar; add/edit/delete; copy last month |
| `/bot` | Bot inbox | Link Telegram/Zalo (code, deep link, QR), linked accounts, drafts list (source icon, receipt items), upload receipt |
| `/settings` | Settings | Profile, password, language, theme, sessions (current + others, revoke) |
| `/admin/users` | Admin · Users | Search, role/status chips, lock/unlock, change role |
| `/admin/categories` | Admin · Default categories | Template list (vi/en names, keywords), add/edit/delete |
| `*` | 404 | Link home |

## 2.4 Bot behaviour (Telegram and Zalo)

The same **bot core** serves both platforms. Only sending/receiving and confirm UI differ.

| | Telegram | Zalo |
|---|---|---|
| Link account | Deep link `https://t.me/<bot>?start=<CODE>` (one tap) or `/link CODE` | Send `/link CODE` |
| Confirm a draft | Inline buttons **✅ Lưu / ❌ Huỷ** (callback query) | Reply **`ok`** to save or **`huy`** to discard (Zalo Bot API has no buttons) |
| Edit a draft | Button **✏️ Sửa** opens the web Bot inbox | Reply with a corrected line (e.g. `55k`) or edit on the web |
| Receive photo | `message.photo` → `getFile` → download | `message.photo_url` → download |
| Message limit | 4096 chars | 2000 chars |

**Commands:** `/start` (welcome or link), `/link CODE`, `/help`, `/today` (today's spending), `/month` (month total and budget usage), `/lang vi|en`.

**Unlinked chats** get: "Please link your account: open <app>/bot and send `/link CODE`" (in both languages).

**Budget alert:** after a confirmed expense, if that category's budget for the month passes 80 % or 100 %, the bot adds a warning line and the dashboard shows it.

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

If no amount is found, the bot replies with help text and examples.

**Type:** **income** if the line starts with `+`, or contains an income keyword (`lương`, `thưởng`, `nhận`, `salary`, `bonus`, `received`) or a keyword of an income category. Otherwise it's an **expense**.

**Category:** the longest keyword match across the user's categories of that type (e.g. `grab` → Đi lại, `phở` → Ăn uống). Otherwise the **Khác / Other** category.

**Wallet:** matches a wallet alias (`mm`/`momo` → MoMo, `tm` → Tiền mặt, `ck`/`bank` → bank); otherwise the user's default wallet.

**Date:** `hôm qua`, `hqua`, `yesterday` → yesterday; `dd/mm` or `dd/mm/yyyy` → that date; otherwise now. All dates use the **Asia/Ho_Chi_Minh** time zone.

**Note:** the original line with the amount, wallet and date tokens removed.

Examples:

| Message | Draft |
|---|---|
| `phở 45k` | expense · 45,000 · Ăn uống · default wallet · now · "phở" |
| `grab 32k hôm qua mm` | expense · 32,000 · Đi lại · MoMo · yesterday · "grab" |
| `+lương 15tr` | income · 15,000,000 · Lương · default wallet · now · "lương" |
| `coffee 30k` | expense · 30,000 · Ăn uống (English keyword) · now · "coffee" |

## 2.6 Receipt photos (KIE)

1. A photo arrives (Telegram, Zalo or web upload). The bot replies "Đang đọc hoá đơn… / Reading receipt…".
2. The API sends the image to the KIE service `POST /analyze` (JPEG/PNG, ≤ 10 MB; about 20 s, one image at a time).
3. Mapping: `fields.total` → amount (digits only); `fields.merchant` → note; `fields.date` → date (`dd/mm/yyyy`, else now); `line_items` → `receipt.items`; the category is guessed by matching keywords on the merchant and item names, else Khác/Other.
4. A draft is created and the bot shows merchant · total · category, plus the line count and whether the items add up to the total (`reconciliation`).
5. If KIE is unreachable, times out (120 s) or finds no total, the bot says so and asks the user to type the amount. There is no AI fallback.

## 2.7 Languages and themes

- **UI languages:** Vietnamese (default) and English. All UI strings live in `client/src/i18n/{vi,en}.json`. Numbers and dates are formatted with `Intl` (`vi-VN` / `en-US`, currency VND).
- **API errors** return a stable `code` (e.g. `WALLET_NOT_FOUND`) that the frontend translates; `message` is English for logs.
- **Bot replies** use the user's `language` (changeable with `/lang` or in Settings).
- **Default categories** have names in both languages; user-created categories have one name.
- **Themes:** light, dark, or system. A toggle in the app bar stores the choice in localStorage (instant) and in the user profile (follows the user across devices). Charts use theme colours.
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
