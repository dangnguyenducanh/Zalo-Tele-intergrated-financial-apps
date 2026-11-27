# Feature map

Where each user-facing feature of the app lives in the code, how a user reaches it, and the exact selectors and bot commands to drive it. Read it before reproducing a bug, writing or running end-to-end tests, or probing the UI; update it in the same PR when a route, accessible name, shortcut or bot command changes. How to read, generate and update it: skill `feature-map`.

Generated from `main` at `718e838` by reading the code and i18n files (not yet checked in a running app, so entries say `unverified`).

**Selector convention:** there is no `data-testid` in this repo. Reach elements by **role + accessible name** (names in vi / en with the i18n key), then `[name=…]` for inputs, then the route. MUI adds ` *` to required field labels, so match those with a regex or `[name=…]`. Layout switches at MUI breakpoints: the side navigation is shown from `md` up, the bottom navigation and the `Thêm` / `More` sheet below it; set the viewport before selecting. Staging has no bots: their webhook points at production.

## Quick reference

| ID | Route or command | Main selector | Entry file |
|---|---|---|---|
| app-shell | all logged-in routes (layout of `/`, `/transactions`, `/wallets`, `/categories`, `/budgets`, `/bot`, `/settings`, `/admin/*`) | `main#main`; `nav[aria-label="Điều hướng chính"]`; button `Tài khoản` / `Account` | `client/src/components/AppLayout.tsx` |
| login-page | `/login` | heading level 1 `Đăng nhập` / `Log in`; button `Đăng nhập` / `Log in` | `client/src/features/auth/LoginPage.tsx` |
| register-page | `/register` | heading level 1 `Tạo tài khoản` / `Create an account`; button `Đăng ký` / `Register` | `client/src/features/auth/RegisterPage.tsx` |
| link-page | `/link` (token is passed as `?t=…`) | heading level 1 (focused); button `Xác nhận` / `Confirm` | `client/src/features/link/LinkPage.tsx` |
| not-found-page | `*` (any unknown path) | heading level 1 `Không tìm thấy trang` / `Page not found`; link `Về trang chủ` / `Go to the home page` | `client/src/features/notFound/NotFoundPage.tsx` |
| dashboard-page | `/` (index route; nav link `Tổng quan` / `Dashboard`) | role `heading` level 1 `Xin chào, {name}` / `Hello, {name}` (common:home.title) | `client/src/features/dashboard/DashboardPage.tsx` |
| dashboard-page (month picker) | `/` (shared `MonthPicker`) | role `button` `Tháng trước` / `Previous month` (common:month.previous), `Tháng sau` / `Next month` (common:month.next) | `client/src/components/MonthPicker.tsx` |
| dashboard-page (balance and summary cards) | `/` | region `Tổng số dư` / `Total balance` (dashboard:wallet.title); articles `Thu nhập` / `Income`, `Chi tiêu` / `Expenses`, `Chênh lệch (thu − chi)` / `Net (income − expenses)`, `Ngân sách còn lại` / `Budget left` | `client/src/features/dashboard/DashboardPage.tsx` |
| dashboard-month-compare | `/` | figure `Chi tiêu tháng này` / `Spending this month` (dashboard:compare.expense); switch group `Xem` / `Show` (dashboard:compare.switch) | `client/src/features/dashboard/Charts.tsx` |
| dashboard-category-breakdown | `/` | figure `Chi tiêu theo danh mục` / `Spending by category` (dashboard:byCategory.title) | `client/src/features/dashboard/Charts.tsx` |
| dashboard-latest-transactions | `/` | region `Giao dịch gần đây` / `Recent transactions` (dashboard:latest.title); link `Xem tất cả` / `See all` | `client/src/features/dashboard/DashboardPage.tsx` |
| dashboard-page (drafts banner, budget warnings, load error) | `/` | role `status` (drafts banner, budget warning); role `alert` + button `Thử lại` / `Retry` (dashboard:retry) | `client/src/features/dashboard/DashboardPage.tsx` |
| transactions-page | `/transactions` (nav link `Giao dịch` / `Transactions`) | role `heading` level 1 `Giao dịch` / `Transactions` (transactions:title) | `client/src/features/transactions/TransactionsPage.tsx` |
| transactions-filters | `/transactions?q=&from=&to=&type=&walletId=&categoryId=&status=&page=` | role `search` `Bộ lọc giao dịch` / `Transaction filters` (transactions:filters.label) | `client/src/features/transactions/TransactionFilters.tsx` |
| transactions-list | `/transactions` | role `region` (table, `sm` and up) or role `list` (phone), name `Danh sách giao dịch` / `Transaction list` (transactions:listLabel) | `client/src/features/transactions/TransactionList.tsx` |
| transaction-dialog | `/transactions` (Add / Edit buttons) and QuickAdd (full form / chip) | role `dialog` named `Thêm giao dịch` / `Add transaction`, `Sửa giao dịch` / `Edit transaction`, `Sửa dòng thêm nhanh` / `Edit quick-add line` | `client/src/features/transactions/TransactionDialog.tsx` |
| transaction-delete-undo | `/transactions` | button `Xoá giao dịch {name}` / `Delete transaction {name}`; Snackbar button `Hoàn tác` / `Undo` (transactions:undo) | `client/src/features/transactions/TransactionsPage.tsx` |
| quick-add | `/` and `/transactions` | textbox `Thêm nhanh` / `Quick add` (transactions:quickAdd.label) | `client/src/components/QuickAdd.tsx` |
| wallets-page | `/wallets` | heading level 1 `Ví` / `Wallets` (wallets:title); button `Thêm ví` / `Add wallet` (wallets:add) | `client/src/features/wallets/WalletsPage.tsx` |
| wallet-dialog | `/wallets` (dialog) | dialog titled `Thêm ví` / `Add wallet` or `Sửa ví` / `Edit wallet` (wallets:dialog.*); textbox `Tên ví` / `Wallet name` | `client/src/features/wallets/WalletDialog.tsx` |
| categories-page | `/categories` | heading level 1 `Danh mục` / `Categories` (categories:title); tablist `Loại danh mục` / `Category type` | `client/src/features/categories/CategoriesPage.tsx` |
| category-dialog | `/categories` (dialog) | dialog titled `Thêm danh mục chi` / `Add expense category` (categories:dialog.addTitle.expense); textbox `Tên danh mục` / `Category name` | `client/src/features/categories/CategoryDialog.tsx` |
| budgets-page | `/budgets` | heading level 1 `Ngân sách` / `Budgets` (budgets:title); button `Thêm ngân sách` / `Add budget` (budgets:add) | `client/src/features/budgets/BudgetsPage.tsx` |
| budget-dialog | `/budgets` (dialog) | dialog titled `Thêm ngân sách` / `Add budget` or `Sửa ngân sách` / `Edit budget` (budgets:dialog.*); textbox `Hạn mức (₫)` / `Limit (₫)` | `client/src/features/budgets/BudgetDialog.tsx` |
| bot-inbox | `/bot` | heading level 1 `Hộp thư bot` / `Bot inbox` (bot:title) | `client/src/features/bot/BotInboxPage.tsx` |
| bot-receipt-upload | `/bot` | button `Chọn ảnh hoá đơn` / `Choose receipt photo` (bot:upload.button) | `client/src/features/bot/ReceiptUpload.tsx` |
| bot-drafts | `/bot` | region `Bản nháp chờ duyệt` / `Drafts to review` (bot:drafts.title); per card button `Xác nhận` / `Confirm` | `client/src/features/bot/DraftList.tsx`, `DraftCard.tsx` |
| bot-link-card | `/bot` | button `Tạo mã liên kết` / `Create link code` (bot:link.generate) | `client/src/features/bot/LinkCard.tsx` |
| bot-linked-accounts | `/bot` | region `Tài khoản đã liên kết` / `Linked accounts` (bot:accounts.title) | `client/src/features/bot/LinkedAccounts.tsx` |
| settings-page | `/settings` | heading level 1 `Cài đặt` / `Settings` (settings:title) | `client/src/features/settings/SettingsPage.tsx` |
| settings-profile | `/settings` | form `Hồ sơ` / `Profile`; textbox `Họ tên` / `Name` | `client/src/features/settings/ProfileForm.tsx` |
| settings-preferences | `/settings` | form `Tuỳ chọn` / `Preferences`; radiogroup `Ngôn ngữ` / `Language` | `client/src/features/settings/PreferencesForm.tsx` |
| settings-password | `/settings` | form `Đổi mật khẩu` / `Change password`; `getByLabelText(/Mật khẩu hiện tại/)` | `client/src/features/settings/PasswordForm.tsx` |
| settings-sessions | `/settings` | region `Thiết bị đang đăng nhập` / `Logged-in devices` | `client/src/features/settings/SessionsList.tsx` |
| admin-users | `/admin/users` | heading level 1 `Quản trị người dùng` / `Manage users` (admin:users.title) | `client/src/features/admin/AdminUsersPage.tsx` |
| admin-categories | `/admin/categories` | heading level 1 `Danh mục mặc định` / `Default categories` (admin:categories.title) | `client/src/features/admin/AdminCategoriesPage.tsx` |
| admin-template-dialog | `/admin/categories` (dialog) | dialog `Sửa danh mục mặc định` / `Edit default category` | `client/src/features/admin/TemplateDialog.tsx` |
| bot-telegram | Telegram bot, webhook `POST /api/webhooks/telegram`; commands `/start CODE`, `/link CODE`, `/today`, `/month`, `/lang vi\|en`, `/help` | header `X-Telegram-Bot-Api-Secret-Token`; callback data `c:<id>` / `x:<id>` | `server/src/bot/telegram.js` |
| bot-zalo | Zalo bot, webhook `POST /api/webhooks/zalo`; same commands plus typed `ok` / `huy` / bare amount | header `X-Bot-Api-Secret-Token`; events `message.text.received`, `message.image.received` | `server/src/bot/zalo.js` |
| bot-whatsapp | WhatsApp bot, webhooks `GET` + `POST /api/webhooks/whatsapp`; same commands | `hub.verify_token`; header `X-Hub-Signature-256`; button ids `c:<id>` / `x:<id>` / `e:<id>` | `server/src/bot/whatsapp.js` |
| bot-capture | any text line with an amount, e.g. `phở 45k`, `+lương 15tr`; `ok` / `huy` | draft reply `messages.draft` ("📝 ..."), `buttons.save/discard/edit` | `server/src/bot/core.js` (`handleMessage`, `createDrafts`), `server/src/bot/parser.js` |
| bot-reports | `/today`, `/month`, `/lang vi\|en`, `/help` (and any unknown `/cmd`) | reply keys `today`, `month`, `languageSet`, `help` | `server/src/bot/core.js` (`runCommand`) |
| bot-linking | `/start CODE`, `/link CODE`, claim link `<APP_URL>/link?t=<token>`; API `/api/chat-links/*` | reply keys `linked`, `invalidCode`, `alreadyLinked`, `pleaseLink`, `tapToLink` | `server/src/services/chatLinks.js`, `server/src/routes/chatLinks.js` |
| bot-receipt-photos | photo sent in chat; web `POST /api/receipts` | reply keys `readingReceipt`, `receiptItems`, `receiptUnreadable`, `receiptUnavailable` | `server/src/services/receipts.js`, `server/src/bot/core.js` (`readReceipt`) |
| webhooks-api | `POST /api/webhooks/telegram`, `POST /api/webhooks/zalo`, `GET\|POST /api/webhooks/whatsapp` | secret header or HMAC, see section | `server/src/routes/webhooks.js` |

## App shell (router, layout, navigation, theme, language, logout)
- **ID:** `app-shell`
- **Source Entry Points:**
  - UI: `client/src/router.tsx`, `client/src/App.tsx`, `client/src/components/AppLayout.tsx`, `client/src/components/navItems.tsx`, `client/src/components/NavList.tsx`, `client/src/components/NavDrawer.tsx`, `client/src/components/BottomNav.tsx`, `client/src/components/UserMenu.tsx`, `client/src/components/ThemeToggle.tsx`, `client/src/components/LanguageSwitch.tsx`, `client/src/components/BrandMark.tsx`, `client/src/components/AppSnackbar.tsx`, `client/src/components/ConfirmDialog.tsx`, `client/src/components/Splash.tsx`, `client/src/components/RouteError.tsx`, `client/src/components/EmptyState.tsx`
  - Route guards / state: `client/src/auth/ProtectedRoute.tsx`, `client/src/auth/AdminRoute.tsx`, `client/src/auth/AuthContext.tsx`, `client/src/auth/session.ts`, `client/src/auth/usersApi.ts`
  - API: `server/src/routes/auth.js` (`POST /api/auth/logout`, `POST /api/auth/refresh`, `GET /api/auth/me`), `server/src/routes/users.js` (`PATCH /api/users/me`, used by the theme and language switches when logged in)
  - Bot: none
- **Sub-features:**
  - `Route table`: `router.tsx` has public `/login`, `/register`, `/link`. Under `ProtectedRoute` and `AppLayout` it has `/`, `/transactions`, `/wallets`, `/categories`, `/budgets`, `/bot`, `/settings`. Under `AdminRoute` it has `/admin/users` and `/admin/categories`. `*` is the not-found page. `Splash` is the hydrate fallback and `RouteError` is the error element.
  - `ProtectedRoute`: a logged-out visitor is sent to `/login` with `state.from` = path + search + hash.
  - `AdminRoute`: a non-admin sees a 403 EmptyState with heading `Không có quyền truy cập` / `Access denied` and body `Trang này chỉ dành cho quản trị viên.` / `This page is for administrators only.` (common:forbidden.title, common:forbidden.body).
  - `Session restore`: `App.tsx` shows `Splash` while auth status is `loading`.
  - `Skip link`: link `Bỏ qua tới nội dung chính` / `Skip to main content` (common:skipToContent), `href="#main"`. It is only visible when focused.
  - `App bar`: `Brand` is shown only below `md`. On the right are `LanguageSwitch`, `ThemeToggle` and `UserMenu`.
  - `Side drawer (desktop ≥ md)`: `NavDrawer` has `Brand`, the `nav` list and the user's name and email at the foot.
  - `Bottom nav (phone < md)`: four tabs (Dashboard, Transactions, Bot inbox, Budgets) plus a `More` button that opens a bottom-sheet dialog with the other pages.
  - `Nav items` (path, common key, vi / en): `/` nav.dashboard "Tổng quan" / "Dashboard"; `/transactions` nav.transactions "Giao dịch" / "Transactions"; `/bot` nav.bot "Hộp thư bot" / "Bot inbox"; `/budgets` nav.budgets "Ngân sách" / "Budgets"; `/wallets` nav.wallets "Ví" / "Wallets"; `/categories` nav.categories "Danh mục" / "Categories"; `/settings` nav.settings "Cài đặt" / "Settings"; admin only: `/admin/users` nav.adminUsers "Quản trị người dùng" / "Manage users"; admin only: `/admin/categories` nav.adminCategories "Danh mục mặc định" / "Default categories".
  - `Theme toggle`: one icon button that switches to the opposite of the current scheme. Picking the OS scheme stores `system`. When logged in it calls `PATCH /users/me {theme}`. On failure it shows a warning snackbar (common:preferenceNotSaved).
  - `Language switch`: toggles vi and en. When logged in it calls `PATCH /users/me {language}`. On failure it shows the same warning snackbar.
  - `Account menu`: shows the user's name and email, a `Settings` item that goes to `/settings`, and `Log out`.
  - `Logout`: calls `POST /api/auth/logout` (local logout happens even if the call fails), then navigates to a plain `/login` with replace.
  - `Snackbar`: `AppSnackbar` is mounted in `AppLayout` and in the link page frame. It auto-hides after 6 s.
  - `ConfirmDialog` (shared, opened by feature pages): role `dialog` labelled by its title.
  - `QuickAdd`: not in the shell. `client/src/components/QuickAdd.tsx` is mounted by `DashboardPage.tsx` and `TransactionsPage.tsx`. It is owned by the dashboard and transactions scanners.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → the app opens at `/` (or at `state.from`) with the shell visible.
  2. Desktop: click link `Giao dịch` / `Transactions` inside `nav[aria-label="Điều hướng chính"]` (role `link`). The current page link has `aria-current="page"`.
  3. Phone: click link `Giao dịch` in the bottom `nav`. For wallets, categories, settings or admin: click button `Thêm` / `More` → in the dialog `Các mục khác` / `More pages`, click the link.
  4. Switch theme: click button `Chuyển sang giao diện tối` / `Switch to dark theme` (the name flips to `Chuyển sang giao diện sáng` / `Switch to light theme`).
  5. Switch language: click button `EN – Đổi ngôn ngữ sang English` (when the UI is in vi).
  6. Log out: click button `Tài khoản` / `Account` → click menuitem `Đăng xuất` / `Log out` → lands on `/login`.
- **Shortcuts:** none in the shell. The only shortcut is the skip link, reached by Tab from the top. (`QuickAdd` has its own `onKeyDown`, in the dashboard and transactions scope.) **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: any protected path. An unauthenticated visit redirects to `/login`.
  - Container: `main#main` (also `[id="main"]`, role `main`). Header is role `banner` (`AppBar component="header"`).
  - Skip link: role `link`, name `Bỏ qua tới nội dung chính` / `Skip to main content` (common:skipToContent).
  - Navigation (desktop and the phone bottom bar): role `navigation`, name `Điều hướng chính` / `Main navigation` (common:nav.label). Links are by the nav names above. Current page: `[aria-current="page"]`.
  - Phone More button: role `button`, name `Thêm` / `More` (common:nav.more), `aria-haspopup="dialog"`.
  - More dialog: role `dialog`, name `Các mục khác` / `More pages` (common:nav.moreTitle, `h2#more-title`). It contains a `nav` with the same aria-label and a close button `Đóng` / `Close` (common:close).
  - Theme toggle: role `button`, name `Chuyển sang giao diện tối` / `Switch to dark theme` (common:theme.toDark) or `Chuyển sang giao diện sáng` / `Switch to light theme` (common:theme.toLight).
  - Language switch: role `button`, name `EN – Đổi ngôn ngữ sang English` in vi, `VI – Change language to Tiếng Việt` in en (`${LANG} – ` + common:language.switch).
  - Account button: role `button`, name `Tài khoản` / `Account` (common:account.menu), `aria-haspopup="menu"`, `aria-controls="account-menu"` once open.
  - Account menu: `#account-menu`, role `menu`. Items: role `menuitem` `Cài đặt` / `Settings` (common:account.settings) and role `menuitem` `Đăng xuất` / `Log out` (common:account.logout).
  - Brand: text `Sổ chi tiêu` (common:appName). It is not a heading.
  - Splash and route loading: role `progressbar`, name `Đang tải…` / `Loading…` (common:loading).
  - Route error screen (`RouteError`): heading level 1 `Đã có lỗi xảy ra. Vui lòng thử lại.` / `Something went wrong. Please try again.` (errors:GENERIC) and button `Tải lại trang` / `Reload the page` (common:reload).
  - Snackbar: role `alert` (MUI Alert). Its close button is MUI's default name `Close`, not translated.
  - ConfirmDialog: role `dialog` named by its title; buttons `Huỷ` / `Cancel` (common:cancel, autofocused) and `Đồng ý` / `OK` (common:confirm, unless `confirmLabel` is passed).
- **Verification / Triage Notes:** the layout switches at the MUI `md` breakpoint. The bottom nav only exists below `md` and the side drawer only at or above it, so set the viewport before selecting. Admin nav items need a user with `role === 'admin'`. Preference changes (theme, language) call `PATCH /api/users/me` only when logged in. A failed save shows the warning snackbar but the UI still changes. After logout the URL is a plain `/login` with no `from`. Nothing was run; this was read from code only (unverified).

## Login page
- **ID:** `login-page`
- **Source Entry Points:**
  - UI: `client/src/features/auth/LoginPage.tsx`, `client/src/features/auth/AuthLayout.tsx`, `client/src/features/auth/PasswordField.tsx`, `client/src/features/auth/useAuthForm.ts`, `client/src/features/auth/validation.ts`, `client/src/features/auth/routes.tsx`
  - API / state: `client/src/auth/AuthContext.tsx` (`login`), `client/src/auth/session.ts` (`AuthError`, `getRefreshFailure`), `server/src/routes/auth.js` (`POST /api/auth/login`, rate-limited by `authRateLimit`)
  - Bot: none
- **Sub-features:**
  - `Login form`: email and password fields, validated in the browser first (`validateLogin`). On a client error focus moves to the first bad field. On submit it calls `POST /api/auth/login`.
  - `Redirect`: an already logged-in user is redirected to `location.state.from` or `/`.
  - `Error alert`: shows the server error code translated via `errors:*` (for example `INVALID_CREDENTIALS`, `RATE_LIMITED`). It also shows the reason the session ended: `ACCOUNT_LOCKED` from a failed refresh.
  - `Show/hide password` button.
  - `Language and theme switches` in the page header (the same `LanguageSwitch` and `ThemeToggle`).
  - `Showcase`: a decorative `aside` (hidden below `md`, `aria-hidden` mockup). Its text is auth:showcase.* (title, body and three bullet points).
  - `Link to register`.
- **User Navigation Path:**
  1. Open `/login` → wait for heading level 1 `Đăng nhập` / `Log in`.
  2. Fill textbox `Email`, fill the password field `Mật khẩu` / `Password`.
  3. Click button `Đăng nhập` / `Log in` → redirect to `/` or `state.from`.
  4. To register instead, click link `Đăng ký` / `Register` → `/register`.
- **Shortcuts:** none (the form submits on Enter; the email field is autofocused). **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/login`
  - Container: `main#main`; heading level 1 `Đăng nhập` / `Log in` (auth:login.title); document title `Đăng nhập · Sổ chi tiêu`.
  - Primary action: role `button`, name `Đăng nhập` / `Log in` (auth:login.submit), `type=submit`.
  - Inputs: role `textbox`, name `Email *` (auth:fields.email, `[name="email"]`, `type=email`, autofocus). Password: `[name="password"]`, label `Mật khẩu` / `Password` (auth:fields.password), exposed as `getByLabel`. A password input has no `textbox` role. MUI adds ` *` to the name of required fields and generates the input `id`, so prefer `[name=…]`.
  - Show/hide password: role `button`, name `Hiện mật khẩu` / `Show password` (auth:password.show), then `Ẩn mật khẩu` / `Hide password` (auth:password.hide).
  - Link to register: role `link`, name `Đăng ký` / `Register` (auth:login.toRegister), `href="/register"`. Preceding text `Chưa có tài khoản?` / `No account yet?`.
  - Header switches: button `EN – Đổi ngôn ngữ sang English`, button `Chuyển sang giao diện tối` (same as the shell).
  - State indicators: role `alert` for a server error (text from `errors:*`). Field errors are in `helperText` (`validation.required` "Vui lòng nhập thông tin này" / "Please fill in this field"; `validation.email` "Email không hợp lệ" / "Enter a valid email address"). The submit button shows MUI `loading` while busy.
- **Verification / Triage Notes:** the form uses `noValidate`, so every error comes from `validateLogin`, not the browser. The server rate-limits login (`RATE_LIMITED`). A locked user (`ACCOUNT_LOCKED`) cannot get a session, and the alert can come from a failed refresh, not only from submit. The refresh cookie `rt` is httpOnly, path `/api/auth`. The tests are in `client/src/features/auth/AuthPages.test.tsx`. Nothing was run (unverified).

## Register page
- **ID:** `register-page`
- **Source Entry Points:**
  - UI: `client/src/features/auth/RegisterPage.tsx`, `client/src/features/auth/AuthLayout.tsx`, `client/src/features/auth/PasswordField.tsx`, `client/src/features/auth/useAuthForm.ts`, `client/src/features/auth/validation.ts`, `client/src/features/auth/routes.tsx`
  - API / state: `client/src/auth/AuthContext.tsx` (`register`), `server/src/routes/auth.js` (`POST /api/auth/register`, rate-limited by `authRateLimit`)
  - Bot: none
- **Sub-features:**
  - `Register form`: fields name, email, password and confirm. `validateRegister` rules: name 1–60 characters, valid email, password ≥ 8 characters and ≤ 72 bytes, confirm must equal password. Submit sends `{name, email, password, language}`. The language is the UI language picked in the corner.
  - `Server errors`: shown in an alert (for example `EMAIL_TAKEN`) and `fieldErrorsFromApi` marks the field named in the API `details`.
  - `Redirect`: an already logged-in user goes to `/`.
  - `Link to login`.
  - `Language and theme switches`, and the same showcase panel as the login page.
- **User Navigation Path:**
  1. Open `/register` (or click link `Đăng ký` on `/login`) → wait for heading level 1 `Tạo tài khoản` / `Create an account`.
  2. Fill `Họ tên` / `Full name`, `Email`, `Mật khẩu` / `Password`, `Nhập lại mật khẩu` / `Repeat password`.
  3. Click button `Đăng ký` / `Register` → logged in and redirected to `/`.
  4. To go back, click link `Đăng nhập` / `Log in` → `/login`.
- **Shortcuts:** none (Enter submits; the name field is autofocused). **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/register`
  - Container: `main#main`; heading level 1 `Tạo tài khoản` / `Create an account` (auth:register.title).
  - Primary action: role `button`, name `Đăng ký` / `Register` (auth:register.submit), `type=submit`.
  - Inputs: `[name="name"]` label `Họ tên` / `Full name` (auth:fields.name, textbox `Họ tên *`); `[name="email"]` label `Email` (auth:fields.email, `type=email`); `[name="password"]` label `Mật khẩu` / `Password` (auth:fields.password); `[name="confirm"]` label `Nhập lại mật khẩu` / `Repeat password` (auth:fields.confirm). Both password inputs have a show/hide button.
  - Password hint under the password field: `Từ 8 ký tự, tối đa 72 ký tự không dấu (chữ có dấu tính 2–3 ký tự)` / `At least 8 characters, at most 72 plain letters (an accented letter counts as 2–3)` (auth:fields.passwordHint).
  - Show/hide password: role `button`, name `Hiện mật khẩu` / `Show password`, then `Ẩn mật khẩu` / `Hide password` (auth:password.show, auth:password.hide). There are two such buttons on this page.
  - Link to login: role `link`, name `Đăng nhập` / `Log in` (auth:register.toLogin), `href="/login"`. Preceding text `Đã có tài khoản?` / `Already have an account?`.
  - State indicators: role `alert` for a server error. Field error texts are auth:validation.*: `nameLength` "Họ tên từ 1 đến 60 ký tự" / "Name must be 1 to 60 characters"; `passwordLength` "Mật khẩu cần ít nhất 8 ký tự" / "Password must be at least 8 characters"; `passwordTooLong`; `confirmMismatch` "Hai mật khẩu không khớp" / "The passwords do not match". The error for an already used email is `errors:EMAIL_TAKEN`: "Email này đã được dùng cho một tài khoản khác." / "This email is already used by another account."
- **Verification / Triage Notes:** the new profile language equals the UI language at submit time. There are two password inputs with the same label base, so use `[name="password"]` and `[name="confirm"]` rather than label alone (the show/hide buttons have identical names, so scope them to the field). There is no password-reset or change page in the sign-in area; `PATCH /api/users/me/password` exists on the server and belongs to settings. Nothing was run (unverified).

## Link chat page
- **ID:** `link-page`
- **Source Entry Points:**
  - UI: `client/src/features/link/LinkPage.tsx`, `client/src/features/link/routes.tsx`, `client/src/auth/claimToken.ts`
  - API / state: `client/src/features/link/linkApi.ts` (`usePreviewClaimQuery`, `useClaimChatMutation`, `useDismissClaimNoticeMutation`), `server/src/routes/chatLinks.js` (`POST /api/chat-links/claim/preview`, `POST /api/chat-links/claim`, `PATCH /api/chat-links/:id/claim-notice`)
  - Bot: the "tap to link" message is sent by the bot (`server/src/bot/core.js`, not read here); `sendLinked` replies in the chat after a successful claim.
- **Sub-features:**
  - `Token intake`: `takeClaimTokenFromAddressBar()` runs when `routes.tsx` is imported. It moves `?t=…` into sessionStorage and rewrites the URL to `/link`. `LinkPage` does the same if `?t=` is reached by in-app navigation.
  - `Logged-out visitor`: redirected to `/login` with `state.from = '/link'`, and after login returns to `/link`. This page is outside `ProtectedRoute` on purpose.
  - `Preview and confirm`: shows which chat is linked to which account (`name (email)`), a warning, and the buttons Confirm and Cancel. The claim token is sent in the POST body.
  - `Confirm`: calls `POST /chat-links/claim`, shows a success snackbar `Đã liên kết ✓ {{name}}` / `Linked ✓ {{name}}` (bot:link.linked), then goes to `/bot` with replace.
  - `Cancel`: forgets the token and goes to `/bot`. It is disabled while the claim is in flight.
  - `Dead ends`: `LINK_TOKEN_INVALID` or a missing token shows the `expired` screen. `CHAT_ALREADY_LINKED` shows the `alreadyLinked` screen. Both have a link to the inbox.
  - `Failed preview`: shows the API error message and a Retry button (`refetch()`).
  - `Frame`: its own page without the app navigation, with `Brand`, `LanguageSwitch`, `ThemeToggle` and `AppSnackbar`.
  - `Claim notice dismiss`: `dismissClaimNotice` and the i18n keys `link:notice.*` are used by the bot inbox, not by this page.
- **User Navigation Path:**
  1. Open `/link?t=<token>` (the address is rewritten to `/link`). If logged out, sign in on `/login` and you come back to `/link`.
  2. Wait for the heading level 1 (focused) `Liên kết <chat> với <name> (<email>)?` / `Link <chat> to <name> (<email>)?`.
  3. Click button `Xác nhận` / `Confirm` → snackbar `Đã liên kết ✓ …` and redirect to `/bot`.
  4. Or click button `Huỷ` / `Cancel` → `/bot`.
- **Shortcuts:** none (the heading takes focus on each state). **Bot commands:** none on this page. The link comes from the chat's "tap to link" message.
- **Programmatic Selectors:**
  - Route: `/link` (entered as `/link?t=<token>`)
  - Container: `main#main`; state heading is level 1 and focusable (`tabIndex=-1`); document title `Liên kết chat · Sổ chi tiêu` / `Link a chat · Sổ chi tiêu` (link:title).
  - Primary action: role `button`, name `Xác nhận` / `Confirm` (link:confirm), `aria-describedby` the warning. Secondary: role `button`, name `Huỷ` / `Cancel` (common:cancel).
  - Question heading text: `Liên kết <chat/> với <account/>?` / `Link <chat/> to <account/>?` (link:question). The chat and account names are `<strong>` elements.
  - Warning: MUI Alert with `role="none"` (not an alert). Text link:warning: `Chỉ bấm Xác nhận nếu chính bạn vừa nhắn tin cho bot. …` / `Only confirm if you just messaged the bot yourself. …`.
  - Loading: role `progressbar`, name `Đang kiểm tra đường link…` / `Checking the link…` (link:loading).
  - Failed preview: heading is the API error text, button `Thử lại` / `Retry` (link:retry).
  - Dead ends: heading `Đường link đã hết hạn hoặc đã được dùng. Gửi một tin nhắn bất kỳ cho bot để nhận link mới.` / `This link has expired or was already used. Send any message to the bot to get a new one.` (link:expired), or `Cuộc chat này đã được liên kết với một tài khoản.` / `This chat is already linked to an account.` (link:alreadyLinked). Both with role `link`, name `Đến Hộp thư bot` / `Go to Bot inbox` (link:toInbox), `href="/bot"`.
  - Claim error: role `alert` (text from `apiErrorMessage`).
  - Header switches: same as the shell (`LanguageSwitch`, `ThemeToggle`).
- **Verification / Triage Notes:** needs a valid live claim token from the bot (a real chat message, or a token seeded in the server), otherwise the page shows the `expired` screen. Opening `/link` with no token also shows `expired` (the token is read from sessionStorage). The token must never appear in the URL after load, which is a check worth asserting. The preview is not cached (`keepUnusedDataFor: 0`). Tests exist in `client/src/features/link/LinkPage.test.tsx`. Nothing was run (unverified).

## Not-found page
- **ID:** `not-found-page`
- **Source Entry Points:**
  - UI: `client/src/features/notFound/NotFoundPage.tsx`, `client/src/features/notFound/routes.tsx`, `client/src/components/EmptyState.tsx`
  - API / state: none
  - Bot: none
- **Sub-features:**
  - `Catch-all route` (`*`): any unmatched path renders an `EmptyState` with a heading, a description and a link home. It sits outside `AppLayout`, so there is no navigation or app bar.
  - `Back link`: a button-styled link to `/`.
- **User Navigation Path:**
  1. Open any unknown path, for example `/does-not-exist` → wait for heading level 1 `Không tìm thấy trang` / `Page not found`.
  2. Click link `Về trang chủ` / `Go to the home page` → `/` (which sends a logged-out user on to `/login`).
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `*` (for example `/does-not-exist`)
  - Container: `main#main`; heading level 1 `Không tìm thấy trang` / `Page not found` (notFound:title); document title `Không tìm thấy trang · Sổ chi tiêu`.
  - Primary action: role `link`, name `Về trang chủ` / `Go to the home page` (notFound:home), `href="/"` (rendered with `Button component={Link}`, so it is a link, not a button).
  - Description text: `Đường dẫn này không tồn tại hoặc đã bị đổi.` / `This link does not exist or has moved.` (notFound:body).
  - State indicators: none.
- **Verification / Triage Notes:** works logged in or logged out (it is a public route). Unknown paths under `/admin/` for a non-admin hit the 403 screen of `AdminRoute` rather than this page. Unverified (not run).

## Dashboard page
- **ID:** `dashboard-page`
- **Source Entry Points:**
  - UI: `client/src/features/dashboard/DashboardPage.tsx` (the route is in `client/src/features/dashboard/routes.tsx`, an index route, lazy-loaded). Also `client/src/features/dashboard/Charts.tsx`, `client/src/features/dashboard/weekly.ts`, `client/src/features/dashboard/sameDays.ts`, `client/src/features/dashboard/sliceColors.ts`, `client/src/components/MoneyText.tsx`, `client/src/components/MonthPicker.tsx`, `client/src/components/QuickAdd.tsx`.
  - API / state: `client/src/features/dashboard/statsApi.ts` calls `GET /api/stats/summary?month=YYYY-MM`, `GET /api/stats/by-category?month=&type=expense` and `GET /api/stats/daily?month=`. Server: `server/src/routes/stats.js`, `server/src/services/stats.js` (`monthSummary`, `byCategory`, `daily`).
  - The page also reads `useGetBudgetsQuery(month)`, `useGetWalletsQuery({includeArchived:true})`, `useGetCategoriesQuery()` and `useGetTransactionsQuery({status:'confirmed'})` and `({status:'draft'})`.
  - Bot: none.
- **Sub-features:**
  - `Greeting + month picker`: h1 `Xin chào, {name}` / `Hello, {name}` (common:home.title) and the shared `MonthPicker`. The month lives in the redux `ui.month`, so it is shared with Budgets.
  - `Quick add`: the `QuickAdd` box is mounted here (see the `quick-add` section).
  - `Drafts banner`: `Alert` with role `status`, shown only when there are draft transactions (dashboard:drafts, `Có {n} giao dịch nháp đang chờ xác nhận.` / `{n} draft transaction(s) are waiting for confirmation.`). It holds a link-styled button `Xem các bản nháp` / `Review drafts` (dashboard:openInbox) that goes to `/bot`.
  - `Load-error alert`: if any dashboard query fails, `Alert` (error) `Không tải được số liệu của tháng.` / `Could not load this month's numbers.` (dashboard:loadError). Its button `Thử lại` / `Retry` (dashboard:retry) refetches every query.
  - `Budget warnings`: `Alert` with role `status`, titled `Ngân sách cần chú ý` / `Budgets to watch` (dashboard:budgetAlert.title). It lists category budgets past 80 % or 100 %. The button `Xem ngân sách` / `See budgets` (dashboard:budgetAlert.open) goes to `/budgets`. Rows read `{category}: {level} · {detail}` using the budgets namespace. It renders nothing when no category budget is flagged.
  - `Loading spinner`: role `progressbar` named `Đang tải…` / `Loading…` (common:loading). It shows while the summary is first loading.
  - `Balance card`: `<section>` labelled by `Tổng số dư` / `Total balance` (dashboard:wallet.title). It shows `{n} ví` / `Wallets: {n}` (dashboard:wallet.count), the sum of the non-archived wallets, the wallet names joined by ` · `, and `Tháng này +{income} thu` / `This month +{income} in` and `−{expense} chi` / `{expense} out`. It renders only when the summary and the wallets have both loaded.
  - `Summary cards`: four `<article>`s (role `article`), each named by its label. They are `Thu nhập` / `Income` (cards.income), `Chi tiêu` / `Expenses` (cards.expense), `Chênh lệch (thu − chi)` / `Net (income − expenses)` (cards.net) and `Ngân sách còn lại` / `Budget left` (cards.budgetLeft). The money is shown through `MoneyText`.
  - `Budget-left card`: with an overall budget it shows a determinate progress bar that is `aria-hidden` and the text `Hạn mức {limit}` / `Limit {limit}` (cards.budgetOf), plus `Đã vượt ngân sách · ` / `Over budget · ` (cards.budgetOver) when over. Without one it shows `Chưa đặt ngân sách tổng` / `No overall budget set` (cards.noBudget) and the link `Đặt hạn mức` / `Set a limit` (cards.setBudget) to `/budgets`.
  - `Month compare (weekly columns)`: see the `dashboard-month-compare` section.
  - `Category breakdown`: see the `dashboard-category-breakdown` section.
  - `Latest transactions`: see the `dashboard-latest-transactions` section.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → the app lands on `/` (the route is `index`). Wait for the page heading `Xin chào, {name}` / `Hello, {name}` (role `heading` level 1).
  2. From elsewhere, click link `Tổng quan` / `Dashboard` (common:nav.dashboard, role `link`, href `/`) in the main navigation (`Điều hướng chính` / `Main navigation`).
- **Shortcuts:** none (no key handler in this feature). **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/`
  - Container: role `main` (`#main`), heading level 1 `Xin chào, {name}` / `Hello, {name}`. The document title is `Tổng quan · Sổ chi tiêu` / `Dashboard · {common:appName}`.
  - Month picker: role `button` `Tháng trước` / `Previous month` (common:month.previous), role `button` `Tháng sau` / `Next month` (common:month.next), and the label is an `<output aria-live="polite">`, for example `tháng 11 năm 2026`.
  - Primary actions: the drafts banner button `Xem các bản nháp` / `Review drafts`; `Xem ngân sách` / `See budgets`; `Đặt hạn mức` / `Set a limit` (role `link`); `Thử lại` / `Retry` (role `button`).
  - Cards: role `article` named `Thu nhập` / `Income`, `Chi tiêu` / `Expenses`, `Chênh lệch (thu − chi)` / `Net (income − expenses)`, `Ngân sách còn lại` / `Budget left`. Balance card: role `region` named `Tổng số dư` / `Total balance`.
  - State indicators: role `progressbar` `Đang tải…` / `Loading…`, role `alert` (load error), role `status` (drafts banner, budget warnings).
- **Verification / Triage Notes:** needs a seeded user with at least one wallet. Seed a draft transaction to see the banner, an overall budget for the budget-left card, and a category budget past 80 % for the warnings. The balance card and the summary cards only render after `summary` has loaded, and the compare chart only after both this month's and last month's daily data have loaded. The loading spinner appears only while the summary is first fetched. Tabs and tooltips inside the chart are not meaningful selectors. The `MoneyText` amounts use non-breaking spaces and the `₫` sign: `45.000 ₫` (vi), `₫45,000` (en). The budget-left card's progress bar is `aria-hidden`, so it is not reachable by role. The `Drafts` banner count uses `total` of `GET /transactions?status=draft`. Marked `(unverified)`: the app was not run, this map comes from code only.

## Dashboard month compare (weekly columns)
- **ID:** `dashboard-month-compare`
- **Source Entry Points:**
  - UI: `client/src/features/dashboard/Charts.tsx` (`MonthCompare`, `ChartFigure`), `client/src/features/dashboard/weekly.ts` (`weekTotals`, `previousMonth`), `client/src/features/dashboard/sameDays.ts` (`sameDays`, `sumDays`).
  - API / state: `GET /api/stats/daily?month=` for the shown month and for the previous month (`client/src/features/dashboard/statsApi.ts` `useGetDailyQuery`); `server/src/routes/stats.js`, `server/src/services/stats.js` `daily`.
  - Bot: none.
- **Sub-features:**
  - `Flow switch`: `ToggleButtonGroup` (aria-label `Xem` / `Show`, dashboard:compare.switch) with two toggle buttons, `Chi tiêu` / `Spending` (compare.toExpense, the default) and `Thu nhập` / `Income` (compare.toIncome). It changes the figure heading, the colour, the figure and the sentence.
  - `Heading`: h2 `Chi tiêu tháng này` / `Spending this month` (compare.expense) or `Thu nhập tháng này` / `Income this month` (compare.income). The figure is labelled by it (role `figure`).
  - `Big figure`: the total for the same days (the current month up to today, otherwise whole against whole), and the sub-text `So với cùng kỳ tháng trước` / `Compared with the same days last month` (compare.versus).
  - `Legend`: `Tháng trước` / `Last month` (compare.lastMonth) and `Tháng này` / `This month` (compare.thisMonth), shown as text with decorative dots.
  - `Weekly columns`: Recharts `BarChart` (an svg, with `accessibilityLayer` off) with four weeks, x labels `Tuần 1`..`Tuần 4` / `Week 1`..`Week 4` (compare.week), two bars per week (last month, this month). Days 1–7, 8–14, 15–21 and 22 to the end of the month. Hover shows a tooltip. The chart is not keyboard-reachable on purpose.
  - `Text summary`: `<figcaption>` with the sentence for screen readers (compare.more / less / same, plus compare.peak `Tuần cao nhất: tuần {n}, {amount}.` / `Highest week: week {n}, {amount}.`; compare.empty `Hai tháng này chưa có giao dịch nào.` / `No transactions in these two months yet.`).
- **User Navigation Path:**
  1. Open `/`, sign in as userA → wait for the heading `Xin chào, {name}` / `Hello, {name}`.
  2. Wait for the figure titled `Chi tiêu tháng này` / `Spending this month` (role `figure`, h2). It appears only after both months' daily data have loaded.
  3. Click the toggle button `Thu nhập` / `Income` in the group `Xem` / `Show` to switch the flow.
  4. Use the month picker (`Tháng trước` / `Previous month`) to compare other months.
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/`
  - Container: role `figure` named `Chi tiêu tháng này` / `Spending this month` (changes to `Thu nhập tháng này` / `Income this month` when the flow is income).
  - Primary action: role `group` named `Xem` / `Show`, with role `button` `Chi tiêu` / `Spending` and `Thu nhập` / `Income` (these are toggle buttons with `aria-pressed`).
  - Inputs: none.
  - State indicators: the figcaption text (compare.empty when both months have no data); the `figure` is absent while either month's daily request is pending.
- **Verification / Triage Notes:** the seed needs confirmed transactions in both the shown month and the month before (any flow) to see non-empty columns. Assert on the figcaption sentence and the big figure, not on the svg bars: the bars have no accessible names and the chart layers are tabindex -1 (BUG-023 workaround via MutationObserver). Comparison for the current month uses `vnToday()`, so the figure depends on the date the test runs. `(unverified)`.

## Dashboard category breakdown
- **ID:** `dashboard-category-breakdown`
- **Source Entry Points:**
  - UI: `client/src/features/dashboard/Charts.tsx` (`CategoryBreakdown`, `ChartFigure`), `client/src/features/dashboard/sliceColors.ts`.
  - API / state: `GET /api/stats/by-category?month=&type=expense` (`client/src/features/dashboard/statsApi.ts` `useGetByCategoryQuery`); `server/src/routes/stats.js`, `server/src/services/stats.js` `byCategory`. Colours come from `useGetCategoriesQuery`.
  - Bot: none.
- **Sub-features:**
  - `Ranked list`: `<ul role="list">` of the month's spending by category, biggest first. Each `<li>` reads as one sentence, `{name}: {amount} ({percent}%)`, built from visually hidden `: ` and ` (…)` text. The row has a colour dot (decorative) and a bar (`aria-hidden`).
  - `Total`: the sum of the shown rows, in the heading area (hidden when there are no rows).
  - `Empty state`: `Tháng này chưa có khoản chi nào.` / `No spending this month yet.` (byCategory.empty) in the figcaption.
- **User Navigation Path:**
  1. Open `/`, sign in as userA → wait for the heading `Xin chào, {name}` / `Hello, {name}`.
  2. Find the figure `Chi tiêu theo danh mục` / `Spending by category` (role `figure`, h2).
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/`
  - Container: role `figure` named `Chi tiêu theo danh mục` / `Spending by category` (dashboard:byCategory.title); its list is role `list`.
  - Primary action: none (display only).
  - Inputs: none.
  - State indicators: the empty text `Tháng này chưa có khoản chi nào.` / `No spending this month yet.`
- **Verification / Triage Notes:** only confirmed expense transactions of the shown month count (server `confirmedInMonth`). The figure only renders after `by-category` has loaded. Rows are plain list items: match them by text (category name plus amount). The key `byCategory.item` exists in the JSON but the component builds the sentence from hidden spans instead. `(unverified)`.

## Dashboard latest transactions
- **ID:** `dashboard-latest-transactions`
- **Source Entry Points:**
  - UI: `client/src/features/dashboard/DashboardPage.tsx` (`LatestTransactions`), `client/src/features/transactions/helpers.ts` (`signedMoney`).
  - API / state: `useGetTransactionsQuery({status:'confirmed'})` → `GET /api/transactions?status=confirmed` (first page, 5 shown); `server/src/routes/transactions.js`, `server/src/services/transactions.js` `listTransactions`.
  - Bot: none.
- **Sub-features:**
  - `Latest five`: the 5 newest confirmed transactions of any month, each a list item with the category icon tile (decorative), the note (or the category name), `{category} · {wallet}`, the signed amount (`+` for income, `−` for expense) and the date `dd/mm`.
  - `See all link`: link `Xem tất cả` / `See all` (dashboard:latest.all) goes to `/transactions`.
  - `Empty state`: `Chưa có giao dịch nào.` / `No transactions yet.` (latest.empty).
  - The rows have no buttons: no edit or delete here.
- **User Navigation Path:**
  1. Open `/`, sign in as userA → wait for the heading `Xin chào, {name}` / `Hello, {name}`.
  2. Find the region `Giao dịch gần đây` / `Recent transactions` (h2, `<section>` named by it).
  3. Click link `Xem tất cả` / `See all` to open `/transactions`.
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/`
  - Container: role `region` named `Giao dịch gần đây` / `Recent transactions` (dashboard:latest.title); its list is role `list` with the same name.
  - Primary action: role `link` `Xem tất cả` / `See all`.
  - Inputs: none.
  - State indicators: the text `Chưa có giao dịch nào.` / `No transactions yet.`
- **Verification / Triage Notes:** this list is not filtered by the selected month. Drafts are excluded. A newly saved QuickAdd line shows up here without a reload because the transaction mutations invalidate the `Transaction` tag. `(unverified)`.

## Transactions page
- **ID:** `transactions-page`
- **Source Entry Points:**
  - UI: `client/src/features/transactions/TransactionsPage.tsx` (route in `client/src/features/transactions/routes.tsx`, path `/transactions`, lazy-loaded), `client/src/features/transactions/TransactionList.tsx`, `client/src/features/transactions/TransactionFilters.tsx`, `client/src/features/transactions/TransactionDialog.tsx`, `client/src/features/transactions/helpers.ts`, `client/src/features/transactions/useDebounced.ts`, `client/src/components/QuickAdd.tsx`, `client/src/components/EmptyState.tsx`.
  - API / state: `client/src/features/transactions/transactionsApi.ts`; `server/src/routes/transactions.js`, `server/src/services/transactions.js`. Endpoints used: `GET /api/transactions` (`from,to,type,walletId,categoryId,status,q,page`, limit 20, sort `-occurredAt`), `POST /api/transactions/parse`, `POST /api/transactions`, `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id` (soft delete), `POST /api/transactions/:id/restore`. `POST /api/transactions/:id/confirm` and `GET /api/transactions/:id` exist on the server but this page does not call them.
  - Bot: none.
- **Sub-features:**
  - `Add button`: opens the add dialog (see `transaction-dialog`).
  - `Quick add`: the `QuickAdd` box is mounted above the filters (see `quick-add`).
  - `Filter bar`: see `transactions-filters`.
  - `List`: see `transactions-list`.
  - `Total line`: `Tổng: {n} giao dịch` / `Total: {n} transaction(s)` (transactions:total).
  - `Pagination`: shown when there is more than one page of 20; see Programmatic Selectors.
  - `Empty states`: `Chưa có giao dịch nào` / `No transactions yet` (transactions:empty, h2) with the hint `Gõ vào ô Thêm nhanh, ví dụ "phở 45k", rồi nhấn Enter.` / `Type in the Quick add box, e.g. "pho 45k", and press Enter.`; with filters active `Không có giao dịch nào khớp bộ lọc` / `No transactions match these filters` (transactions:noMatch).
  - `Delete + Undo`: see `transaction-delete-undo`.
  - `Load error`: `Alert` (error) `Không tải được danh sách giao dịch.` / `Could not load your transactions.` with the button `Thử lại` / `Retry`.
  - `Loading`: role `progressbar` named `Đang tải…` / `Loading…`.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA.
  2. Click link `Giao dịch` / `Transactions` (common:nav.transactions, role `link`, href `/transactions`) in the main navigation. Wait for the page heading `Giao dịch` / `Transactions` (h1; it is focusable with tabindex -1).
  3. Or open `/transactions` directly. Filters can be preset through the query string.
- **Shortcuts:** none at page level. Quick add keys are in the `quick-add` section. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/transactions`, optionally `?q=…&from=YYYY-MM-DD&to=YYYY-MM-DD&type=expense|income&walletId=<id>&categoryId=<id>&status=confirmed|draft&page=N`. A filter change replaces the history entry and drops `page`.
  - Container: role `main`; role `heading` level 1 `Giao dịch` / `Transactions`. Document title `Giao dịch · Sổ chi tiêu` / `Transactions · …`.
  - Primary action: role `button` `Thêm giao dịch` / `Add transaction` (transactions:add).
  - Pagination: role `navigation` named `Chọn trang` / `Choose a page` (transactions:pagination). Items: `Trang đầu` / `First page`, `Trang trước` / `Previous page`, `Trang {n}` / `Page {n}`, `Trang sau` / `Next page`, `Trang cuối` / `Last page` (transactions:pages.*).
  - Total: text `Tổng: {n} giao dịch` / `Total: {n} transactions`.
  - State indicators: role `progressbar` `Đang tải…` / `Loading…`; role `alert` + button `Thử lại` / `Retry` (transactions:retry); empty-state h2 `Chưa có giao dịch nào` / `No transactions yet`.
- **Verification / Triage Notes:** needs a seeded user with wallets and categories (the Add dialog and filters need them). More than 20 transactions are needed to see pagination. Free-text search is debounced 300 ms before the request. A page beyond the last is redirected to the last page (`replace`). The snackbar `Đã lưu giao dịch` / `Transaction saved` comes from the shared app snackbar. The list renders as a table at width `sm` and above and as a card list below it (see `transactions-list`). `(unverified)`.

## Transaction filters
- **ID:** `transactions-filters`
- **Source Entry Points:**
  - UI: `client/src/features/transactions/TransactionFilters.tsx`; filter keys in `client/src/features/transactions/helpers.ts` (`FILTER_KEYS`).
  - API / state: the values live in the URL query string (`useSearchParams` in `TransactionsPage.tsx`) and go to `GET /api/transactions`; `server/src/routes/transactions.js` `listQuery`.
  - Bot: none.
- **Sub-features:**
  - `Search`: `type="search"` text box; the request is sent after a 300 ms pause.
  - `Date range`: two `type="date"` inputs, `from` and `to` (Vietnamese calendar days, inclusive).
  - `Type`, `Status`, `Wallet`, `Category`: native `<select>` elements (MUI `select: { native: true }`) with an `Tất cả` / `All` first option. The wallet list includes archived wallets. The category list is grouped in `<optgroup>` labelled `Chi` / `Expense` and `Thu` / `Income`, and shows only the matching group when `type` is set.
  - `Clear`: button resets the whole query string (including `page`).
- **User Navigation Path:**
  1. Open `/transactions` (see `transactions-page`) → wait for the heading `Giao dịch` / `Transactions`.
  2. Find the form region role `search` named `Bộ lọc giao dịch` / `Transaction filters`.
  3. Fill or pick a filter; the list and the URL update.
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/transactions` (URL keys `q`, `from`, `to`, `type`, `walletId`, `categoryId`, `status`).
  - Container: role `search` named `Bộ lọc giao dịch` / `Transaction filters` (transactions:filters.label).
  - Inputs (label → `[name]`; MUI generates the ids, so use the label or the name):
    - role `searchbox` `Tìm theo ghi chú` / `Search notes` (filters.q) → `[name="q"]`
    - label `Từ ngày` / `From` (filters.from) → `[name="from"]` (date)
    - label `Đến ngày` / `To` (filters.to) → `[name="to"]` (date)
    - role `combobox` `Loại` / `Type` (filters.type) → `[name="type"]`; options `Chi` / `Expense`, `Thu` / `Income`
    - role `combobox` `Trạng thái` / `Status` (filters.status) → `[name="status"]`; options `Đã xác nhận` / `Confirmed`, `Nháp` / `Draft`
    - role `combobox` `Ví` / `Wallet` (filters.wallet) → `[name="walletId"]`; options are the wallet names
    - role `combobox` `Danh mục` / `Category` (filters.category) → `[name="categoryId"]`; options are the category names
  - Primary action: role `button` `Xoá bộ lọc` / `Clear filters` (filters.clear).
  - State indicators: the empty state `Không có giao dịch nào khớp bộ lọc` / `No transactions match these filters`.
- **Verification / Triage Notes:** the select is a native `<select>`, so use `selectOption` (Playwright) rather than clicking a listbox. The category options depend on the type filter. Changing any filter resets `page`. `(unverified)`.

## Transaction list
- **ID:** `transactions-list`
- **Source Entry Points:**
  - UI: `client/src/features/transactions/TransactionList.tsx`; shared helper `client/src/features/transactions/helpers.ts` (`signedMoney`).
  - API / state: data from `GET /api/transactions` via `TransactionsPage.tsx`; edit and delete callbacks come from the page.
  - Bot: none.
- **Sub-features:**
  - `Table` (viewport `sm` and up): focusable region, `tabindex=0`, columns `Ngày` / `Date`, `Mô tả` / `Description`, `Ví` / `Wallet`, `Số tiền` / `Amount`, `Thao tác` / `Actions` (transactions:columns.*). The row header cell holds the category (or the note when there is no category) and, below it, the note or `(không ghi chú)` / `(no note)`.
  - `Card list` (below `sm`): `List` named `Danh sách giao dịch` / `Transaction list`, each item with the signed amount, the draft chip and `note · category · wallet · date`, and the two action buttons.
  - `Draft chip`: `Nháp` / `Draft` (transactions:draft) on draft transactions.
  - `Row actions`: icon buttons `Sửa giao dịch {name}` / `Edit transaction {name}` and `Xoá giao dịch {name}` / `Delete transaction {name}`, where `{name}` is the note, or the category name when the note is empty.
  - `Amount`: `−45.000 ₫` for expense and `+45.000 ₫` for income (the sign carries the type).
- **User Navigation Path:**
  1. Open `/transactions` → wait for the heading `Giao dịch` / `Transactions`.
  2. The list shows once the request returns at least one item.
  3. Click `Sửa giao dịch {name}` / `Edit transaction {name}` to open the edit dialog; click `Xoá giao dịch {name}` / `Delete transaction {name}` to delete.
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/transactions`
  - Container: role `region` named `Danh sách giao dịch` / `Transaction list` (table layout; contains role `table`) or role `list` with that name (phone layout, `useMediaQuery(down('sm'))`).
  - Primary action: role `button` `Sửa giao dịch {name}` / `Edit transaction {name}`; role `button` `Xoá giao dịch {name}` / `Delete transaction {name}` (the buttons contain only an `aria-hidden` icon, so the aria-label is the accessible name).
  - Inputs: none.
  - State indicators: chip text `Nháp` / `Draft`; column headers role `columnheader`.
- **Verification / Triage Notes:** `{name}` is the note, so two rows with the same note have the same button names: scope the query to the row (`getByRole('row', { name: … })`) in the table layout. The layout switches at the `sm` breakpoint, so set the viewport before asserting on roles (`table` vs `list`). `(unverified)`.

## Transaction add/edit dialog
- **ID:** `transaction-dialog`
- **Source Entry Points:**
  - UI: `client/src/features/transactions/TransactionDialog.tsx`; opened from `client/src/features/transactions/TransactionsPage.tsx` (add and edit) and from `client/src/components/QuickAdd.tsx` (full form and preview chips). Amount parsing in `client/src/features/transactions/helpers.ts` (`parseAmount`, `toDateTimeInput`, `fromDateTimeInput`).
  - API / state: `POST /api/transactions` (add), `PATCH /api/transactions/:id` (edit) through `transactionsApi.ts`; `server/src/routes/transactions.js` `createBody` and `updateBody`.
  - Bot: none.
- **Sub-features:**
  - `Add mode`: title `Thêm giao dịch` / `Add transaction` (transactions:dialog.addTitle), submit `Lưu` / `Save` (dialog.save). Opened with the page button `Thêm giao dịch` / `Add transaction`, or from QuickAdd with the button `Mở form đầy đủ` / `Open full form` or Shift+Enter.
  - `Edit mode`: title `Sửa giao dịch` / `Edit transaction` (dialog.editTitle), submit `Lưu` / `Save`. Opened with the row button `Sửa giao dịch {name}` / `Edit transaction {name}`.
  - `Quick-add line mode`: title `Sửa dòng thêm nhanh` / `Edit quick-add line` (dialog.draftTitle), submit `Áp dụng` / `Apply` (dialog.apply). It changes one preview line and saves nothing. Opened from a preview chip in QuickAdd.
  - `Type`: radio group named `Loại` / `Type` with radios `Chi` / `Expense` and `Thu` / `Income` (default `Chi`). Changing it clears the category.
  - `Amount`: accepts `45000`, `45k`, `1.5tr`, `1tr5`, `150.000`; helper text `Ví dụ: 45000, 45k, 1.5tr` / `For example: 45000, 45k, 1.5tr`, then `= {amount}` once valid; on blur the text is reformatted. Maximum 10^13 ₫ (`Tối đa {max}` / `At most {max}`). The field is focused when the dialog opens.
  - `Category`, `Wallet`: native selects; the category list follows the type; archived wallets are hidden except the one already in use; the wallet defaults to the user's default wallet, else the first active one.
  - `Date and time`: `datetime-local`, Vietnam time (UTC+7), default now.
  - `Note`: text, at most 200 characters.
  - `Validation`: errors show after the first submit and focus moves to the first wrong field. Messages: `Nhập số tiền lớn hơn 0, ví dụ 45000 hoặc 45k` / `Enter an amount above 0, e.g. 45000 or 45k`, `Chọn danh mục` / `Choose a category`, `Chọn ví` / `Choose a wallet`, `Chọn thời gian` / `Choose a date and time`. A server error shows as an `Alert` inside the dialog and the dialog stays open.
  - `Success`: add or edit shows the app snackbar `Đã lưu giao dịch` / `Transaction saved`. The dialog is full-screen below `sm`.
- **User Navigation Path:**
  1. Open `/transactions` → wait for the heading `Giao dịch` / `Transactions`.
  2. Click button `Thêm giao dịch` / `Add transaction` → wait for role `dialog` named `Thêm giao dịch` / `Add transaction`.
  3. Fill the fields, click `Lưu` / `Save`. The dialog closes and the list refreshes.
  4. For edit: click the row button `Sửa giao dịch {name}` / `Edit transaction {name}`.
- **Shortcuts:** none in the dialog besides the form's own Enter-to-submit (native form submit) and Esc (MUI Dialog close). The key handler for Enter / Shift+Enter is in QuickAdd, not here. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/transactions` (also opens over `/`, from QuickAdd).
  - Container: role `dialog` named `Thêm giao dịch` / `Add transaction`, `Sửa giao dịch` / `Edit transaction` or `Sửa dòng thêm nhanh` / `Edit quick-add line`.
  - Primary action: role `button` `Lưu` / `Save` (transactions:dialog.save) or `Áp dụng` / `Apply` (transactions:dialog.apply), `type="submit"`; secondary `Huỷ` / `Cancel` (common:cancel).
  - Inputs:
    - role `radiogroup` `Loại` / `Type` (`#transaction-type-label`), radios `Chi` / `Expense`, `Thu` / `Income`, `[name="type"]`
    - role `textbox` `Số tiền (₫)` / `Amount (₫)` → `[name="amount"]`
    - role `combobox` `Danh mục` / `Category` → `[name="categoryId"]`
    - role `combobox` `Ví` / `Wallet` → `[name="walletId"]`
    - label `Thời gian` / `Date and time` → `[name="occurredAt"]` (`datetime-local`)
    - role `textbox` `Ghi chú` / `Note` → `[name="note"]`
  - State indicators: field helper texts and errors listed above; role `alert` for the server error; the submit button shows a loading state while saving.
- **Verification / Triage Notes:** the required fields show a `*` in the label (MUI `required`), so match names with a regex or `exact: false`. The category and wallet selects are native, so use `selectOption`. In QuickAdd the same dialog is rendered with a different title and submit label. `(unverified)`.

## Transaction delete and undo
- **ID:** `transaction-delete-undo`
- **Source Entry Points:**
  - UI: `client/src/features/transactions/TransactionsPage.tsx` (`remove`, `undo`, `closeUndo`, the `Snackbar`), `client/src/features/transactions/TransactionList.tsx` (the delete buttons).
  - API / state: `DELETE /api/transactions/:id` (soft delete, 204) and `POST /api/transactions/:id/restore` through `transactionsApi.ts`; `server/src/routes/transactions.js`, `server/src/services/transactions.js` (`deleteTransaction`, `restoreTransaction`).
  - Bot: none.
- **Sub-features:**
  - `Delete`: the row button `Xoá giao dịch {name}` / `Delete transaction {name}` deletes at once, with no confirm dialog.
  - `Undo snackbar`: message `Đã xoá giao dịch` / `Transaction deleted` (transactions:deleted) with the button `Hoàn tác` / `Undo` (transactions:undo). It hides after 8 s, and not while Undo has focus. Focus moves to Undo when it appears; if the snackbar closes while Undo has focus, focus goes to the page h1.
  - `Restore`: clicking Undo calls restore and shows the app snackbar `Đã khôi phục giao dịch` / `Transaction restored` (transactions:restored).
  - `Errors`: a failed delete or restore shows an error snackbar with the server error message.
- **User Navigation Path:**
  1. Open `/transactions` with at least one transaction → wait for the heading `Giao dịch` / `Transactions`.
  2. Click `Xoá giao dịch {name}` / `Delete transaction {name}` → the row disappears and the snackbar `Đã xoá giao dịch` / `Transaction deleted` shows.
  3. Click button `Hoàn tác` / `Undo` within 8 s → the row returns.
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/transactions`
  - Container: the page Snackbar (MUI, role `presentation` wrapper with message text `Đã xoá giao dịch` / `Transaction deleted`).
  - Primary action: role `button` `Hoàn tác` / `Undo`; delete: role `button` `Xoá giao dịch {name}` / `Delete transaction {name}`.
  - Inputs: none.
  - State indicators: the text `Đã khôi phục giao dịch` / `Transaction restored` (app snackbar, role `alert`).
- **Verification / Triage Notes:** only the most recent deletion can be undone (one `undoable` state; a second delete replaces it). Wait for Undo within 8 s, so do not add long sleeps. The undo snackbar is page-local (not the shared `AppSnackbar`) and sits above the bottom navigation on phones (`bottom: 80`). `(unverified)`.

## QuickAdd box
- **ID:** `quick-add`
- **Source Entry Points:**
  - UI: `client/src/components/QuickAdd.tsx` (mounted by `client/src/features/dashboard/DashboardPage.tsx` and `client/src/features/transactions/TransactionsPage.tsx`); uses `client/src/features/transactions/TransactionDialog.tsx`, `client/src/features/transactions/helpers.ts` (`signedMoney`), `client/src/features/transactions/useDebounced.ts`.
  - API / state: `POST /api/transactions/parse` (a RTK `query` named `parseTransactions`, cached per text, saves nothing) and `POST /api/transactions` once per line; `client/src/features/transactions/transactionsApi.ts`; `server/src/routes/transactions.js` (`parseBody`: text 1 to 2000 characters), `server/src/services/transactions.js` `parseTransactions`.
  - Bot: the parser mirrors the bot's text syntax; there is no bot code in this feature.
- **Sub-features:**
  - `Text box`: multiline `TextField` (up to 6 rows), label `Thêm nhanh` / `Quick add`, placeholder `Bạn vừa chi gì? — ví dụ: phở 45k` / `What did you spend on? — e.g. pho 45k`. One transaction per line, up to 10 lines.
  - `Hint line` (helper text): `Enter để lưu, Shift+Enter mở form đầy đủ. Mỗi dòng là một giao dịch.` / `Enter saves, Shift+Enter opens the full form. One transaction per line.` (quickAdd.hint). It is replaced by the parse warning or error when there is one.
  - `Live preview`: 300 ms after typing stops, the server parser runs; a list named `Xem trước` / `Preview` (quickAdd.preview, role `list`) shows one item per parsed line. Each item has four outlined chips: signed amount, category (or `Chưa có danh mục` / `No category`), wallet (or `Chưa có ví` / `No wallet`), date.
  - `Preview chips`: each chip is a button with `aria-label` `Đổi {value}` / `Change {value}` (quickAdd.change), where `{value}` is the chip's text, for example `Đổi −45.000 ₫` / `Change −45.000 ₫`. Clicking opens the dialog in quick-add line mode (title `Sửa dòng thêm nhanh` / `Edit quick-add line`, submit `Áp dụng` / `Apply`); applying changes that line only, and only while the text is unchanged.
  - `Save` (Enter or the button `Lưu` / `Save`, quickAdd.save): parses, checks, then creates every line in order, one request per line. It clears the box and shows the app snackbar `Đã lưu giao dịch: {n}` / `Transactions saved: {n}` (quickAdd.saved).
  - `Full form` (button `Mở form đầy đủ` / `Open full form`, quickAdd.fullForm, or Shift+Enter): opens the add dialog (title `Thêm giao dịch` / `Add transaction`, submit `Lưu` / `Save`) prefilled with the first parsed line, or the text as a note when there is no amount. Saving there creates one transaction and clears the box.
  - `Error and warning messages` (helper text, the field turns to error state on save errors): `Hãy chọn ví và danh mục: bấm vào thẻ xem trước để đổi.` / `Choose a wallet and a category: click a preview chip to change it.` (quickAdd.incomplete); `Dòng {lines} không có số tiền. Hãy sửa hoặc xoá dòng đó rồi lưu.` / `Lines without an amount: {lines}. Fix or remove them, then save.` (quickAdd.noAmountLines); `Mỗi lần chỉ lưu được 10 dòng. Hãy lưu phần còn lại sau.` / `Up to 10 lines can be saved at once. Save the rest afterwards.` (quickAdd.tooManyLines); an API error message (for example NO_AMOUNT_FOUND) in the user's language.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → the dashboard `/` opens with QuickAdd below the heading. Or open `/transactions` (QuickAdd sits under the heading, above the filters).
  2. Click textbox `Thêm nhanh` / `Quick add`, type `phở 45k`.
  3. Wait for the list `Xem trước` / `Preview` and its chips.
  4. Press Enter, or click button `Lưu` / `Save`. Wait for the snackbar `Đã lưu giao dịch: 1` / `Transactions saved: 1`.
- **Shortcuts:** key handler `onKeyDown` in `client/src/components/QuickAdd.tsx`: `Enter` saves every line (and prevents a newline; a second press while one is running is ignored); `Shift+Enter` opens the full form; Enter while an IME is composing is ignored. There are no other global shortcuts. **Bot commands:** none (the text syntax mirrors the bot, for example `phở 45k`, but no command is involved).
- **Programmatic Selectors:**
  - Route: `/` and `/transactions`
  - Container: the `<form>` around the textbox; the preview is a `list` named `Xem trước` / `Preview` (quickAdd.preview).
  - Primary action: role `button` `Lưu` / `Save` (`type="submit"`, quickAdd.save); role `button` `Mở form đầy đủ` / `Open full form` (quickAdd.fullForm). On `/transactions` there are also `Thêm giao dịch` / `Add transaction` and, once the dialog is open, a second `Lưu` / `Save`, so scope the QuickAdd button to the form.
  - Inputs: role `textbox` `Thêm nhanh` / `Quick add` (transactions:quickAdd.label), multiline `<textarea>`. No `name` or `id` is set in code (MUI generates the id), so use the label.
  - Preview chips: role `button` named `Đổi {value}` / `Change {value}` (aria-label), for example `Đổi −45.000 ₫`, `Đổi Ăn uống`, `Đổi Tiền mặt`, `Đổi {dd/mm/yyyy}`. Four per preview line.
  - State indicators: the field's helper text (hint, warning or error); the Save button shows a loading state while saving; the app snackbar `Đã lưu giao dịch: {n}` / `Transactions saved: {n}`.
- **Verification / Triage Notes:** needs a seeded user with at least one wallet and a fallback category per type; otherwise the preview shows `Chưa có danh mục` / `No category` or `Chưa có ví` / `No wallet` and saving fails with `Hãy chọn ví và danh mục…`. The preview needs the server parser (no stub is needed for the dev server). The preview waits 300 ms, so wait for the `Xem trước` / `Preview` list before pressing Enter. If one of several lines fails midway, the earlier lines stay saved and the text stays (code comment `ponytail: one request per line`). Multi-line text must be entered with paste or by typing Shift+Enter is NOT a newline here: Shift+Enter opens the full form, and plain Enter saves. No assistant, question chip or drawer exists in the dashboard, transactions or QuickAdd code: the only chips are the QuickAdd preview chips and the draft chip `Nháp` / `Draft` in the list. `(unverified)`.

## Wallets page
- **ID:** `wallets-page`
- **Source Entry Points:**
  - UI: `client/src/features/wallets/WalletsPage.tsx` (route in `client/src/features/wallets/routes.tsx`, mounted in `client/src/router.tsx`; nav item in `client/src/components/navItems.tsx`)
  - API / state: `client/src/features/wallets/walletsApi.ts` (RTK Query tag `Wallet`), `server/src/routes/wallets.js`, `server/src/services/wallets.js`
  - Bot (if any): none in this area (the bot parser reads `defaultWalletId` and wallet aliases: `server/src/bot/parser.js`)
- **Sub-features:**
  - Wallet cards: one `article` per wallet (type icon, name as `h3`, type label, balance computed by the server, alias chips). Balance is red when below 0.
  - Archived section: a `section` titled `Ví đã lưu trữ` / `Archived wallets` (wallets:archivedTitle), shown only when an archived wallet exists. Cards there carry a chip `Đã lưu trữ` / `Archived` (wallets:archived).
  - Add / edit: opens `WalletDialog` (see Wallet dialog).
  - Archive / unarchive: icon button on the card calls `PATCH /api/wallets/:id` with `{archived}`. No confirm dialog. The server clears `user.defaultWalletId` when the wallet is archived, and the client does the same to the session user (`forgetIfDefault`).
  - Delete: opens a confirm dialog. `DELETE /api/wallets/:id` is refused with `WALLET_IN_USE` (409) while confirmed transactions use the wallet. The error appears in a snackbar.
  - Default wallet: no control on this page. It is set in Settings (`client/src/features/settings/ProfileForm.tsx`, field `defaultWalletId`, owned by another scanner). The server creates a default `Tiền mặt / Cash` wallet at registration (`createDefaultWallet`).
  - Empty / error states: empty heading, error alert with Retry.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → wait for the app shell
  2. Click link `Ví` / `Wallets` (common:nav.wallets) in the main navigation (role `navigation`, name `Điều hướng chính` / `Main navigation`). On phones it sits under the `Thêm` / `More` bottom-nav item (common:nav.more), because only dashboard, transactions, bot and budgets are in the bottom nav.
  3. Wait for the heading level 1 `Ví` / `Wallets`. The page `<title>` is `Ví · Sổ chi tiêu` / `Wallets · Sổ chi tiêu`.
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/wallets`
  - Container: heading level 1 `Ví` / `Wallets` (wallets:title); each wallet is role `article` labelled by its name (heading level 3, id `wallet-<id>`); archived section is role `region` named `Ví đã lưu trữ` / `Archived wallets` (`#archived-wallets`)
  - Primary action: role `button`, name `Thêm ví` / `Add wallet` (wallets:add)
  - Card actions (role `button`, aria-label with `{{name}}` = wallet name):
    - `Sửa ví {{name}}` / `Edit wallet {{name}}` (wallets:actions.edit)
    - `Lưu trữ ví {{name}}` / `Archive wallet {{name}}` (wallets:actions.archive), shown on active wallets
    - `Bỏ lưu trữ ví {{name}}` / `Unarchive wallet {{name}}` (wallets:actions.unarchive), shown on archived wallets
    - `Xoá ví {{name}}` / `Delete wallet {{name}}` (wallets:actions.delete)
  - Delete confirm dialog: role `dialog` titled `Xoá ví?` / `Delete wallet?` (wallets:deleteConfirm.title). Message: `Ví "{{name}}" sẽ bị xoá. Ví đang có giao dịch thì không xoá được, khi đó hãy lưu trữ ví.` / `The wallet "{{name}}" will be deleted. A wallet with transactions cannot be deleted; archive it instead.` Buttons `Huỷ` / `Cancel` (common:cancel, has initial focus) and `Xoá` / `Delete` (wallets:deleteConfirm.confirm).
  - State indicators: role `progressbar` named `Đang tải…` / `Loading…` (common:loading); role `alert` `Không tải được danh sách ví.` / `Could not load your wallets.` (wallets:loadError) with button `Thử lại` / `Retry` (wallets:retry); empty heading level 2 `Bạn chưa có ví nào` / `You have no wallets yet` (wallets:empty); snackbars `Đã xoá ví` / `Wallet deleted` (wallets:deleted), plus the translated `WALLET_IN_USE` text (`Ví đang có giao dịch nên không xoá được. Bạn có thể lưu trữ ví thay vì xoá.` / `This wallet has transactions, so it cannot be deleted. You can archive it instead.`)
- **Verification / Triage Notes:** Needs a signed-in user. A fresh user has one default wallet (`Tiền mặt` / `Cash`). The list is fetched with `includeArchived=true`, so archived wallets show on the same page. To see `WALLET_IN_USE`, create a confirmed transaction in the wallet first. Archive and unarchive give no success snackbar. Delete does. Test file: `client/src/features/wallets/WalletsPage.test.tsx`. Not run against a live app (unverified).

## Wallet dialog (add / edit)
- **ID:** `wallet-dialog`
- **Source Entry Points:**
  - UI: `client/src/features/wallets/WalletDialog.tsx`, with the chip input `client/src/features/categories/KeywordInput.tsx` and helpers `client/src/features/categories/helpers.ts`
  - API / state: `POST /api/wallets`, `PATCH /api/wallets/:id` (`client/src/features/wallets/walletsApi.ts`, `server/src/routes/wallets.js`, `server/src/services/wallets.js`)
  - Bot (if any): none
- **Sub-features:**
  - Add / edit: the same form. Edit pre-fills the wallet's values.
  - Validation: name 1 to 40 characters. Opening balance must be a whole number (`.`, `,` and spaces are ignored) within ±MAX_MONEY. A negative balance is allowed only for type credit (an existing wallet saved below zero before that rule can keep its type and balance). The first invalid field gets focus.
  - Aliases: chip input of bot short names, normalised to lower case without diacritics. Enter, a comma or leaving the field turns the text into a chip.
  - Server errors (for example `NAME_TAKEN`) show as an alert inside the dialog.
- **User Navigation Path:**
  1. Open `/wallets` (see Wallets page)
  2. Add: click button `Thêm ví` / `Add wallet`. Edit: click button `Sửa ví {{name}}` / `Edit wallet {{name}}`.
  3. Wait for the dialog titled `Thêm ví` / `Add wallet` (wallets:dialog.addTitle) or `Sửa ví` / `Edit wallet` (wallets:dialog.editTitle)
- **Shortcuts:** `Enter` in the alias field adds a chip. `Enter` in the other fields submits the form. `Escape` closes the dialog. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/wallets` (dialog, no own route)
  - Container: role `dialog`, name = the title above. Full screen below the `sm` breakpoint.
  - Primary action: role `button` (type submit), name `Lưu` / `Save` (wallets:save). Secondary: `Huỷ` / `Cancel` (common:cancel).
  - Inputs:
    - role `textbox`, name `Tên ví` / `Wallet name` (wallets:fields.name), `[name="name"]`, required, maxlength 40, autofocus
    - role `radiogroup` labelled `Loại ví` / `Wallet type` (wallets:fields.type, label id `wallet-type-label`, group `[name="type"]`) with role `radio` names: `Tiền mặt` / `Cash` (types.cash), `Ngân hàng` / `Bank account` (types.bank), `Ví điện tử` / `E-wallet` (types.ewallet), `Thẻ tín dụng` / `Credit card` (types.credit). The default is cash.
    - role `textbox`, name `Số dư ban đầu (₫)` / `Opening balance (₫)` (wallets:fields.initialBalance), `[name="initialBalance"]`, inputmode numeric
    - role `combobox`, name `Tên gọi tắt cho bot` / `Short names for the bot` (wallets:fields.aliases). Its inner input has `[name="keywords"]`. Each chip has a delete control.
  - State indicators: field errors `Tên ví từ 1 đến 40 ký tự` / `Wallet name must be 1 to 40 characters` (wallets:validation.name); `Nhập số tiền nguyên, ví dụ 200000` / `Enter a whole amount, for example 200000` (validation.initialBalance); `Chỉ thẻ tín dụng mới được có số dư âm` / `Only credit cards can start below zero` (validation.initialBalanceCreditOnly); a range message (validation.initialBalanceMax); a server error role `alert`; the Save button shows a loading state while saving; snackbar `Đã lưu ví` / `Wallet saved` (wallets:saved)
- **Verification / Triage Notes:** The dialog has no own route. The `type` radios have no per-radio ids. Select them by role `radio` plus name. The `[name="keywords"]` selector is shared with the category dialog's keyword input, so scope it to the open dialog. Unverified against a live app.

## Categories page
- **ID:** `categories-page`
- **Source Entry Points:**
  - UI: `client/src/features/categories/CategoriesPage.tsx` (route in `client/src/features/categories/routes.tsx`), row icons from `client/src/features/categories/icons.ts`
  - API / state: `client/src/features/categories/categoriesApi.ts` (tags `Category`, and delete also invalidates `Transaction` and `Stats`), `server/src/routes/categories.js`, `server/src/services/categories.js`
  - Bot (if any): none in this area (category keywords feed the bot parser)
- **Sub-features:**
  - Tabs `Chi` / `Expense` and `Thu` / `Income` filter the list by type (client-side). Expense is the default.
  - Category rows: coloured icon avatar, name (for an unrenamed default copy, the name in the UI language), keyword chips, and a chip `Danh mục dự phòng` / `Fallback category` (categories:fallback) on the fallback ("Khác / Other").
  - Add: opens `CategoryDialog` for the active tab's type.
  - Edit: opens `CategoryDialog` pre-filled (the type cannot change).
  - Delete: confirm dialog. The server moves the category's transactions to the fallback category of the same type. The fallback row has no delete button, and the server refuses it with `FALLBACK_CATEGORY`.
  - Default category: there is no "set default" action. Default categories are per-user copies of server templates (`server/src/seed/templates.js`, copied by `server/src/services/categories.js`). The admin page `/admin/categories` is owned by another scanner. The fallback marker is the only "default" notion here.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → wait for the app shell
  2. Click link `Danh mục` / `Categories` (common:nav.categories) in the main navigation (role `navigation`). On phones it sits under `Thêm` / `More`.
  3. Wait for the heading level 1 `Danh mục` / `Categories`
  4. Optional: click tab `Thu` / `Income` to switch type
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/categories`
  - Container: heading level 1 `Danh mục` / `Categories` (categories:title). Role `tablist` named `Loại danh mục` / `Category type` (categories:typesLabel). Role `tabpanel` `#category-panel`, labelled by `#category-tab-expense` or `#category-tab-income`.
  - Primary action: role `button`, name `Thêm danh mục` / `Add category` (categories:add)
  - Tabs: role `tab`, name `Chi` / `Expense` (types.expense, `#category-tab-expense`); role `tab`, name `Thu` / `Income` (types.income, `#category-tab-income`)
  - Row actions (role `button`, aria-label, `{{name}}` is the displayed category name):
    - `Sửa danh mục {{name}}` / `Edit category {{name}}` (categories:actions.edit)
    - `Xoá danh mục {{name}}` / `Delete category {{name}}` (categories:actions.delete), not rendered for the fallback
  - Rows: role `listitem` labelled by the name (`#category-<id>`)
  - Delete confirm dialog: title `Xoá danh mục?` / `Delete category?` (categories:deleteConfirm.title). Message: `Các giao dịch của danh mục "{{name}}" sẽ chuyển sang danh mục "{{fallback}}".` / `The transactions in "{{name}}" will move to "{{fallback}}".` Buttons `Huỷ` / `Cancel` and `Xoá` / `Delete` (categories:deleteConfirm.confirm).
  - State indicators: role `progressbar` named `Đang tải…` / `Loading…`; role `alert` `Không tải được danh sách danh mục.` / `Could not load your categories.` with button `Thử lại` / `Retry`; snackbar `Đã xoá danh mục` / `Category deleted`; server errors via `apiErrorMessage` (`FALLBACK_CATEGORY`: `Không thể xoá danh mục "Khác".` / `The "Other" category cannot be deleted.`)
- **Verification / Triage Notes:** Needs a signed-in user with seeded default categories (copied at registration). The list is fetched once and filtered by tab, so switching tabs does not refetch. There is no empty state for a type with zero rows. Test file: `client/src/features/categories/CategoriesPage.test.tsx`. Unverified against a live app.

## Category dialog (add / edit)
- **ID:** `category-dialog`
- **Source Entry Points:**
  - UI: `client/src/features/categories/CategoryDialog.tsx`, `client/src/features/categories/KeywordInput.tsx`, `client/src/features/categories/icons.ts`, `client/src/features/categories/helpers.ts`
  - API / state: `POST /api/categories`, `PATCH /api/categories/:id` (`client/src/features/categories/categoriesApi.ts`, `server/src/routes/categories.js`)
  - Bot (if any): none
- **Sub-features:**
  - Add: the title depends on the tab (`Thêm danh mục chi` / `Add expense category`, `Thêm danh mục thu` / `Add income category`).
  - Edit: title `Sửa danh mục` / `Edit category`. The type is fixed. The name is sent only if the user changed it, so an unrenamed default copy keeps following the UI language.
  - Icon select of 13 Material icons with localised labels. Colour picker. Keyword chips, normalised to lower case without diacritics.
  - Validation: name 1 to 40 characters. A server `NAME_TAKEN` shows in an alert inside the dialog.
- **User Navigation Path:**
  1. Open `/categories`, pick a tab
  2. Click button `Thêm danh mục` / `Add category`, or the row's `Sửa danh mục {{name}}` / `Edit category {{name}}`
  3. Wait for the dialog title
- **Shortcuts:** `Enter` in the keyword field adds a chip. `Enter` elsewhere submits. `Escape` closes. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/categories` (dialog, no own route)
  - Container: role `dialog` named by its title (categories:dialog.addTitle.expense / addTitle.income / editTitle). Full screen below `sm`.
  - Primary action: role `button` (submit), name `Lưu` / `Save` (categories:save). Secondary: `Huỷ` / `Cancel`.
  - Inputs:
    - role `textbox`, name `Tên danh mục` / `Category name` (categories:fields.name), `[name="name"]`, required, maxlength 40, autofocus
    - role `combobox` (MUI select), name `Biểu tượng` / `Icon` (categories:fields.icon), `[name="icon"]`. Options by role `option`, names from categories:icons.* (e.g. `Ăn uống` / `Food` for Restaurant, `Xe cộ` / `Car` for DirectionsCar, `Mua sắm` / `Shopping`, `Hoá đơn` / `Bill`, `Nhà` / `Home`, `Phim ảnh` / `Movie`, `Y tế` / `Health`, `Học tập` / `School`, `Khác` / `Other`, `Tiền` / `Money`, `Cúp thưởng` / `Trophy`, `Quà tặng` / `Gift`, `Tiết kiệm` / `Savings`)
    - Colour input: label `Màu` / `Colour` (categories:fields.color), `input[type="color"][name="color"]`
    - role `combobox`, name `Từ khoá cho bot` / `Keywords for the bot` (categories:fields.keywords), inner input `[name="keywords"]`
  - State indicators: field error `Tên danh mục từ 1 đến 40 ký tự` / `Category name must be 1 to 40 characters` (categories:validation.name); server error role `alert`; snackbar `Đã lưu danh mục` / `Category saved` (categories:saved)
- **Verification / Triage Notes:** A `type="color"` input is awkward to drive in automation, so set its value through the DOM or leave it unchanged. The keyword chip control and its `[name="keywords"]` selector are the same as in the wallet dialog. Unverified against a live app.

## Budgets page
- **ID:** `budgets-page`
- **Source Entry Points:**
  - UI: `client/src/features/budgets/BudgetsPage.tsx` (route in `client/src/features/budgets/routes.tsx`), shared `client/src/components/MonthPicker.tsx`, `client/src/components/ConfirmDialog.tsx`, `client/src/components/EmptyState.tsx`
  - API / state: `client/src/features/budgets/budgetsApi.ts` (tag `Budget`, list also provides `Category`; `budgetLevel()` lives here), `server/src/routes/budgets.js`, `server/src/services/budgets.js`
  - Bot (if any): the over-80 % warning is `budgetWarning()` in `server/src/services/budgets.js`, shown in the bot inbox by `client/src/features/bot/DraftCard.tsx` (other scanner)
- **Sub-features:**
  - Month picker: shared `uiSlice.month` (the same month as the dashboard). Previous and next month buttons.
  - Budget cards: one `article` per budget with a name (the category name, or `Tổng chi tiêu` / `All spending` (budgets:overall) for the overall budget), a level pill, a native progress bar, a usage line and a left or over line.
  - Budget levels (`budgetLevel`, exact amounts): `ok` when spent is under 80 % of the limit (`Trong hạn mức` / `On track`, budgets:level.ok, green); `warn` from 80 % up to and including 100 % (`Sắp hết` / `Almost used up`, budgets:level.warn, amber); `over` above 100 % (`Vượt ngân sách` / `Over budget`, budgets:level.over, red). The label is text beside a dot, so colour is never the only signal.
  - Warnings: usage line `Đã chi {{spent}} / {{limit}} ({{percent}}%)` / `Spent {{spent}} of {{limit}} ({{percent}}%)` (budgets:usage). Under it `Còn {{amount}}` / `{{amount}} left` (budgets:left), or in red `Vượt {{amount}}` / `{{amount}} over` (budgets:over). The dashboard reuses `budgetLevel` for its bars and alert (other scanner). The bot reply or inbox warning is a separate path (`budgetWarning`, thresholds 80 and 100).
  - Add budget: opens `BudgetDialog`. Edit: opens `BudgetDialog` (limit only). Delete: confirm dialog.
  - Copy from last month: `POST /api/budgets/copy {from: previous month, to: selected month}`. Budgets the target month already has are kept. The snackbar shows the number copied, or an info message if nothing is new.
  - Empty state when the month has no budgets: heading level 2 with a hint.
  - No default-budget action exists.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → wait for the app shell
  2. Click link `Ngân sách` / `Budgets` (common:nav.budgets) in the main navigation. It is one of the four phone bottom-nav tabs.
  3. Wait for the heading level 1 `Ngân sách` / `Budgets`
  4. Optional: use the month buttons `Tháng trước` / `Previous month` and `Tháng sau` / `Next month` (common:month.previous / next)
- **Shortcuts:** none. **Bot commands:** none on this page.
- **Programmatic Selectors:**
  - Route: `/budgets`
  - Container: heading level 1 `Ngân sách` / `Budgets` (budgets:title). Each budget is role `article`, labelled by its name (heading level 2, id `budget-<id>`).
  - Primary actions: role `button`, `Thêm ngân sách` / `Add budget` (budgets:add); role `button`, `Chép từ tháng trước` / `Copy from last month` (budgets:copy, shows a loading state while posting)
  - Month picker: role `button` `Tháng trước` / `Previous month`; role `button` `Tháng sau` / `Next month`; the current month label is an `output` element (aria-live polite), e.g. `tháng 11 năm 2026` formatted by `formatDate` (the exact string is locale dependent)
  - Card actions (role `button`, aria-label): `Sửa ngân sách {{name}}` / `Edit budget {{name}}` (budgets:actions.edit); `Xoá ngân sách {{name}}` / `Delete budget {{name}}` (budgets:actions.delete)
  - Progress: the native `<progress>` has implicit role `progressbar`, labelled by the budget name (`aria-labelledby="budget-<id>"`) and described by `#budget-<id>-usage`. Its `value` is `min(spent, limit)` and `max` is `limit`.
  - Level text: `Trong hạn mức` / `On track`, `Sắp hết` / `Almost used up`, `Vượt ngân sách` / `Over budget` (budgets:level.*)
  - Delete confirm dialog: title `Xoá ngân sách?` / `Delete budget?` (budgets:deleteConfirm.title). Message: `Ngân sách "{{name}}" của tháng này sẽ bị xoá. Các giao dịch vẫn giữ nguyên.` / `The "{{name}}" budget of this month will be deleted. Your transactions stay as they are.` Buttons `Huỷ` / `Cancel` and `Xoá` / `Delete` (budgets:deleteConfirm.confirm).
  - State indicators: role `progressbar` named `Đang tải…` / `Loading…` while the first fetch runs (the card progress bars have the same role, so tell them apart by name); role `alert` `Không tải được ngân sách.` / `Could not load your budgets.` with button `Thử lại` / `Retry`; empty heading level 2 `Tháng này chưa có ngân sách` / `No budgets for this month yet`, with hint `Thêm hạn mức chi cho từng danh mục hoặc cho tổng chi tiêu, hoặc chép ngân sách của tháng trước.` / `Set a spending limit for a category or for all spending, or copy last month's budgets.`; snackbars `Đã chép ngân sách: {{count}}` / `Budgets copied: {{count}}` (budgets:copied), `Không có ngân sách mới nào để chép từ tháng trước.` / `There are no new budgets to copy from last month.` (budgets:nothingToCopy), `Đã xoá ngân sách` / `Budget deleted` (budgets:deleted)
- **Verification / Triage Notes:** Needs a signed-in user with expense categories. To check levels, seed confirmed expenses at under 80 %, 80 to 100 % and over 100 % of a limit. Month keys are Vietnamese calendar months (`YYYY-MM`). The page uses `currentData`, so a month switch shows a spinner instead of the old month's data. Test file: `client/src/features/budgets/BudgetsPage.test.tsx`. Unverified against a live app.

## Budget dialog (add / edit)
- **ID:** `budget-dialog`
- **Source Entry Points:**
  - UI: `client/src/features/budgets/BudgetDialog.tsx`, with helpers `client/src/features/transactions/helpers.ts` (`parseAmount`, `formatNumber`, `isOverMax`, `MAX_MONEY`)
  - API / state: `POST /api/budgets`, `PATCH /api/budgets/:id` (`client/src/features/budgets/budgetsApi.ts`, `server/src/routes/budgets.js`)
  - Bot (if any): none
- **Sub-features:**
  - Add: pick the overall budget or an expense category that has no budget yet this month (taken ones are removed from the options). Enter a limit.
  - Edit: only the limit can change, and the category select is not rendered. A subtitle shows `<name> · <month label>`.
  - The limit accepts the bot's shortcuts (`2tr`, `500k`, `2.000.000`). On blur it is reformatted, and the helper text shows `= <formatted money>`.
  - Validation shows only after the first Save: the limit must be above 0 and at most MAX_MONEY. A category must be selectable. `BUDGET_EXISTS` (409) shows in an alert.
- **User Navigation Path:**
  1. Open `/budgets`
  2. Click button `Thêm ngân sách` / `Add budget`, or the card's `Sửa ngân sách {{name}}` / `Edit budget {{name}}`
  3. Wait for the dialog titled `Thêm ngân sách` / `Add budget` (budgets:dialog.addTitle) or `Sửa ngân sách` / `Edit budget` (budgets:dialog.editTitle)
- **Shortcuts:** `Enter` submits. `Escape` closes. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/budgets` (dialog, no own route)
  - Container: role `dialog`, named by its title. Full screen below `sm`.
  - Primary action: role `button` (submit), name `Lưu` / `Save` (budgets:save). Secondary: `Huỷ` / `Cancel`.
  - Inputs:
    - Add mode only: a native `<select>` (role `combobox`), name `Danh mục` / `Category` (budgets:fields.category), `[name="categoryId"]`. Options by role `option`: `Tổng chi tiêu (mọi danh mục)` / `All spending (every category)` (budgets:fields.overallOption, value `overall`), then one option per expense category without a budget, labelled with the category name.
    - role `textbox`, name `Hạn mức (₫)` / `Limit (₫)` (budgets:fields.limit), `[name="limit"]`, required. Autofocus in edit mode. In add mode the category select has focus.
  - State indicators: helper `Ví dụ: 2tr, 500k hoặc 2.000.000` / `For example: 2tr, 500k or 2,000,000` (budgets:fields.limitHelp); errors `Nhập số tiền lớn hơn 0, ví dụ 2tr hoặc 2.000.000` / `Enter an amount above 0, for example 2tr or 2,000,000` (validation.limit), `Tối đa {{max}}` / `At most {{max}}` (validation.limitMax), `Mọi danh mục chi đã có ngân sách trong tháng này.` / `Every expense category already has a budget this month.` (validation.category); server alert `Danh mục này đã có ngân sách cho tháng đã chọn.` / `This category already has a budget for the selected month.` (errors:BUDGET_EXISTS); snackbar `Đã lưu ngân sách` / `Budget saved` (budgets:saved)
- **Verification / Triage Notes:** The category field is a native select (`slotProps.select.native`), so use `selectOption` by label or value and not a click on a listbox. The dialog is created against the month in `uiSlice.month`. Switch the month before opening it. Unverified against a live app.

## Bot inbox page
- **ID:** `bot-inbox`
- **Source Entry Points:**
  - UI: `client/src/features/bot/BotInboxPage.tsx`, route in `client/src/features/bot/routes.tsx` (lazy, inside ProtectedRoute and AppLayout)
  - API / state: `client/src/features/bot/botApi.ts` (RTK Query), `server/src/routes/chatLinks.js`, `server/src/routes/receipts.js`, `server/src/routes/transactions.js`
  - Bot (if any): none in this area (the bots redeem link codes and create drafts; see the bot scanners)
- **Sub-features:**
  - `Receipt upload`: see `bot-receipt-upload`
  - `Drafts to review`: see `bot-drafts`
  - `Link card`: see `bot-link-card`
  - `Linked accounts`: see `bot-linked-accounts`
  - Layout: two columns from the `md` breakpoint (upload and drafts on the left, link card and linked accounts on the right); one column on a phone.
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → wait for the app shell
  2. Click link `Hộp thư bot` / `Bot inbox` (common:nav.bot) in the navigation (role `link`; it is also in the bottom nav on a phone), or open `/bot`
  3. Wait for heading level 1 `Hộp thư bot` / `Bot inbox`
- **Shortcuts:** none. **Bot commands:** none on this page (it lists what the bots create).
- **Programmatic Selectors:**
  - Route: `/bot`
  - Container: heading level 1 `Hộp thư bot` / `Bot inbox` (bot:title); intro text `bot:intro`; document title `Hộp thư bot · Sổ chi tiêu`
  - Primary action: see the four sub-feature sections
  - State indicators: each part has its own loading, error and empty state (see below)
- **Verification / Triage Notes:** Needs a logged-in user with at least one wallet and category. The page loads `GET /chat-links` and `GET /transactions?status=draft&limit=100`. Both refetch every time the page opens (`refetchOnMountOrArgChange`). Nothing here is admin-only.

## Receipt upload (bot inbox)
- **ID:** `bot-receipt-upload`
- **Source Entry Points:**
  - UI: `client/src/features/bot/ReceiptUpload.tsx`, `client/src/features/bot/resizeImage.ts`
  - API / state: `client/src/features/bot/botApi.ts` (`uploadReceipt`), `server/src/routes/receipts.js` (`POST /api/receipts`, multipart field `image`, 4.5 MB limit), `server/src/services/receipts.js`
  - Bot (if any): none
- **Sub-features:**
  - `Choose receipt photo`: opens a hidden `input[type=file]` (`accept="image/*"`). The browser shrinks the photo to 1600 px or less as JPEG, then uploads it.
  - `Reading status`: a polite status line says reading (about 20–40 s) and then done. The new draft appears in `bot-drafts`.
  - `Error`: failure codes go through `errorMessage`: `UNSUPPORTED_MEDIA_TYPE` (file the browser can't open as an image), `RECEIPT_UNREADABLE`, `KIE_TIMEOUT`, `KIE_UNAVAILABLE`, `PAYLOAD_TOO_LARGE`, `FEATURE_NOT_CONFIGURED`, etc.
- **User Navigation Path:**
  1. Open `/bot` (see `bot-inbox`)
  2. In the region `Tải ảnh hoá đơn` / `Upload a receipt`, click button `Chọn ảnh hoá đơn` / `Choose receipt photo`, or set files directly on the hidden input
  3. Wait for status text `Đã tạo bản nháp từ hoá đơn…` / `A draft was created from the receipt…` (bot:upload.done)
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/bot`
  - Container: region (section) named by h2 `Tải ảnh hoá đơn` / `Upload a receipt` (bot:upload.title)
  - Primary action: role `button`, name `Chọn ảnh hoá đơn` / `Choose receipt photo` (bot:upload.button); shows a loading state while busy
  - Inputs: `input[type="file"][accept="image/*"]` with aria-label `Chọn ảnh hoá đơn` / `Choose receipt photo`. It has the `hidden` attribute, so it is not in the accessibility tree: use `setInputFiles` on the `input[type=file]` locator rather than `getByRole`.
  - State indicators: role `status` text `Đang đọc hoá đơn… (khoảng 20–40 giây)` / `Reading the receipt… (about 20–40 seconds)` (bot:upload.reading), then bot:upload.done; error is an `Alert` (role `alert`) with the `errors` text
- **Verification / Triage Notes:** The real `POST /api/receipts` calls KIE and takes 20–40 s. The e2e server needs a KIE stub or a flag; otherwise the call returns `KIE_UNAVAILABLE` or `FEATURE_NOT_CONFIGURED`. Server errors come back as codes, not text. Only the error text follows a language switch. The upload accepts any image, but the server only supports JPEG or PNG (the client always re-encodes to JPEG). The button and the hidden input share a name, so use the role `button` query for the click.

## Drafts to review (bot inbox)
- **ID:** `bot-drafts`
- **Source Entry Points:**
  - UI: `client/src/features/bot/DraftList.tsx`, `client/src/features/bot/DraftCard.tsx`, `client/src/features/bot/sourceIcon.tsx`, `client/src/components/ConfirmDialog.tsx`
  - API / state: `client/src/features/bot/botApi.ts` (`getDrafts`, `confirmDraft`), `client/src/features/transactions/transactionsApi.ts` (`deleteTransaction`), `server/src/routes/transactions.js` (`GET /` with `status=draft`, `POST /:id/confirm`, `DELETE /:id`), `server/src/services/transactions.js`
  - Bot (if any): drafts also come from the chat bots (`server/src/bot/`) and can be confirmed there by ✅ / `ok` / `huy`
- **Sub-features:**
  - `Draft list`: heading with the total, `Bản nháp chờ duyệt (N)` / `Drafts to review (N)`, newest 100 drafts, no paging.
  - `Draft card`: an inline form with a source chip (Telegram, Zalo, WhatsApp, Hoá đơn / Receipt, Web), a title (the note, or `(không ghi chú)` / `(no note)`) and editable fields.
  - `Receipt line items`: a native `<details>` with `summary` `N dòng hàng` text (bot:drafts.items; en `Line items: N`), e.g. `2 dòng hàng · khớp tổng tiền`, and `khớp tổng tiền` / `match the total` or `không khớp tổng tiền` / `do not match the total`. It appears only for drafts that have receipt items.
  - `Confirm`: `POST /transactions/:id/confirm`, sending the changed fields if any. Snackbar `Đã lưu giao dịch` / `Transaction saved`, or the budget warning `Đã lưu. Bạn đã dùng N% ngân sách tháng này.` / `Saved. You have used N% of this month's budget.`
  - `Discard`: confirm dialog, then `DELETE /transactions/:id`; snackbar `Đã bỏ bản nháp` / `Draft discarded`.
  - A 404 or 409 on confirm (already confirmed or deleted in the chat) also removes the card.
- **User Navigation Path:**
  1. Open `/bot` (see `bot-inbox`), with at least one draft (a receipt upload or a bot message creates one)
  2. In the region `Bản nháp chờ duyệt` / `Drafts to review`, find the form named by the draft title
  3. Edit fields if needed, then click `Xác nhận` / `Confirm`, or click `Bỏ` / `Discard` and confirm in the dialog
- **Shortcuts:** none. **Bot commands:** none (the bots use ✅ / `ok` / `huy`, see the bot scanners).
- **Programmatic Selectors:**
  - Route: `/bot`
  - Container: region named by h2 `Bản nháp chờ duyệt` / `Drafts to review` (bot:drafts.title); each card is role `form` named by its h3 title (the note text, or `(không ghi chú)` / `(no note)`, transactions:noNote)
  - Primary action: role `button`, name `Xác nhận` / `Confirm` (bot:drafts.confirm, `type=submit`)
  - Secondary action: role `button`, name `Bỏ` / `Discard` (bot:drafts.discard)
  - Inputs (per card, all inside the form, label text with `*` added on required fields):
    - `[name="type"]`: role `combobox` (native select), `Loại` / `Type`, options `Chi` / `Expense`, `Thu` / `Income`
    - `[name="amount"]`: role `textbox`, `Số tiền (₫)` / `Amount (₫)`, with helper `= <formatted money>`
    - `[name="categoryId"]`: role `combobox`, `Danh mục` / `Category`
    - `[name="walletId"]`: role `combobox`, `Ví` / `Wallet`
    - `[name="occurredAt"]`: `input[type=datetime-local]`, `Thời gian` / `Date and time`
    - `[name="note"]`: role `textbox`, `Ghi chú` / `Note` (max 200 characters)
  - Dialog (discard): role `dialog` named `Bỏ bản nháp?` / `Discard the draft?` (bot:drafts.discardTitle), message `Bản nháp "{name}" sẽ bị xoá…` / `The draft "{name}" will be deleted…`, buttons `Huỷ` / `Cancel` (focused first, common:cancel) and `Bỏ` / `Discard` (the confirm button, destructive)
  - State indicators: role `progressbar` named `Đang tải…` / `Loading…` (common:loading); error Alert with retry button `Thử lại` / `Retry` (bot:retry) and text `Không tải được bản nháp.` / `Could not load the drafts.`; empty text `drafts.empty`; validation helper texts from `transactions:validation.*`, shown after the first Confirm
- **Verification / Triage Notes:** Needs a seeded draft (a transaction with `status: draft`) plus at least one wallet and category of the matching type. Validation errors appear only after the first Confirm, and focus then goes to the first wrong field. While the discard dialog is open, the card's own `Bỏ` button is hidden behind the modal, so `getByRole('button', {name: 'Bỏ'})` finds the dialog's button. Selects are native (`<select>`), so use `selectOption`. The money helper text depends on the UI language.

## Link card (bot inbox)
- **ID:** `bot-link-card`
- **Source Entry Points:**
  - UI: `client/src/features/bot/LinkCard.tsx`, `client/src/features/bot/qrCode.ts`
  - API / state: `client/src/features/bot/botApi.ts` (`createLinkCode`, `getChatLinks` polled every 5 s while a code is live), `server/src/routes/chatLinks.js` (`POST /api/chat-links/code`, limit 5 per 10 minutes), `server/src/services/chatLinks.js`
  - Bot (if any): the bot redeems the code: `/link CODE` (and Telegram/WhatsApp deep links) in `server/src/bot/` (see the bot scanners)
- **Sub-features:**
  - `Generate code`: creates a one-time code valid for 10 minutes. After it, the button is replaced by the code block.
  - `Code block`: the code, a countdown `Hết hạn sau m:ss` / `Expires in m:ss`, and the manual line `/link CODE`. Focus moves to it.
  - `App picker`: a toggle group `Telegram` / `WhatsApp` / `Zalo`, shown only when the server returns links for more than one app. It starts on the first app not yet linked.
  - `Open app button`: a link (`<a href target=_blank>`), one per app. For Zalo the click also copies `/link CODE` to the clipboard.
  - `QR code`: an SVG of the same link for desktop users.
  - `Linked ✓`: when the 5 s check finds a chat link made while the code was valid, the card shows `Đã liên kết ✓ {name}` / `Linked ✓ {name}` and the generate button returns as `Tạo mã mới` / `Create a new code`.
  - `Expired`: info alert `Mã đã hết hạn. Hãy tạo mã mới.` / `The code has expired. Please create a new one.`
- **User Navigation Path:**
  1. Open `/bot` (see `bot-inbox`)
  2. In the region `Liên kết Telegram / WhatsApp / Zalo` / `Link Telegram / WhatsApp / Zalo`, click `Tạo mã liên kết` / `Create link code`
  3. Wait for role `timer` text `Hết hạn sau …` / `Expires in …`; pick an app (if the toggle group is shown) and click the open-app link
  4. After the bot redeems the code, wait for text `Đã liên kết ✓ …` / `Linked ✓ …`
- **Shortcuts:** none. **Bot commands:** `/link CODE` (sent to the bot to redeem the code).
- **Programmatic Selectors:**
  - Route: `/bot`
  - Container: region named by h2 `Liên kết Telegram / WhatsApp / Zalo` / `Link Telegram / WhatsApp / Zalo` (bot:link.heading); description `bot:link.description`
  - Primary action: role `button`, name `Tạo mã liên kết` / `Create link code` (bot:link.generate), or `Tạo mã mới` / `Create a new code` (bot:link.regenerate) after a code exists, expired or linked
  - App picker: role `group` with aria-label `Ứng dụng chat` / `Chat app` (bot:link.app) holding three toggle buttons (role `button`, `aria-pressed`) named `Telegram`, `WhatsApp`, `Zalo` (bot:sources.*)
  - Open-app link: role `link`, name `Mở Telegram` / `Open Telegram` (bot:link.openTelegram), `Mở WhatsApp` / `Open WhatsApp` (bot:link.openWhatsapp), `Chép mã & mở Zalo` / `Copy & open Zalo` (bot:link.openZalo)
  - QR code: role `img`, name `Mã QR mở Telegram với mã liên kết` / `QR code that opens Telegram with the link code` (bot:link.qrFor, `{app}` filled in); for Zalo `Mã QR mở bot Zalo` / `QR code that opens the Zalo bot` (bot:link.qrZalo)
  - Code text: label text `Mã liên kết` / `Link code` (bot:link.code); the code is plain text in monospace, and the manual line is a `<code>` element `/link <CODE>`
  - State indicators: role `timer` (countdown), role `status` (the copy result `Đã chép /link CODE` / `Copied /link CODE`, or `Không chép được…` / `Could not copy…`; and the "Linked ✓" region), error Alert (role `alert`, e.g. `RATE_LIMITED` after 5 codes in 10 minutes), the button's loading state while the code is requested
- **Verification / Triage Notes:** The open-app links and the QR code appear only for apps the server has settings for (`links[app]` not null); with none configured, only the code and the manual `/link CODE` line show. Redeeming needs a bot (or a test that inserts a chat link with `createdAt` inside the code window) and takes up to 5 s to show. The countdown ticks every second and runs `m:ss` (10:00 down to 0:00). The Zalo copy needs the Clipboard API; on plain-http pages it shows the failure message. The name in "Linked ✓" is `<platform> · <displayName>`, for example `Zalo · Anh`. `bot:link.title`, `bot:link.telegram`, `bot:link.qr` and `bot:link.zalo` exist in the i18n files but the component doesn't use them.

## Linked accounts (bot inbox)
- **ID:** `bot-linked-accounts`
- **Source Entry Points:**
  - UI: `client/src/features/bot/LinkedAccounts.tsx`, `client/src/features/bot/sourceIcon.tsx`, `client/src/components/ConfirmDialog.tsx`
  - API / state: `client/src/features/bot/botApi.ts` (`getChatLinks`, `deleteChatLink`), `client/src/features/link/linkApi.ts` (`dismissClaimNotice`), `server/src/routes/chatLinks.js` (`GET /`, `DELETE /:id`, `PATCH /:id/claim-notice`), `server/src/services/chatLinks.js`
  - Bot (if any): none
- **Sub-features:**
  - `Linked list`: one row per linked chat, with the name `<platform> · <displayName>` (a chat with no name shows the platform) and `Liên kết ngày <date>` / `Linked on <date>`.
  - `Unlink`: an icon button per row opens a destructive confirm dialog, then `DELETE /chat-links/:id`; snackbar `Đã huỷ liên kết {name}` / `Unlinked {name}`.
  - `"Not you?" notice`: for links made from a chat's claim link (`viaClaim`) and not yet dismissed. It is a warning with a dismiss button and an `Huỷ liên kết` / `Unlink` button.
  - `Empty and error states`: empty text and an error with retry.
- **User Navigation Path:**
  1. Open `/bot` (see `bot-inbox`)
  2. In the region `Tài khoản đã liên kết` / `Linked accounts`, find the row
  3. Click the unlink icon button, then confirm in the dialog
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/bot`
  - Container: region named by h2 `Tài khoản đã liên kết` / `Linked accounts` (bot:accounts.title); the list is role `list`
  - Primary action: role `button` (icon button), aria-label `Huỷ liên kết {name}` / `Unlink {name}` (bot:accounts.unlink), where `{name}` is like `Telegram · Anh`
  - Dialog: role `dialog` named `Huỷ liên kết?` / `Unlink?` (bot:accounts.unlinkTitle), message bot:accounts.unlinkMessage, buttons `Huỷ` / `Cancel` (common:cancel, focused first) and `Huỷ liên kết` / `Unlink` (bot:accounts.unlinkConfirm)
  - Claim notice: role `group` named by its sentence (link:notice.text, `Chat mới được liên kết từ đường link chat: … Không phải bạn?` / `New chat linked from a chat link: … Not you?`); dismiss button aria-label `Đóng thông báo về {name}` / `Dismiss notice for {name}` (link:notice.dismiss); its unlink button has visible text `Huỷ liên kết` / `Unlink` (link:notice.unlink) but the same aria-label as the row button (`Huỷ liên kết {name}` / `Unlink {name}`)
  - State indicators: empty text `Chưa liên kết tài khoản chat nào.` / `No chat account is linked yet.` (bot:accounts.empty); error Alert `Không tải được danh sách tài khoản.` / `Could not load the linked accounts.` with button `Thử lại` / `Retry` (bot:retry)
- **Verification / Triage Notes:** Needs a seeded chat link (`platform`, `displayName`; set `viaClaim: true` and no `claimNoticeDismissedAt` to get the notice). With a claim notice and a list row for the same chat, two buttons share the accessible name `Unlink {name}`; scope by role `group` or `list`. After unlink or dismiss, focus returns to the h2. The `/link` claim page (`client/src/features/link/LinkPage.tsx`, route `/link`) is outside this scan; it is public, shows `Liên kết …?` / `Link … to …?` with buttons `Xác nhận` / `Confirm` and `Huỷ` / `Cancel`, and sends the user to `/bot` on success.

## Settings page
- **ID:** `settings-page`
- **Source Entry Points:**
  - UI: `client/src/features/settings/SettingsPage.tsx`, route in `client/src/features/settings/routes.tsx` (lazy, inside ProtectedRoute and AppLayout)
  - API / state: `client/src/features/settings/settingsApi.ts`, `client/src/features/settings/useSaveProfile.ts`, `client/src/auth/usersApi.ts` (`PATCH /users/me`), `server/src/routes/users.js`, `server/src/routes/sessions.js`, `server/src/services/users.js`, `server/src/services/sessions.js`
  - Bot (if any): none
- **Sub-features:**
  - `Profile`, `Preferences`, `Password`, `Sessions`: see the four sections below. Each form saves on its own.
  - Layout: two columns from the `md` breakpoint (profile and preferences on the left, password and sessions on the right).
- **User Navigation Path:**
  1. Open `/login`, sign in as userA → wait for the app shell
  2. Click the account menu button `Tài khoản` / `Account` (common:account.menu), then menu item `Cài đặt` / `Settings` (common:account.settings); or the navigation link `Cài đặt` / `Settings` (common:nav.settings; on a phone it is in the `Thêm` / `More` sheet); or open `/settings`
  3. Wait for heading level 1 `Cài đặt` / `Settings`
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/settings`
  - Container: heading level 1 `Cài đặt` / `Settings` (settings:title); document title `Cài đặt · Sổ chi tiêu`
  - Primary action: see the four sections below
  - State indicators: snackbar messages per form; errors as Alerts inside each form
- **Verification / Triage Notes:** Needs a logged-in user. Page parts load `GET /wallets` and `GET /sessions`. Not admin-only.

## Settings: profile
- **ID:** `settings-profile`
- **Source Entry Points:**
  - UI: `client/src/features/settings/ProfileForm.tsx`, `client/src/features/settings/useSaveProfile.ts`
  - API / state: `client/src/auth/usersApi.ts` (`PATCH /users/me`), `server/src/routes/users.js`, `client/src/features/wallets/walletsApi.ts` (wallet options)
  - Bot (if any): none (the default wallet is what the bots and quick add use when no wallet is named)
- **Sub-features:**
  - `Name`: 1 to 60 characters, validated on submit.
  - `Default wallet`: a native select of the user's wallets, with a `Không chọn` / `None` option (empty value).
  - `Signed-in email line`: `Đăng nhập bằng {email}` / `Signed in as {email}` (read-only text).
- **User Navigation Path:**
  1. Open `/settings` (see `settings-page`)
  2. Edit `Họ tên` / `Name` and/or `Ví mặc định` / `Default wallet`
  3. Click `Lưu hồ sơ` / `Save profile` → wait for snackbar `Đã lưu hồ sơ` / `Profile saved`
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/settings`
  - Container: role `form` named `Hồ sơ` / `Profile` (settings:profile.title, h2)
  - Primary action: role `button`, name `Lưu hồ sơ` / `Save profile` (settings:profile.save, `type=submit`)
  - Inputs: `[name="name"]`, role `textbox`, `Họ tên` / `Name` (required, `autocomplete=name`); `[name="defaultWalletId"]`, role `combobox` (native select), `Ví mặc định` / `Default wallet`
  - State indicators: field error `Họ tên từ 1 đến 60 ký tự` / `Name must be 1 to 60 characters` (settings:profile.nameError); server error Alert (role `alert`); snackbar `Đã lưu hồ sơ` / `Profile saved` (settings:profile.saved); the button's loading state
- **Verification / Triage Notes:** The form starts from the signed-in user's values. After save, the new name shows in the shell at once (no re-login). Validation focuses the name field.

## Settings: preferences
- **ID:** `settings-preferences`
- **Source Entry Points:**
  - UI: `client/src/features/settings/PreferencesForm.tsx`, `client/src/features/settings/useSaveProfile.ts`
  - API / state: `client/src/app/uiSlice.ts` (`applyLanguage`, `applyThemeMode`), `client/src/auth/usersApi.ts` (`PATCH /users/me`), `server/src/routes/users.js` (`language`, `theme: light|dark|system`)
  - Bot (if any): none (the bots reply in the saved language)
- **Sub-features:**
  - `Language`: radio group `Tiếng Việt` / `English`. Nothing changes until Save.
  - `Theme`: radio group `Sáng` / `Light`, `Tối` / `Dark`, `Theo hệ thống` / `Same as system` (settings:preferences.themes.*).
  - The radios follow the current app setting until the user picks something else.
- **User Navigation Path:**
  1. Open `/settings` (see `settings-page`)
  2. Pick a language and/or a theme in the form `Tuỳ chọn` / `Preferences`
  3. Click `Lưu tuỳ chọn` / `Save preferences` → wait for snackbar `Đã lưu tuỳ chọn` / `Preferences saved`
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/settings`
  - Container: role `form` named `Tuỳ chọn` / `Preferences` (settings:preferences.title, h2)
  - Primary action: role `button`, name `Lưu tuỳ chọn` / `Save preferences` (settings:preferences.save, `type=submit`)
  - Inputs: role `radiogroup` (`[name="language"]`) in a `group` (fieldset) with legend `Ngôn ngữ` / `Language` (settings:preferences.language), radios named `Tiếng Việt` and `English` (the same in both UI languages, each in its own `lang`); role `radiogroup` (`[name="theme"]`) in a group with legend `Giao diện` / `Theme` (settings:preferences.theme), radios `Sáng`/`Light`, `Tối`/`Dark`, `Theo hệ thống`/`Same as system`
  - State indicators: snackbar `Đã lưu tuỳ chọn` / `Preferences saved` (shown in the newly chosen language); if the profile save fails, a warning snackbar `common:preferenceNotSaved` (the choice still applies on this device until reload)
- **Verification / Triage Notes:** The language and theme apply on this device at Save, before the server answers. The app bar has separate language and theme buttons (app shell scanner); a change made there shows up in these radios too.

## Settings: change password
- **ID:** `settings-password`
- **Source Entry Points:**
  - UI: `client/src/features/settings/PasswordForm.tsx`, `client/src/features/auth/PasswordField.tsx`
  - API / state: `client/src/features/settings/settingsApi.ts` (`changePassword`: `PATCH /users/me/password`), `server/src/routes/users.js`, `server/src/services/users.js`
  - Bot (if any): none
- **Sub-features:**
  - `Three password fields`: current, new, and repeat new. Each has a show/hide button.
  - `Validation`: required current password; new password of at least 8 characters and at most 72 bytes; the repeat must match.
  - `Server check`: `INVALID_CREDENTIALS` shows `Mật khẩu hiện tại không đúng` / `The current password is wrong` on the current-password field.
  - `Side effect`: the server logs out every other device.
- **User Navigation Path:**
  1. Open `/settings` (see `settings-page`)
  2. In the form `Đổi mật khẩu` / `Change password`, fill the three password fields
  3. Click `Đổi mật khẩu` / `Change password` → wait for snackbar `Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.` / `Password changed. Your other devices were logged out.`
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/settings`
  - Container: role `form` named `Đổi mật khẩu` / `Change password` (settings:password.title, h2)
  - Primary action: role `button`, name `Đổi mật khẩu` / `Change password` (settings:password.submit, `type=submit`; the h2 has the same text, so use role `button`)
  - Inputs (password inputs have no role, so use label or name): `[name="currentPassword"]` `Mật khẩu hiện tại` / `Current password` (autocomplete `current-password`); `[name="newPassword"]` `Mật khẩu mới` / `New password` (hint settings:password.hint); `[name="confirm"]` `Nhập lại mật khẩu mới` / `Repeat new password`. Labels get a `*` (required), so use a regex or `[name=…]`. A hidden `input[name="username"]` holds the email for password managers.
  - Show/hide: role `button`, `Hiện mật khẩu` / `Show password` (auth:password.show), `Ẩn mật khẩu` / `Hide password` (auth:password.hide); one per field, so three on the form
  - State indicators: field errors `Mật khẩu mới cần ít nhất 8 ký tự` / `The new password must be at least 8 characters` (settings:password.length), auth:validation.* messages, server error Alert (role `alert`), the button's loading state
- **Verification / Triage Notes:** Changing the password logs out all other sessions, so a multi-session test should re-create them afterwards. After success the three fields are cleared. Validation focuses the first wrong field.

## Settings: logged-in devices
- **ID:** `settings-sessions`
- **Source Entry Points:**
  - UI: `client/src/features/settings/SessionsList.tsx`, `client/src/features/settings/device.ts`, `client/src/components/ConfirmDialog.tsx`
  - API / state: `client/src/features/settings/settingsApi.ts` (`getSessions`, `revokeSession`, `revokeOtherSessions`), `server/src/routes/sessions.js` (`GET /api/sessions`, `DELETE /api/sessions/:id`, `DELETE /api/sessions?others=true`), `server/src/services/sessions.js`
  - Bot (if any): none
- **Sub-features:**
  - `Device list`: newest first; name is `<browser> · <system>` from the user agent (for example `Chrome · Windows`), else `Thiết bị không rõ` / `Unknown device`; secondary line `<ip> · dùng lần cuối <date>` / `<ip> · last used <date>`.
  - `This device`: a chip `Thiết bị này` / `This device` (settings:sessions.thisDevice), with no logout button. This device logs out from the account menu.
  - `Log out one device`: icon button, then a confirm dialog.
  - `Log out other devices`: button (only when other devices exist), then a confirm dialog.
- **User Navigation Path:**
  1. Open `/settings` (see `settings-page`)
  2. In the region `Thiết bị đang đăng nhập` / `Logged-in devices`, click the logout icon button of a device (or `Đăng xuất các thiết bị khác` / `Log out other devices`)
  3. Confirm in the dialog → wait for the snackbar
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/settings`
  - Container: region named by h2 `Thiết bị đang đăng nhập` / `Logged-in devices` (settings:sessions.title); the list is role `list`
  - Primary action: role `button`, name `Đăng xuất các thiết bị khác` / `Log out other devices` (settings:sessions.logoutOthers); per-device icon button, aria-label `Đăng xuất {device}` / `Log out {device}` (settings:sessions.revoke)
  - Dialog: role `dialog` titled `Đăng xuất thiết bị?` / `Log out device?` (settings:sessions.revokeTitle) or `Đăng xuất các thiết bị khác?` / `Log out other devices?` (settings:sessions.logoutOthersTitle); buttons `Huỷ` / `Cancel` (focused first) and `Đăng xuất` / `Log out` (settings:sessions.confirm)
  - State indicators: loading text `Đang tải…` / `Loading…`; error Alert `Không tải được danh sách thiết bị.` / `Could not load the device list.` with button `Thử lại` / `Try again` (settings:sessions.retry); text `Chỉ có thiết bị này đang đăng nhập.` / `Only this device is logged in.` when there are no others; snackbars `Đã đăng xuất {device}` / `Logged out {device}` and `Đã đăng xuất các thiết bị khác` / `Other devices logged out`
- **Verification / Triage Notes:** To see other devices, a test must create extra sessions (extra logins as the same user). Two sessions with the same browser and system show the same `{device}` name, so the per-device buttons then share an accessible name; scope by list item. After success, focus moves to the h2.

## Admin: users
- **ID:** `admin-users`
- **Source Entry Points:**
  - UI: `client/src/features/admin/AdminUsersPage.tsx`, `client/src/features/admin/tableSx.ts`, `client/src/components/ConfirmDialog.tsx`; guard `client/src/auth/AdminRoute.tsx` (route in `client/src/features/admin/routes.tsx`)
  - API / state: `client/src/features/admin/adminApi.ts` (`getAdminUsers`, `updateAdminUser`, `getAdminStats`), `server/src/routes/admin.js` (`GET /api/admin/users`, `PATCH /api/admin/users/:id`, `GET /api/admin/stats`; `requireAuth` plus `requireRole('admin')`), `server/src/services/admin.js`
  - Bot (if any): none
- **Sub-features:**
  - `System stats`: four cards in a `dl`: users, active in 7 days, linked chats (with a Telegram/WhatsApp/Zalo breakdown), transactions (with a source breakdown).
  - `Search and filters`: search text, role filter and status filter. They apply when the form is submitted (Enter or the button), not on each keystroke.
  - `User table`: 20 per page, with role chip (`Người dùng` / `User`, `Quản trị viên` / `Administrator`), status chip (`Đang hoạt động` / `Active`, `Đã khoá` / `Locked`) and a `(bạn)` / `(you)` mark on your own row.
  - `Lock / unlock`: lock logs the user out everywhere; each action goes through a confirm dialog.
  - `Make / remove admin`: the change applies within 15 minutes (per the dialog text).
  - `Pagination`: shown only when there is more than one page.
  - Only the actions that change something are offered per row (no `Khoá` on a locked account).
- **User Navigation Path:**
  1. Open `/login`, sign in as an admin → wait for the app shell
  2. Click navigation link `Quản trị người dùng` / `Manage users` (common:nav.adminUsers; shown only for admins), or open `/admin/users`
  3. Wait for heading level 1 `Quản trị người dùng` / `Manage users`
  4. Click a row action, then confirm in the dialog
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/admin/users`. A non-admin sees the forbidden page: heading `Không có quyền truy cập` / `Access denied` text from `common:forbidden.title` (en wording not read; use the key), body `common:forbidden.body`.
  - Container: heading level 1 `Quản trị người dùng` / `Manage users` (admin:users.title); search landmark role `search`; table region (role `region`, focusable) named by its caption `Số người dùng tìm thấy: {N}` / `Users found: {N}` (admin:users.caption)
  - Primary action: row buttons, aria-label `<action> <user name>`: `Khoá {name}` / `Lock {name}`, `Mở khoá {name}` / `Unlock {name}`, `Cấp quyền quản trị {name}` / `Make admin {name}`, `Bỏ quyền quản trị {name}` / `Remove admin {name}` (admin:users.lock, unlock, makeAdmin, removeAdmin)
  - Inputs: `[name="q"]` role `searchbox`, `Tìm theo tên hoặc email` / `Search by name or email` (max 100); `[name="role"]` role `combobox` (native select), `Vai trò` / `Role`, options `Tất cả` / `All`, `Người dùng` / `User`, `Quản trị viên` / `Administrator`; `[name="status"]` role `combobox`, `Trạng thái` / `Status`, options `Tất cả` / `All`, `Đang hoạt động` / `Active`, `Đã khoá` / `Locked`; submit button `Tìm` / `Search` (admin:users.apply)
  - Dialog: role `dialog` with the title from `admin:users.confirm.<action>.title` (for example `Khoá tài khoản này?` / `Lock this account?`) and message with name and email; buttons `Huỷ` / `Cancel` (focused first) and a confirm button named like the action (`Khoá` / `Lock`, `Mở khoá` / `Unlock`, `Cấp quyền quản trị` / `Make admin`, `Bỏ quyền quản trị` / `Remove admin`); lock and remove-admin are styled destructive
  - Pagination: role `navigation` (MUI Pagination), buttons aria-label `Trang {n}` / `Page {n}`, `Trang đầu` / `First page`, `Trang cuối` / `Last page`, `Trang sau` / `Next page`, `Trang trước` / `Previous page` (admin:users.pagination.*)
  - State indicators: caption shows `Đang tải…` / `Loading…` until loaded; empty row `Không có người dùng nào khớp với bộ lọc.` / `No users match these filters.`; error Alert (`errors:GENERIC` text) with button `Thử lại` / `Retry` (admin:retry); snackbars `admin:users.done.<action>` (for example `Đã khoá {name} và đăng xuất trên mọi thiết bị.` / `{name} is locked and logged out everywhere.`); error snackbar from the API code, e.g. `LAST_ADMIN`
- **Verification / Triage Notes:** Needs a seeded admin user and at least one other user (two for pagination: more than 20 users). Locking or demoting the last admin fails with `LAST_ADMIN`. A row for your own account also offers lock and remove-admin. Role changes take effect in the target user's session within 15 minutes (token lifetime), so a test of the promoted user's access should log in again. Pressing Search with the same filters again refetches. There are no runtime feature switches or flags in the admin area; it contains users, stats and default categories only.

## Admin: default categories
- **ID:** `admin-categories`
- **Source Entry Points:**
  - UI: `client/src/features/admin/AdminCategoriesPage.tsx`, `client/src/features/admin/TemplateDialog.tsx`, `client/src/features/admin/tableSx.ts`, `client/src/components/ConfirmDialog.tsx`; guard `client/src/auth/AdminRoute.tsx`
  - API / state: `client/src/features/admin/adminApi.ts` (`getTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`), `server/src/routes/admin.js` (`GET/POST /api/admin/categories`, `PATCH/DELETE /api/admin/categories/:id`), `server/src/services/admin.js`; keyword and text limits come from `server/src/routes/categories.js` (`keywordList`, `uiText`)
  - Bot (if any): none (the keywords are what the bots match against, per the field label)
- **Sub-features:**
  - `Type tabs`: `Chi` / `Expense` and `Thu` / `Income`.
  - `Template table`: Vietnamese name with colour dot and a `Mục dự phòng` / `Fallback` chip, English name, bot keywords as chips (`—` when none).
  - `Add category`: opens the dialog for the selected type.
  - `Edit`: opens the dialog with the template's values.
  - `Delete`: confirm dialog; not offered for the fallback category. Existing users keep their copies.
  - `Template dialog` (see `admin-template-dialog` section below).
- **User Navigation Path:**
  1. Open `/login`, sign in as an admin → wait for the app shell
  2. Click navigation link `Danh mục mặc định` / `Default categories` (common:nav.adminCategories; admins only), or open `/admin/categories`
  3. Wait for heading level 1 `Danh mục mặc định` / `Default categories`
  4. Pick a tab, then click `Thêm danh mục` / `Add category`, or a row `Sửa` / `Edit` or `Xoá` / `Delete`
- **Shortcuts:** none. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/admin/categories` (non-admins see the forbidden page)
  - Container: heading level 1 `Danh mục mặc định` / `Default categories` (admin:categories.title); intro text `admin:categories.intro`; tablist aria-label `Loại danh mục` / `Category type` (admin:categories.typeTabs); role `tabpanel` named by the selected tab; table region (role `region`, focusable) named by its caption `Số danh mục mặc định: {N}` / `Default categories: {N}` (admin:categories.caption)
  - Primary action: role `button`, name `Thêm danh mục` / `Add category` (admin:categories.add)
  - Tabs: role `tab`, `Chi` / `Expense`, `Thu` / `Income` (admin:categories.types.*)
  - Row actions: role `button`, aria-label `Sửa {Vietnamese name}` / `Edit {Vietnamese name}` (admin:categories.edit) and `Xoá {Vietnamese name}` / `Delete {Vietnamese name}` (admin:categories.delete). The label always uses the template's Vietnamese name, in both UI languages. The delete button is absent on the fallback row.
  - Delete dialog: role `dialog` named `Xoá danh mục mặc định này?` / `Delete this default category?` (admin:categories.confirmDelete.title); buttons `Huỷ` / `Cancel` (focused first) and `Xoá` / `Delete`
  - State indicators: caption `Đang tải…` / `Loading…` before load; error Alert (`errors:GENERIC` text); snackbars `Đã lưu danh mục mặc định.` / `Default category saved.` and `Đã xoá {name}. …` / `{name} deleted. …` (admin:categories.deleted); error snackbar from the API code
- **Verification / Triage Notes:** Needs a seeded admin and the seeded default categories (each type has one fallback, `Khác` / `Other`, that can't be deleted). The page's tab and dialog state is local, not in the URL. The tab content refetches when you switch type.

## Admin: default category dialog
- **ID:** `admin-template-dialog`
- **Source Entry Points:**
  - UI: `client/src/features/admin/TemplateDialog.tsx` (mounted only while open, so each opening starts fresh)
  - API / state: `client/src/features/admin/adminApi.ts` (`createTemplate`, `updateTemplate`), `server/src/routes/admin.js` (`POST /api/admin/categories`, `PATCH /api/admin/categories/:id`)
  - Bot (if any): none
- **Sub-features:**
  - `Add / edit`: the title shows `Danh mục chi mới` / `New expense category`, `Danh mục thu mới` / `New income category` or `Sửa danh mục mặc định` / `Edit default category`. A template keeps its type.
  - `Keywords`: comma-separated, at most 50 keywords of at most 40 characters; a native custom validity message blocks submit otherwise.
  - `Close`: Cancel and Escape close it; a click on the backdrop does not. Full screen on a phone (below `sm`).
- **User Navigation Path:**
  1. Open `/admin/categories` (see `admin-categories`)
  2. Click `Thêm danh mục` / `Add category`, or a row's `Sửa {name}` / `Edit {name}`
  3. Fill the fields and click `Lưu` / `Save` → dialog closes and snackbar `Đã lưu danh mục mặc định.` / `Default category saved.`
- **Shortcuts:** Escape closes the dialog. **Bot commands:** none.
- **Programmatic Selectors:**
  - Route: `/admin/categories` (dialog over the page)
  - Container: role `dialog`, named by its title (admin:categories.addTitle.expense / addTitle.income / editTitle)
  - Primary action: role `button`, name `Lưu` / `Save` (admin:categories.save, `type=submit`; loading state while saving)
  - Secondary action: role `button`, name `Huỷ` / `Cancel` (common:cancel)
  - Inputs: `[name="vi"]` role `textbox`, `Tên tiếng Việt` / `Vietnamese name` (required, auto-focused, max 40); `[name="en"]` role `textbox`, `Tên tiếng Anh` / `English name` (required, max 40); `[name="keywords"]` role `textbox`, `Từ khoá cho bot` / `Bot keywords` (helper admin:categories.keywordsHelp, custom error admin:categories.keywordsTooLong); `[name="icon"]` role `textbox`, `Biểu tượng` / `Icon` (helper: Material icon name, for example `Restaurant`); `[name="color"]` `input[type=color]`, `Màu` / `Colour`, default `#9e9e9e`. Required fields get a `*` in the label, so use a regex or `[name=…]`.
  - State indicators: error Alert with role `alert` showing the `errors` text for the API code (for example `VALIDATION_ERROR`, `NAME_TAKEN`); loading state on the Save button
- **Verification / Triage Notes:** Requires an admin session. The browser's native validation runs before submit (empty required fields). Changes here don't alter existing users' categories, only new accounts' copies.

## Telegram bot
- **ID:** `bot-telegram`
- **Source Entry Points:**
  - API / state: `server/src/routes/webhooks.js` (route `/telegram`), `server/src/bot/telegram.js` (`handleTelegramUpdate`, `pressButton`, `telegram` adapter), shared logic in `server/src/bot/core.js`
  - Bot: `server/src/bot/telegram.js`; webhook registration `server/src/scripts/setWebhooks.js`
  - Scripted steps: `tools/bot-e2e/scenarios.json` (TG-01 to TG-11)
- **Sub-features:**
  - `Private chats only`: updates whose `message.chat.type` is not `private` are ignored (a group would expose the money).
  - `Draft buttons`: each draft is sent with an inline keyboard ✅ save, ❌ discard and, only when `APP_URL` starts with `https://`, ✏️ (a URL button to `<APP_URL>/bot`).
  - `Button press`: on success the draft message is edited into the result text (buttons removed); on failure `answerCallbackQuery` shows the reason (max 200 chars). Every press is answered.
  - `Photos`: largest `message.photo` size, `file_id` is downloaded via `getFile`.
  - `Non-text messages` (stickers etc.): treated as empty text, so they get the help reply (or the link instructions when unlinked).
  - `Deep link`: `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<CODE>` makes Telegram send `/start CODE`.
- **User Navigation Path:**
  1. Web app `/bot` page, create a link code (`POST /api/chat-links/code`), open the Telegram link, tap Start (sends `/start <CODE>`) → reply starts with "Đã liên kết với tài khoản" (TG-01)
  2. Send `phở 45k` → reply "📝 Chi 45.000 ₫ ..." with buttons "✅ Lưu" / "❌ Huỷ" (TG-02)
  3. Press "✅ Lưu" → message becomes "✅ Đã lưu: Chi 45.000 ₫ ..." (TG-03)
  4. Send two lines `grab 32k` / `cafe 25k` → two drafts (TG-04); press "❌ Huỷ" → "❌ Đã huỷ: ..." (TG-05)
  5. Send `/today` → "📅 Hôm nay ... Chi: ..." (TG-07)
  6. Send `xin chào` → help text, nothing stored (TG-08); send `/start ABC234` when linked → `alreadyLinked` (TG-09)
- **Shortcuts / Bot commands:** Telegram: `/start CODE` (link), `/link CODE`, `/today`, `/month`, `/lang vi` | `/lang en`, `/help`; `/start` with no code and any unknown command return the help text; `/today@botname` form is accepted. Typed `ok` / `huy` also work (see `bot-capture`). Photo upload (see `bot-receipt-photos`).
- **Programmatic Selectors:**
  - Route: `POST /api/webhooks/telegram` (200 at once, work continues in background; 401 `UNAUTHENTICATED` on bad secret)
  - Auth header: `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET`
  - Update shapes: `update.message` (`text`, `photo[]`), `update.callback_query`
  - Callback data: `c:<24-hex transaction id>` (confirm), `x:<24-hex id>` (discard); regex `^([cx]):([0-9a-f]{24})$`; ✏️ is a URL button, not a callback
  - Button labels: vi `✅ Lưu` / `❌ Huỷ` / `✏️ Sửa`, en `✅ Save` / `❌ Discard` / `✏️ Edit` (`messages.*.buttons.save/discard/edit`)
  - Reply keys: `draft`, `saved`, `discarded`, `notFound`, `alreadyConfirmed`, `today`, `month`, `help`, `linked`, `alreadyLinked`, `pleaseLink`, `tapToLink`, `locked`
- **Verification / Triage Notes:** Staging has no bots: the webhook points at production, so bot flows are tested only against production or the real-chat script `tools/bot-e2e/bot-e2e.mjs` (needs a fresh code from `bot-e2e.mjs code`). Linked account language (`user.language`) picks the reply language. Locked web account gets `locked` for every message. Replies pass `maySend` (monthly quota gate) except capture and link kinds.

## Zalo bot
- **ID:** `bot-zalo`
- **Source Entry Points:**
  - API / state: `server/src/routes/webhooks.js` (route `/zalo`), `server/src/services/channelUsage.js` (`recordSend`, quota counter)
  - Bot: `server/src/bot/zalo.js` (`handleZaloEvent`, `zalo` adapter), `server/src/bot/core.js`
  - Scripted steps: `tools/bot-e2e/scenarios.json` (ZL-01 to ZL-14)
- **Sub-features:**
  - `No buttons`: a draft is the text plus `replyHint`; the user answers by typing `ok`, `huy` or a new amount.
  - `Amount-only correction`: a single line with only an amount (note empty, e.g. `55k`) while a draft waits edits that draft's amount (`correctDraft`, same service as `PATCH /transactions/:id`) and resends it.
  - `Pending order`: `ok` / `huy` act on `chatLinks.pendingTransactionId` or else the newest waiting draft from the chat; the reply names the next waiting draft (`nextPending`).
  - `Monthly quota`: every sent message is counted (`recordSend('zalo')`); free plan 3,000/month; non-capture/link replies stop when nearly used up.
  - `Private chats only`: `chat_type` must be `PRIVATE`; only text and image events are handled.
  - `Link`: the Zalo link from the Bot page (`ZALO_BOT_URL`) carries no data, so the user pastes `/link CODE`.
- **User Navigation Path:**
  1. Open the Zalo bot from the web `/bot` page link, send `/link <CODE>` → "Đã liên kết với tài khoản" (ZL-01)
  2. Send `grab 32k` → "📝 Chi 32.000 ₫ ..." ending with the "ok / huy" hint (ZL-02)
  3. Send `ok` → "✅ Đã lưu: ..." (ZL-03)
  4. Send `cafe 25k`, then `huy` → "❌ Đã huỷ: ..." (ZL-04, ZL-05)
  5. Send `ok` with nothing waiting → "Không có khoản nháp nào đang chờ." (ZL-06)
  6. Send two lines `an sang 30k` / `tra sua 40k` → two drafts; `ok` saves newest and names the next; second `ok` saves the older (ZL-10 to ZL-13)
  7. Send `/month` (ZL-07, ZL-14)
- **Shortcuts / Bot commands:** Zalo: `/link CODE`, `/start CODE`, `/today`, `/month`, `/lang vi|en`, `/help`; typed `ok`, `huy`; a bare amount such as `55k` to correct the waiting draft; photo.
- **Programmatic Selectors:**
  - Route: `POST /api/webhooks/zalo` (401 on bad secret)
  - Auth header: `X-Bot-Api-Secret-Token` = `ZALO_WEBHOOK_SECRET`
  - Events: `body.event_name` = `message.text.received` (text) or `message.image.received` (`message.photo_url`, older `message.photo`); body may be wrapped in `{ result }`
  - Callback data / buttons: none (no buttons)
  - Typed words (normalized, accent-insensitive): `ok`, `huy` (so "huỷ" also matches)
  - Reply keys: `draft`, `replyHint`, `nextPending`, `nothingPending`, `saved`, `discarded`, `today`, `month`, `help`, `linked`, `alreadyLinked`, `pleaseLink`, `tapToLink`, `invalidCode`
- **Verification / Triage Notes:** Staging has no bots (webhook points at production). Zalo ids are stable per user; chat id is `message.chat.id`. Messages delivered twice are deduplicated through the unique `chatRef` (`<messageId>:<line>`).

## WhatsApp bot
- **ID:** `bot-whatsapp`
- **Source Entry Points:**
  - API / state: `server/src/routes/webhooks.js` (routes `GET` and `POST /whatsapp`), `server/src/config/env.js` (`whatsappConfigured`)
  - Bot: `server/src/bot/whatsapp.js` (`handleWhatsAppWebhook`, `whatsapp` adapter), `server/src/bot/core.js`
- **Sub-features:**
  - `Webhook verification`: Meta's setup GET is answered with `hub.challenge` only when `hub.mode=subscribe` and the verify token matches (else 403 `FORBIDDEN`).
  - `Signed POST`: `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256 of the raw body with the app secret; bad or missing gives 401. 503 `FEATURE_NOT_CONFIGURED` when any of the four WhatsApp settings is missing.
  - `BSUID keys`: chat is keyed by `message.from_user_id`; the phone number is never read or stored; replies go to that id.
  - `Reply buttons`: ✅ save, ❌ discard, ✏️ edit (✏️ only when `APP_URL` set; answered with `<APP_URL>/bot` as a message). The result is a new message (WhatsApp can't edit).
  - `Ignored`: group messages, `reaction`, `system`, `statuses[]`, fields other than `messages`.
  - `Long replies`: split in pieces of 4096 chars; button message body cut at 1024.
  - `Deep link`: `https://wa.me/<WHATSAPP_NUMBER>?text=/link <CODE>` (URL-encoded), only when WhatsApp is fully configured.
- **User Navigation Path:**
  1. Web `/bot` page, create a link code, open the WhatsApp link (text `/link <CODE>` prefilled), send → linked reply
  2. Send `phở 45k` → interactive message with buttons "✅ Lưu", "❌ Huỷ", "✏️ Sửa"
  3. Tap "✅ Lưu" → new message "✅ Đã lưu: ..."
  4. Send `/today` or `/month`
- **Shortcuts / Bot commands:** WhatsApp: `/link CODE`, `/start CODE`, `/today`, `/month`, `/lang vi|en`, `/help`; typed `ok`, `huy`; photo. Non-text message types get the help reply.
- **Programmatic Selectors:**
  - Route: `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`; `POST /api/webhooks/whatsapp` (200 always once signed)
  - Auth: query `hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`; header `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`
  - Payload: `entry[].changes[].value.messages[]`, `message.type` = `text` | `image` | `interactive` (`button_reply.id`)
  - Button reply ids: `c:<24-hex id>` confirm, `x:<24-hex id>` discard, `e:<24-hex id>` edit (opens `<APP_URL>/bot`); regex `^([cxe]):([0-9a-f]{24})$`
  - Button titles: vi `✅ Lưu` / `❌ Huỷ` / `✏️ Sửa`, en `✅ Save` / `❌ Discard` / `✏️ Edit`
  - Reply keys: same as Telegram
- **Verification / Triage Notes:** Staging has no bots (webhook points at production). No WhatsApp steps exist in `tools/bot-e2e/scenarios.json` (only TG and ZL), so WhatsApp flows are (unverified) by script. Webhook is off without all four WhatsApp env settings.

## Bot capture (text to draft, ok / huy, corrections)
- **ID:** `bot-capture`
- **Source Entry Points:**
  - API / state: `server/src/services/transactions.js` (`parseTransactions`, `confirmTransaction`, `updateTransaction`), `server/src/routes/transactions.js` (`POST /api/transactions/parse`, `POST /api/transactions/:id/confirm`)
  - Bot: `server/src/bot/core.js` (`handleMessage`, `handleButton`, `createDrafts`, `answerPending`, `correctDraft`, `confirm`, `discard`), `server/src/bot/parser.js` (`parseText`, `parseLine`)
- **Sub-features:**
  - `One line, one draft`: first 10 non-empty lines of a message are parsed; each line with an amount becomes a draft (`status: draft`, `source` = platform, `chatRef` = platform + chat id + `<messageId>:<line>`, unique so redeliveries make no duplicate).
  - `Lines without an amount`: reported with `noAmountLines` (line numbers, max amount); no line at all with an amount gives the help text.
  - `Amount syntax`: `45k`, `45 k`, `1tr`, `1.5tr`, `1tr2`, `150.000`, `150000đ`; bare `45` is read as 45,000 (a guess shown in the draft); year/month after "năm"/"tháng" is a date, not money.
  - `Income`: line starting with `+`, words `luong thuong nhan salary bonus received`, or a matching income category keyword; otherwise expense.
  - `Date words`: `hôm qua` / `hqua` / `yesterday`, `dd/mm`, `dd/mm/yyyy`.
  - `Wallet and category`: a word equal to a wallet alias (`mm`, `tm`, `ck`...) picks the wallet, else the user's default wallet, else the first; category by longest whole-word keyword, else the fallback category; leftover words are the note (max 200 chars).
  - `ok` / `huy`: typed, accent-insensitive, confirm or discard the pending draft (all platforms; the only way on Zalo).
  - `Confirm`: same service as the web, adds a budget warning line (`budgetWarning`, over at 100%).
  - `Discard`: soft delete of a draft only.
  - `Correction`: Zalo only, bare-amount reply edits the waiting draft; Telegram and WhatsApp use the ✏️ button which opens the web Bot inbox `/bot`.
  - `Locked user`: web-locked accounts get `locked` and nothing is recorded.
- **User Navigation Path:**
  1. Linked chat: send `phở 45k` → draft message "📝 Chi 45.000 ₫ · <category> · <wallet> · <date> · phở"
  2. Telegram/WhatsApp: tap "✅ Lưu" or "❌ Huỷ"; Zalo: reply `ok` or `huy`
  3. Optional correction: Zalo reply `55k`; Telegram/WhatsApp tap "✏️ Sửa" (opens web `/bot`)
  4. Multi-line: send `grab 32k` + newline + `cafe 25k` → two drafts
- **Shortcuts / Bot commands:** All platforms: free text lines `<note> <amount> [wallet alias] [hôm qua|dd/mm]`, `+<note> <amount>` for income, `ok`, `huy`. Zalo only: bare amount (e.g. `55k`).
- **Programmatic Selectors:**
  - Route: none of its own (arrives via the webhooks)
  - Telegram callback data: `c:<id>` / `x:<id>`; WhatsApp button ids: `c:<id>` / `x:<id>` / `e:<id>`
  - Typed words: `ok`, `huy`
  - Reply keys: `draft`, `replyHint`, `buttons.save/discard/edit`, `nextPending`, `saved`, `discarded`, `notFound`, `alreadyConfirmed`, `nothingPending`, `noAmountLines`, `overallBudget`, `budgetWarning`, `help`, `locked`, `expense`, `income`
  - Reply text (vi): `📝 …`, `✅ Đã lưu: …`, `❌ Đã huỷ: …`, `Không có khoản nháp nào đang chờ.`, `Không tìm thấy khoản nháp này.`, `Khoản này đã được lưu rồi.`
- **Verification / Triage Notes:** Web quick add and bots share `parseText`; web preview is `POST /api/transactions/parse` (max 2000 chars). Draft amounts are checked 1 to 10^13 ₫. Scripted checks: TG-02..06, ZL-02..06, ZL-10..14.

## Bot reports and commands
- **ID:** `bot-reports`
- **Source Entry Points:**
  - API / state: `server/src/services/stats.js` (`daily`, `monthSummary`), `server/src/services/budgets.js` (`listBudgets`), `server/src/services/users.js` (`updateMe`)
  - Bot: `server/src/bot/core.js` (`runCommand`, `readCommand`)
- **Sub-features:**
  - `/today`: today's expense and income (Asia/Ho_Chi_Minh day) from the same statistics as the dashboard; confirmed transactions only.
  - `/month`: month expense and income, the overall budget usage, then each category budget fullest first (also when there is no overall budget).
  - `/lang vi|en`: sets the user's language, same setting as web Settings; replies `languageSet`.
  - `/help`: help text; also the reply to `/start` without a code and to any unknown command, and to text with no amount.
  - Command parsing: `/cmd`, `/cmd@botname`, case-insensitive, argument after whitespace.
- **User Navigation Path:**
  1. In a linked chat send `/today` → "📅 Hôm nay dd/mm/yyyy / Chi: … / Thu: …"
  2. Send `/month` → "📅 Tháng mm/yyyy / Chi / Thu / Ngân sách …"
  3. Send `/lang en` → "Switched to English."; `/lang vi` → "Đã chuyển sang tiếng Việt."
- **Shortcuts / Bot commands:** Telegram, Zalo, WhatsApp (identical): `/today`, `/month`, `/lang vi`, `/lang en`, `/help`. No `/hoi` or assistant command exists in code.
- **Programmatic Selectors:**
  - Route: none (via the webhooks)
  - Commands: `/today`, `/month`, `/lang <vi|en>`, `/help`
  - Reply keys: `today`, `month` (`Tháng`/`Month`, `Ngân sách`/`Budget`), `languageSet`, `help`, `overallBudget`, `budgetWarning`
  - vi help text: "Gửi mỗi khoản trên một dòng ... Lệnh: /today (hôm nay), /month (tháng này), /lang vi|en, /help"
- **Verification / Triage Notes:** TG-07 (`/today`), ZL-07, ZL-14 (`/month`). Seed confirmed transactions first; drafts are not counted. Replies of kind `other` are skipped by `maySend` when the platform's monthly quota is nearly used up.

## Bot linking (link codes, deep links, claim links)
- **ID:** `bot-linking`
- **Source Entry Points:**
  - UI: `client/src/features/bot`, `client/src/features/link` (owned by the web scanners; the `/link?t=<token>` screen and the `/bot` page)
  - API / state: `server/src/routes/chatLinks.js` (mounted at `/api/chat-links`), `server/src/services/chatLinks.js`
  - Bot: `server/src/bot/core.js` (`linkChat`, `linkInstructions`, `sendLinked`)
- **Sub-features:**
  - `Link code`: `POST /api/chat-links/code` → `{ code, expiresAt, links: { telegram, whatsapp, zalo } }`; 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 10 minutes, single use, hashed; limit 5 per user per 10 minutes (429 `RATE_LIMITED`).
  - `Deep links`: Telegram `https://t.me/<bot>?start=<CODE>` (sends `/start CODE`); WhatsApp `https://wa.me/<number>?text=/link <CODE>`; Zalo is `ZALO_BOT_URL` with no data (user pastes `/link CODE`). A link is `null` when its setting is missing.
  - `Redeem`: `/start CODE` or `/link CODE` from an unlinked chat creates the ChatLink; wrong or expired gives `invalidCode` plus the claim link; already linked gives `alreadyLinked` (a chat stays on its first account).
  - `Claim link`: any message from an unlinked chat is answered with (bilingual) `pleaseLink` + `tapToLink` `<APP_URL>/link?t=<token>` (32 base64url chars, 10 minutes, single use, one live link per chat; no token without `APP_URL`).
  - `Claim`: `POST /api/chat-links/claim/preview` `{ token }` → `{ platform, displayName }`; `POST /api/chat-links/claim` `{ token }` → 201 ChatLink, then the bot messages the chat `linked`; 404 `LINK_TOKEN_INVALID`, 409 `CHAT_ALREADY_LINKED`.
  - `List / unlink`: `GET /api/chat-links`, `DELETE /api/chat-links/:id` (204; also kills the chat's pending claim link), `PATCH /api/chat-links/:id/claim-notice` (204, dismisses the "Not you? Unlink" notice).
  - Unlinked chats store nothing except the claim row; the message text is not kept.
- **User Navigation Path:**
  1. Web: open `/bot`, create a link code (`POST /api/chat-links/code`), open the Telegram / WhatsApp link, or in Zalo send `/link <CODE>`
  2. Or from an unlinked chat send any message, tap the `<APP_URL>/link?t=<token>` link, sign in on the web and confirm (claim)
  3. Chat replies "✅ Đã liên kết với tài khoản <name>. Thử gửi: phở 45k"
- **Shortcuts / Bot commands:** `/start CODE`, `/link CODE` (all three platforms; Telegram deep link sends `/start CODE`, WhatsApp deep link prefills `/link CODE`).
- **Programmatic Selectors:**
  - Routes: `POST /api/chat-links/code`, `GET /api/chat-links`, `DELETE /api/chat-links/:id`, `POST /api/chat-links/claim/preview`, `POST /api/chat-links/claim`, `PATCH /api/chat-links/:id/claim-notice` (all need a JWT)
  - Web claim route: `/link?t=<token>`; Bot page: `/bot`
  - Reply keys: `linked`, `invalidCode`, `alreadyLinked`, `pleaseLink`, `tapToLink`, `locked`
- **Verification / Triage Notes:** Code expires in 10 minutes; `bot-e2e.mjs code` makes a fresh one (TG-01, ZL-01, TG-09 for the refusal). Staging has no bots, so the chat half cannot be run there. The claim message (`sendLinked`) is sent after the 201 response; a failed send is only logged.

## Receipt photos
- **ID:** `bot-receipt-photos`
- **Source Entry Points:**
  - API / state: `server/src/routes/receipts.js` (`POST /api/receipts`), `server/src/services/receipts.js` (`createReceiptDraft`, `analyzeReceipt`, `imageType`)
  - Bot: `server/src/bot/core.js` (`readReceipt`); downloads in each adapter's `downloadPhoto`
- **Sub-features:**
  - `Chat photo`: a photo in a linked chat gets "🧾 Đang đọc hoá đơn…", then a draft (merchant, total, category) with the platform's buttons; a second line `🧾 N dòng hàng · …` says whether line items add up to the total.
  - `Web upload`: `POST /api/receipts`, multipart field `image`, max 4.5 MB → 201 `{ transaction }` (draft, source "receipt"); 400 missing field, 413 too big.
  - `KIE service`: `POST ${KIE_URL}/analyze` with `X-KIE-Key`, 120 s timeout; errors 502 `KIE_UNAVAILABLE`, 504 `KIE_TIMEOUT`, 422 `RECEIPT_UNREADABLE`, 503 `FEATURE_NOT_CONFIGURED`.
  - `Fallback`: no AI fallback; unreadable (422 or 415, not JPEG/PNG) gives `receiptUnreadable`, other failures `receiptUnavailable`; both ask the user to type the amount.
  - `Dedup`: a redelivered photo (same `chatRef`) is not read twice.
- **User Navigation Path:**
  1. Linked chat (Telegram or Zalo), send a receipt photo (JPEG/PNG)
  2. Bot replies "🧾 Đang đọc hoá đơn…"
  3. After about 20 s a draft arrives with "✅ Lưu" / "❌ Huỷ" (Telegram), or with the "ok / huy" hint (Zalo)
  4. Confirm or discard (TG-10, TG-11, ZL-08, ZL-09)
- **Shortcuts / Bot commands:** Send a photo (Telegram `message.photo`, Zalo `message.image.received`, WhatsApp `message.type=image`). No command.
- **Programmatic Selectors:**
  - Route: `POST /api/receipts` (JWT, multipart `image`); chat photos arrive via the webhooks
  - Reply keys: `readingReceipt`, `receiptItems`, `receiptUnreadable`, `receiptUnavailable`, `draft`
  - Scripted: `node tools/bot-e2e/bot-e2e.mjs ... --photo <server/test/fixtures/receipts/*.jpg>`, wait up to 60 s
- **Verification / Triage Notes:** Needs `KIE_URL` / `KIE_API_KEY`; the e2e KIE is stubbed or absent on staging (unverified). A photo needs about 20 s, up to 120 s when queued. Receipt photos are not covered by a WhatsApp scenario.

## Webhook API entry points
- **ID:** `webhooks-api`
- **Source Entry Points:**
  - API / state: `server/src/routes/webhooks.js`, mounted at `/api/webhooks` in `server/src/routes/index.js`; raw body kept for WhatsApp in `server/src/app.js`
  - Registration: `server/src/scripts/setWebhooks.js`
- **Sub-features:**
  - `POST /api/webhooks/telegram`: checks `X-Telegram-Bot-Api-Secret-Token`, answers 200, then `handleTelegramUpdate` runs in `waitUntil`.
  - `POST /api/webhooks/zalo`: checks `X-Bot-Api-Secret-Token`, answers 200, then `handleZaloEvent`.
  - `GET /api/webhooks/whatsapp`: Meta verification handshake (query logged without the token).
  - `POST /api/webhooks/whatsapp`: HMAC `X-Hub-Signature-256`, answers 200, then `handleWhatsAppWebhook`.
  - No JWT on any of them; failures after the 200 are only logged (`<platform> webhook update failed:`).
- **User Navigation Path:**
  1. Platform calls the URL (set with `setWebhooks.js` for Telegram and Zalo, in Meta's dashboard for WhatsApp)
  2. Wrong secret or signature → 401 `UNAUTHENTICATED`; WhatsApp not configured → 503 `FEATURE_NOT_CONFIGURED`; wrong verify token → 403 `FORBIDDEN`
- **Shortcuts / Bot commands:** none
- **Programmatic Selectors:**
  - Routes: `POST /api/webhooks/telegram`, `POST /api/webhooks/zalo`, `GET /api/webhooks/whatsapp`, `POST /api/webhooks/whatsapp`
  - Env: `TELEGRAM_WEBHOOK_SECRET`, `ZALO_WEBHOOK_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
  - Response: 200 empty body (Telegram, Zalo, WhatsApp POST); WhatsApp GET returns the `hub.challenge` as text/plain
- **Verification / Triage Notes:** Staging has no bots and its webhook points at production. In tests env defaults exist (`test-telegram-secret`, `test-zalo-secret`, `test-whatsapp-*`). Not found in code: an assistant command (`/hoi`) and any WhatsApp e2e scenario, so neither has an entry. `docs/testing/bot-e2e.md` was not read; names above come from code and `scenarios.json`.
