# 5. Frontend (React + Vite + TypeScript)

## 5.1 Structure

Created from Vite's `react-ts` template. All source files are `.ts` / `.tsx`.

```text
client/src/
├── main.tsx               # fonts, i18n, createBrowserRouter(routes) → <App>
├── App.tsx                # <Provider store> <AuthProvider> <AppThemeProvider> <RouterProvider>; <Splash> while the session restores
├── router.tsx             # route table (below); one line per feature
├── app/
│   ├── store.ts           # makeStore(): configureStore({ api.reducer, ui }); exports RootState, AppDispatch
│   ├── hooks.ts           # typed useAppDispatch / useAppSelector
│   ├── api.ts             # base RTK Query createApi + baseQueryWithRefresh, tag types, no endpoints
│   └── uiSlice.ts         # themeMode, language, month, snackbar
├── auth/
│   ├── AuthContext.tsx    # AuthProvider: user, accessToken, status, login(), register(), logout(), refresh()
│   ├── useAuth.ts         # AuthContext + useAuth()
│   ├── session.ts         # in-memory access token, shared refresh, postAuth()
│   ├── usersApi.ts        # PATCH /users/me (theme, language, profile)
│   ├── claimToken.ts      # keeps a chat claim token (/link?t=…) out of the address bar until it is used (§5.9.2)
│   ├── ProtectedRoute.tsx # redirect to /login (remembering the requested URL) if not authenticated
│   └── AdminRoute.tsx     # 403 message if role !== 'admin'
├── components/            # AppLayout, NavDrawer, NavList, navItems, BottomNav, UserMenu, BrandMark, Splash, RouteError,
│                          # AppSnackbar, QuickAdd, MoneyText, MonthPicker, ConfirmDialog, EmptyState, ThemeToggle,
│                          # LanguageSwitch, icons.ts (Lucide), initials.ts
├── features/<x>/          # each feature: routes.tsx, pages and dialogs; one with server data also has an *Api.ts
│                          # (api.injectEndpoints + its types; dashboard: statsApi.ts). auth/ and notFound/ have none
│   ├── auth/       # LoginPage, RegisterPage, AuthLayout, PasswordField, useAuthForm, validation.ts
│   ├── dashboard/  transactions/  wallets/  categories/  budgets/
│   ├── bot/        # BotInboxPage, LinkCard, LinkedAccounts, DraftList, DraftCard, ReceiptUpload, resizeImage.ts, qrCode.ts
│   ├── link/       # LinkPage: confirm a link that started in the chat (/link)
│   ├── settings/   # SettingsPage, ProfileForm, PasswordForm, SessionsList, PreferencesForm
│   ├── admin/      # AdminUsersPage, AdminCategoriesPage, TemplateDialog
│   └── notFound/   # NotFoundPage
├── types/api.ts           # shared types: User, Language, ThemeMode, AuthResponse, RegisterInput, UpdateMeInput, ClaimPreview, ApiError + isApiError()
├── i18n/                  # index.ts, errors.ts, format.ts, {vi,en}/<namespace>.json
└── theme/                 # theme.ts (getTheme for light and dark), AppThemeProvider.tsx
```

### TypeScript rules

- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"jsx": "react-jsx"`, path alias `@/* → src/*`.
- **API types** mirror the response shapes in [04-backend.md](04-backend.md). Shared ones live in `types/api.ts`; each feature's own types sit in its `*Api.ts` (e.g. `transactionsApi.ts`: `type Transaction = { id: string; type: 'expense' | 'income'; amount: number; status: 'draft' | 'confirmed'; source: 'web' | 'telegram' | 'zalo' | 'receipt'; … }`). Every RTK Query endpoint is typed `builder.query<ResultType, ArgType>`.
- `ApiError = { error: { code: string; message: string; details?: unknown } }`, with a type guard `isApiError()` used by forms and the error toast.
- Money is `number` (integer VND). A branded type `type Vnd = number & { __brand: 'VND' }` is optional polish.
- Scripts: `npm run typecheck` (`tsc --noEmit` for the app, and for `vite.config.ts` and the e2e tests) runs in `npm run build` and in CI. There is no pre-commit hook. The Vercel build fails on type errors.
- The backend stays plain JavaScript (ES modules), as required by the slides (Express). Only the frontend is TypeScript.

## 5.2 Routes

```jsx
/login, /register                      → public (logged in: /login goes to the remembered URL or /, /register to /)
/link                                  → Link a chat: outside <ProtectedRoute>, logs in by itself (§5.9.2)
/verify-email, /forgot-password        → (planned, §2.12) public, beside /login: enter the emailed code (§5.11.2, §5.11.4)
<ProtectedRoute> + <AppLayout>
  /                → DashboardPage
  /transactions    → TransactionsPage
  /wallets         → WalletsPage
  /categories      → CategoriesPage
  /budgets         → BudgetsPage
  /bot             → BotInboxPage
  /settings        → SettingsPage
  <AdminRoute>
    /admin/users       → AdminUsersPage
    /admin/categories  → AdminCategoriesPage
*                → NotFoundPage
```

Pages are lazy-loaded with the route `lazy` option (each feature's `routes.tsx`), so the first load stays small. While the first page's code downloads the router shows `<Splash />` (`hydrateFallbackElement`); a page that fails to load or crashes shows `<RouteError />` with a Reload button.

- `ProtectedRoute` sends a logged-out visitor to `/login` and remembers the requested URL (path, query string and hash, so transaction filters survive). After login the user lands back there.
- An explicit logout (avatar menu) goes to a plain `/login`, so the next person on that browser starts at `/`.
- If the session ended because an admin locked the account (the refresh answered `ACCOUNT_LOCKED`), the login page shows that message.
- `/register` sends an already logged-in user to `/`.
- `/link` sends a logged-out visitor to `/login` with `state.from: '/link'` (no query string: the claim token waits in `sessionStorage`, §5.9.2). An explicit logout forgets a waiting token.
- *Planned (§2.12):* `/register` lands on `/` after a 201 (as today) or on `/verify-email` after a 202 (§5.11.1). `/verify-email` and `/forgot-password` send a logged-in user to `/`, as `/register` does. The assistant drawer (§2.11) adds no route.

## 5.3 State management (slide requirement 2)

| State | Where | Why |
|---|---|---|
| Logged-in user, access token, auth status | **`AuthContext`** | Required "Context for login". The token lives only in memory (`auth/session.ts`), never in localStorage |
| Server data (wallets, categories, transactions, budgets, stats, drafts, sessions, admin lists) | **Redux Toolkit – RTK Query** (base `app/api.ts`; each feature with server data adds its endpoints in its own `*Api.ts` with `api.injectEndpoints`, e.g. `features/dashboard/statsApi.ts`; `PATCH /users/me` is in `auth/usersApi.ts`) | Caching, loading/error flags, automatic refetch after mutations via tags |
| UI state (theme mode, language, selected month, snackbar) | **Redux Toolkit – `uiSlice`** | Shared across pages; theme and language are mirrored to localStorage. The month is shared by Dashboard and Budgets |
| Transaction filters and page | URL query string (`useSearchParams`) | Shareable, survive reload and the login redirect |
| Form input | Local `useState` in the form component | Keeps forms simple |
| Claim token from `/link?t=` | `sessionStorage`, with a copy in memory in case storage is blocked (`auth/claimToken.ts`); never the URL or `state.from` | It is a one-time credential: it leaves the address bar as the app starts. It survives a reload of the login page, in this tab only; it is forgotten once used, cancelled or dead, and on logout (§5.9.2) |
| *(planned, §2.12)* Email of a pending sign-up (plus the masked address and the name, for "Change it") | `sessionStorage`, **never the password** | `/verify-email` survives a reload in this tab; the password lives only on the server, as a bcrypt hash (§2.12.2 step 4) |
| *(planned, §2.11)* Assistant drawer open or closed, the text being typed | Local `useState` where the drawer is mounted | The thread itself is server data: RTK Query, tag `AssistantThread` (§5.10.6) |

**RTK Query tags:** `Wallet`, `Category`, `Transaction`, `Budget`, `Stats`, `Draft`, `Session`, `ChatLink`, `AdminUser`, `AdminCategory`. Example: creating a transaction invalidates `Transaction`, `Stats`, `Budget` and `Wallet`, so the dashboard, budget bars and wallet balances update automatically. *Planned (§5.10.6):* one more tag, `AssistantThread`.

**Token handling (`baseQueryWithRefresh`):**

1. Add `Authorization: Bearer <accessToken>` (read through the `getAccessToken()` getter in `auth/session.ts`).
2. On a 401 `TOKEN_EXPIRED`, call `POST /api/auth/refresh` once (shared promise, so parallel requests wait for one refresh; a Web Lock makes other tabs take turns). Then retry the original request.
3. If the refresh fails, the session is cleared: `AuthContext` turns anonymous, the RTK Query cache is reset, and `ProtectedRoute` redirects to `/login`.
4. On app start, `AuthProvider` calls `/auth/refresh` to restore the session from the httpOnly cookie; `App` shows a splash screen while it runs.

## 5.4 Responsive layout

- **Desktop (≥ md):** permanent left drawer (nav), top app bar (language, theme, avatar menu), content in a max-width container. The month picker is not in the app bar: it sits in the page header of Dashboard and Budgets only.
- **Mobile (< md):** top app bar plus **bottom navigation** (Dashboard, Transactions, Bot inbox, Budgets, More). There is no floating **+** button: adding happens through QuickAdd (Dashboard, Transactions) or each page's Add button.
- The transaction table becomes a card list below `sm`. Admin tables switch to one card per row when their wrapper is narrower than 600 px (a container query, so it follows the space beside the drawer). Dialogs go full-screen below `sm` (`fullScreen`).
- MUI `Grid` and `useMediaQuery(theme.breakpoints.up('md'))` / `down('sm')` handle the switches.
- **Money never wraps:** `MoneyText` is `white-space: nowrap`, since a break inside "-1.234.567.890 ₫" reads as another number. The dashboard's four figure cards go to one column below `sm`, and the balance card's total shrinks to fit its card on one line (a font size in `cqi` inside an inline-size container).

## 5.5 Theming (light / dark / system)

- `theme/theme.ts` exports `getTheme(mode)` with palettes for `light` and `dark` (draft 3, T18): pale sky ground `#f3f8fd` with white cards, or deep navy `#0a1222` with `#111b2e` cards; sky for income and links (`#0369a1` / `#38bdf8`), pink for spending (`#db2777` / `#f472b6`); the main action and the balance card use the sky→blue→pink `GRADIENT`, deep enough for white text at 4.5:1. Every text colour keeps 4.5:1 on its ground (TC-NF-03 runs axe in both modes). `system` follows the OS live (Settings → Giao diện → Theo hệ thống).
- **Design system (T18, draft 3):** rounded consumer-finance look: 12 px inputs, 20 px cards with a soft shadow, pill buttons, chips and toggles; light-weight large headings and uppercase card captions; Be Vietnam Pro self-hosted from `@fontsource/be-vietnam-pro` (300–600, Vietnamese subset; TC-NF-13). Money uses tabular digits (`moneySx`). Line icons (Lucide via `components/icons.ts`); category rows use a round soft tile with the category's icon in its colour. Phones get a floating pill tab bar whose current tab is a gradient pill with its label; the desktop drawer marks the current page the same way. Hover and press: buttons step up 1 px and press with scale .985, only for a fine pointer without `prefers-reduced-motion`; the ripple is off and `.Mui-focusVisible` draws a 2 px ring.
- `themeMode` in `uiSlice`: `light | dark | system`. `system` follows `prefers-color-scheme` via `useMediaQuery`.
- `ThemeToggle` in the app bar is a two-state switch: it always flips to the opposite of what is on screen, and picking the scheme the OS already uses stores `system` again. The full three-way choice (light / dark / system) is in Settings → Preferences. `ThemeToggle` saves at once; Preferences saves only when **Save** is clicked. Both write localStorage (`system` = no key) and `PATCH /users/me {theme}` when logged in. The user's saved theme is applied at login and when the session is restored at start-up, but not on later token refreshes of the same session. Another tab's change is followed through the `storage` event.
- `<CssBaseline enableColorScheme />` so scrollbars and form controls follow the mode. Recharts colours come from `theme.palette`.

## 5.6 Internationalisation (vi / en)

- `i18next` + `react-i18next` + language detector. Detector order: localStorage → browser; the user's profile language is applied at login and when the session is restored at start-up (`AuthContext`), not on later token refreshes. Fallback `vi`.
- Files: `i18n/<lang>/<namespace>.json`, one namespace per feature, picked up automatically by `import.meta.glob`. 13 namespaces: `common` (the default), `auth`, `dashboard`, `transactions`, `wallets`, `categories`, `budgets`, `bot`, `link`, `settings`, `admin`, `notFound`, `errors`. Counts use i18next plurals (`key_one` / `key_other`). *Planned:* an `assistant` namespace (§5.10.7); the email-code screens use `auth` (§5.11.5).
- **API errors:** `errorMessage(code)` in `i18n/errors.ts` looks up `errors:<CODE>`, falling back to `errors:GENERIC`.
- **Money:** `formatMoney()` in `i18n/format.ts` (used by `MoneyText`) uses `new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })`.
- **Dates:** `Intl.DateTimeFormat` with `timeZone: 'Asia/Ho_Chi_Minh'`.
- **Default categories** show `names[lang]`; user categories show `name`.
- `LanguageSwitch` updates i18next, `uiSlice`, localStorage, and `PATCH /users/me {language}` (which also changes the bot's reply language). A saved language change invalidates `Stats`, because `GET /stats/by-category` names categories in the profile's language.
- If the `PATCH` for a theme or language change fails, the change still applies on this device and a warning snackbar says it only lasts until the page is reloaded.

## 5.7 Screen details

| Screen | Components and behaviour |
|---|---|
| **Login / Register** | Split layout: the form on the left; from `md` up, a dark panel on the right with what the app does and a preview built from the app's own components (month figure, budget bar, Telegram chat), hidden from screen readers because the text beside it says the same; hand-written checks before sending (no zod on the client): email with the same pattern as the server, name 1–60 characters, password ≥ 8 characters and ≤ 72 bytes (a Vietnamese letter takes 2–3), confirm matches; focus moves to the first wrong field; a `VALIDATION_ERROR` from the API marks the fields named in its `details`; show/hide password; language and theme switch in the corner; server errors shown with translated codes. *Planned (§5.11):* Register handles a 201 (logged in, as today) or a 202 (go to `/verify-email`); Login gets a "Quên mật khẩu? / Forgot password?" link under the password field |
| **QuickAdd (component)** | One text field: "Bạn vừa chi gì? — e.g. phở 45k". After a 300 ms pause it calls `POST /api/transactions/parse` and shows preview chips (amount · category · wallet · date) that can be clicked to change. **Enter** (or Save) saves via `POST /api/transactions`; **Shift+Enter** or the **Open full form** button opens the full form pre-filled. Several lines save several transactions, at most 10: with more, nothing is saved and the box says so. Lines the parser cannot read (no amount, or above 10¹³ ₫) are named by line number and nothing is saved until they are fixed. A preview line with no wallet or category blocks saving too. Errors show inline in the user's language. *Planned (§5.10.2):* when the text is a question, the chip "Đây là câu hỏi · Hỏi Sổ chi tiêu ›" replaces the preview and Enter saves nothing; a Khác/Other line gets a category suggestion chip (§5.10.10) |
| **Dashboard** | `QuickAdd` at the top; `MonthPicker`; a gradient total-balance card (active wallets, month in/out) beside the month's 4 figure cards; this month vs last month in weekly columns with a Chi tiêu / Thu nhập switch and a computed sentence that compares the same days ("cùng kỳ tháng trước", §5.10.3; TC-NF-14, TC-F14-03); ranked category breakdown; "Drafts waiting" banner linking to Bot inbox; "Budgets to watch" banner listing category budgets past 80 % / 100 % (same thresholds as Budgets) linking to Budgets; latest 5 transactions; one error banner with Retry covers every query whose figures it shows, so a failed request never shows as 0 ₫. *Planned (§5.10.1, §5.10.3):* a "✨ Hỏi Sổ chi tiêu" button beside `MonthPicker` (icon only on phones) that opens the assistant drawer |
| **Transactions** | `QuickAdd`; filter bar (date range, type, wallet, category, status, search) synced to the URL query string; paginated table or cards; add/edit dialog (amount input with thousand separators, `k`/`tr` shortcuts like the bot, at most `MAX_MONEY` = 10¹³ ₫ with an "At most …" message); delete → snackbar with **Undo** (`/restore`). *Planned (§5.9.5, §5.10.10):* a WhatsApp source icon (no source is shown today); a category suggestion chip on a Khác/Other draft |
| **Wallets** | Card per wallet with computed balance; add/edit dialog (type cash / bank / e-wallet / credit card, opening balance from −10¹³ to 10¹³ ₫ so a credit card can start negative, aliases for the bot); archive toggle; delete blocked with an explanation when in use. Archiving or deleting the default wallet clears it (server), and the signed-in user is updated so forms stop offering it |
| **Categories** | Tabs Expense / Income; list with icon, colour, keyword chips; add/edit dialog with a keyword chip input (normalised to no-diacritics) |
| **Budgets** | `MonthPicker`; progress bar per category (green < 80 %, amber 80–100 %, red > 100 %); add/edit/delete (limit at most 10¹³ ₫); "Copy from last month". *Planned (§5.10.3):* from day 5, a pace chip per budget (the daily limit from A2) |
| **Bot inbox** | **Link card** (docs/02 §2.10.2), titled "Link Telegram / WhatsApp / Zalo": "Create link code" → shows the 6-character code and its 10-minute countdown (focus moves to it; after 5 codes in 10 minutes the 429 message shows), an app picker (Telegram \| WhatsApp \| Zalo, only the apps whose `links` entry is not `null`; it starts on the first app not linked yet, else the first shown; one app needs no picker), the picked app's instruction line, its button and a black-on-white QR code (`qrCode.ts`) of the same link, and `/link CODE` to send by hand. The links are used as the API gives them. **Open Telegram** and **Open WhatsApp** open the link in a new tab; **Copy & open Zalo** copies `/link CODE` (`navigator.clipboard.writeText`) and opens `ZALO_BOT_URL` (a real link, so no pop-up blocker stops it; its QR only opens the bot, so the large code stays on screen); a status line says "Copied" or, if copying fails, to copy the command by hand. Every 5 s while the code is live it reloads the linked accounts; a link made while the code was valid (its `createdAt` between the code's `expiresAt` minus the 10-minute lifetime and `expiresAt` plus 5 s, because the bot checks the expiry just before it saves the link; both server times, so any copy of the list can be judged and one failed request loses nothing) replaces the code with "Linked ✓ <app> · <name>" (the same name as under Linked accounts) and stops the checks. The list is also reloaded right after the code arrives, to pick the starting app; the code does not wait for it, and a list request still running is awaited first, so the new one is read after the click. A `role="status"` region announces that message, which takes focus from nothing that stays on the page; only if focus was on something in the code block it replaces does it move to the message. An expired code never claims a link made more than those 5 s after it expired; one last `GET /chat-links` runs when the code expires (after any list request still running), for a code redeemed after the last 5 s check; "Linked ✓" goes away when that account is unlinked. The Generate button stays busy until the new code is back; a failed request's message is translated when shown, so it follows a language switch. With three apps the picker wraps inside the card when the column beside the side drawer is narrow. **Linked accounts** with unlink (reloaded every time the inbox opens, since chats are also linked outside this page). A link made from a chat's claim link also has the notice "New chat linked from a chat link: <app> · <name>. Not you? [Unlink]" in that section until it is dismissed (§5.9.3). **Drafts list** (refetched every time the inbox opens, since drafts also change in the chats): source icon (Telegram/Zalo/receipt), parsed fields editable inline (amount at most 10¹³ ₫), receipt line items expandable, Confirm / Discard. Confirm sends the edits together with the confirm in one request (`POST /transactions/:id/confirm`); a 409 (already confirmed in the chat) or 404 (deleted) removes the card; a budget warning from the server shows as a warning snackbar. **Upload receipt**: resize in the browser (canvas → JPEG ≤ 1600 px) → `POST /api/receipts` with a progress spinner (~20–40 s). *Planned (§5.9.5):* a WhatsApp source icon |
| **Link a chat** | `/link`, opened from the bot's "tap to link" message: a page of its own (brand, language and theme switches, no app navigation) that shows which chat would be linked to which account, a warning, and Confirm / Cancel; error screens for a dead link and a chat already linked (§5.9.2) |
| **Verify email** *(planned, §2.12)* | `/verify-email` after a 202 from Register: one 6-digit code box, Resend with a 60 s countdown, "Wrong email? Change it" (§5.11.2) |
| **Forgot password** *(planned, §2.12)* | `/forgot-password` from the Login link: email, then code + new password on the same screen; ends on `/login` (§5.11.4) |
| **Settings** | Profile (name, default wallet), password change, preferences (language, theme), sessions list (device, last used, "this device") with revoke and "Log out other devices". *Planned (§5.10.4):* a "Trợ lý" switch (on by default) and the evening reminder choice |
| **Admin · Users** | System stats cards (users, active in 7 days, chat links, transactions by source; not shown if that request fails); search and filter, applied on submit (the same search again refetches); role and status chips; lock/unlock and promote/demote with confirm dialogs; a failed list load shows an error with Retry. *Planned (§5.10.5):* the runtime assistant switch and "Chạy ngay" |
| **Admin · Default categories** | Tabs by type; vi/en names, keywords, icon, colour; CRUD in `TemplateDialog`. A failed load shows an error message without a Retry button |

A failed load of a page's main data (Dashboard, Transactions, Wallets, Categories, Budgets, Bot drafts and linked accounts, Settings sessions, Admin users) shows an error banner with **Retry** instead of empty or zero data; the dashboard uses one banner for every query whose figures it shows (the drafts-waiting count and category names are secondary lookups). Exceptions: Admin · Default categories has no Retry, and the admin stats cards are hidden on failure. Secondary lookups (e.g. category names on Budgets and Dashboard, the drafts-waiting count, the wallet list in Settings) do not show their own error.

## 5.8 Dev setup notes

- `vite.config.ts`: `server.proxy` forwards `/api` to `http://localhost:<PORT>` (default 4100; Vite itself on `VITE_PORT`, default 5300; `tools/wt-env.sh` gives each worktree its own ports), so local dev is also same-origin and cookies behave as in production. The same file holds the Vitest config.
- Build: `npm run build -w client` → `client/dist` (served by Vercel).
- Accessibility basics: every icon button has an `aria-label` (translated); charts have a text summary and add no Tab stops of their own; colour is never the only signal (labels on budget bars).

## 5.9 One-tap linking and WhatsApp (planned, §2.10)

> **Partly built.** The link card (§5.9.1, card T32 #72), the `/link` screen and the claim notice (§5.9.2–§5.9.3, card T33 #73) are built; the WhatsApp parts are not built yet. §5.1–§5.8 describe the client as it is today. This section lists what changes on the client when [02-features.md §2.10](02-features.md#210-one-tap-linking-and-whatsapp-planned) is built; the endpoints and error codes are in [04-backend.md](04-backend.md). As each part is built it moves into §5.2–§5.7 (§2.10.5). Each build PR updates the planned sections in the docs its card's Scope lists; where a card's Scope doesn't list them (T32), the orchestrator opens a docs-only follow-up PR after the merge. Left to the builder throughout: component and file layout, i18n keys and the exact wording (vi + en).

<a id="591-link-card-on-bot-planned-2102"></a>

### 5.9.1 Link card on `/bot` (built, §2.10.2)

Built by card T32 (#72): the **Bot inbox** row of §5.7 describes it, and §5.9.8 items 1–3 record the choices it made.

<a id="592-link-screen-planned-2103"></a>

### 5.9.2 `/link` screen (built, §2.10.3)

Built by card T33 (#73): `features/link/` (`LinkPage.tsx`, `linkApi.ts`, `routes.tsx`) and `auth/claimToken.ts`. The bot's "tap to link" message opens `<APP_URL>/link?t=<token>`, a 32-character claim token.

**Route.** `ProtectedRoute` copies the query string into `state.from` and redirects before the page's code runs, so behind it `?t=` would ride through the login page and back into the address bar. `/link` therefore sits outside `<ProtectedRoute>`, beside `/login` (§5.2), and sends a logged-out visitor to log in itself. It is not wrapped in `AppLayout`: one decision on a page of its own.

**Flow.**

1. As the app starts, before the first request (`takeClaimTokenFromAddressBar`, called by `features/link/routes.tsx`), `/link?t=…` is moved into `sessionStorage` and `history.replaceState` rewrites the address to `/link`. Doing it this early keeps the token out of the `Referer` of the session-restoring request. A `?t=` reached by navigating inside the app is handled by the page itself, with a `replace` navigation.
2. The router mounts only after the session is restored, so the page knows at once whether the user is logged in. Logged out: `<Navigate to="/login" replace state={{ from: '/link' }} />`; `LoginPage` returns to `state.from`.
3. Logged in: `POST /api/chat-links/claim/preview { token }` answers with the chat's `platform` and `displayName`. The result is not cached (`keepUnusedDataFor: 0`), since a token can die at any moment.
4. **Confirm:** `POST /api/chat-links/claim { token }`. On 201 the page goes to `/bot`, the app snackbar says `Linked ✓ <App> · <displayName>`, and the Bot inbox shows the claim notice (§5.9.3). The success message in the chat is sent by the server.
5. **Cancel:** goes to `/bot` with no request; the token expires by itself. Cancel is disabled while a claim is running, because it could no longer be called off.
6. The token is forgotten after Confirm or Cancel, when the server says it is dead (404 or 409), and on an explicit logout.

| State | When | Shows | Buttons |
|---|---|---|---|
| Loading | The preview request is running | A progress indicator | – |
| Confirm | Preview 200 `{ platform, displayName }` | "Link **`<App> · <displayName>`** to **`<user.name> (<user.email>)`**?" Above the buttons, a warning: "Only confirm if you just messaged the bot yourself. The chat you link can see your spending and record money in this account." (the display name comes from the chat app and is not proof, §2.10.3) | **Confirm** (shows loading while the claim runs), **Cancel** |
| Done | Claim 201 `{ id, platform, displayName, createdAt, viaClaim: true }` | Redirect to `/bot` with `Linked ✓ <App> · <displayName>`; the claim notice (§5.9.3) shows there | – |
| Expired or used | Preview or claim 404 `LINK_TOKEN_INVALID`, or no token (opened bare) | "This link has expired or was already used. Send any message to the bot to get a new one." | **Go to Bot inbox** |
| Already linked | Claim 409 `CHAT_ALREADY_LINKED` (the token is spent anyway) | "This chat is already linked to an account." | **Go to Bot inbox** |
| Preview failed | Network or 5xx error on preview | The translated error | **Retry** (`refetch()`) |
| Claim failed | Network or 5xx error on claim | The confirm screen with the translated error above the buttons; the token is kept | **Confirm** again, **Cancel** |

`<App> · <displayName>` is the same format as Linked accounts (`nameOf()` in `features/bot/botApi.ts`). The chat and account names are rendered as elements inside the translated sentence (`<Trans>`), so a chat name is never read as markup, and long names wrap.

<a id="593-not-you-unlink-notice-in-the-bot-inbox-planned-2103-2105"></a>

### 5.9.3 "Not you? [Unlink]" notice in the Bot inbox (built, §2.10.3, §2.10.5)

The phishing guard after a link made from a chat (§2.10.3): someone may have confirmed a claim link that an attacker sent them, so the inbox says so until the user dismisses it. Built by card T33 (#73) in `features/bot/LinkedAccounts.tsx`.

- **When:** for every item of `GET /api/chat-links` with `viaClaim && !claimNoticeDismissedAt`. A link made with a code from the website has `viaClaim: false` and never shows it. The list is reloaded every time the inbox opens, so a chat linked on another device shows up.
- **What:** one warning per such link at the top of the Linked accounts section: "New chat linked from a chat link: **`<App> · <displayName>`**. Not you? [Unlink]", with a dismiss button. The list below keeps its own unlink button.
- **Unlink:** the existing unlink of Linked accounts (its `ConfirmDialog`, then `DELETE /api/chat-links/:id`); the link goes, and its notice with it.
- **Dismiss:** `PATCH /api/chat-links/:id/claim-notice` (no body) → 204; the `ChatLink` tag is invalidated, the list refetches with `claimNoticeDismissedAt` set, and the notice is gone for good, on every device. A 404 (the link was unlinked meanwhile) also just refetches; any other failure is shown in the snackbar and the notice stays.

### 5.9.4 API types and RTK Query endpoints

The link card's endpoints are in `features/bot/botApi.ts`; the claim ones are in `features/link/linkApi.ts`.

| Endpoint | RTK Query | Types | Tags |
|---|---|---|---|
| `POST /api/chat-links/code` (existing `createLinkCode`), *built (T32)* | mutation, unchanged | Result `LinkCode = { code: string; expiresAt: string; links: { telegram: string \| null; whatsapp: string \| null; zalo: string \| null } }`; `telegramDeepLink` goes. Client and server change in the same PR (§2.10.2) | None, as today |
| `POST /api/chat-links/claim/preview`, *built (T33)* | query with `method: 'POST'` and `body`, not cached | Arg the token → `ClaimPreview = { platform: ChatLink['platform']; displayName: string }` (`types/api.ts`) | None |
| `POST /api/chat-links/claim`, *built (T33)* | mutation | Arg the token → 201 `{ id, platform, displayName, createdAt, viaClaim: true }` (a `ChatLink` without `claimNoticeDismissedAt`) | Invalidates `ChatLink`, so Linked accounts, the link card and the claim notice refetch |
| `GET /api/chat-links` (existing `getChatLinks`), *fields built (T33)* | query, unchanged | `ChatLink` has `viaClaim` and `claimNoticeDismissedAt` | Provides `ChatLink`, as today |
| `PATCH /api/chat-links/:id/claim-notice`, *built (T33)* | mutation | Arg the link `id` → `void` (204) | Invalidates `ChatLink`, also after an error, so the notice of a link unlinked meanwhile leaves |

- The token goes in the request body only, never in `params` (§2.10.3: tokens never travel in a URL).
- Type unions gain `'whatsapp'`: `ChatLink['platform']` in `botApi.ts` (`chatLinks.platform`), `Transaction['source']` in `transactionsApi.ts` (`transactions.source`, the §5.1 example), and the admin stats' `chatLinks` and `transactionsBySource` in `adminApi.ts` (§2.10.5; both gain `whatsapp` in [04-backend.md](04-backend.md)).
- No new RTK Query tag.

### 5.9.5 WhatsApp source icon (planned, §2.10.5)

- `sourceIcon()` in `features/bot/sourceIcon.tsx` gains `whatsapp` → `WhatsAppIcon` from `@mui/icons-material/WhatsApp` (already a dependency; unlike Zalo, Material has this mark). The Bot inbox's draft chips and Linked accounts pick it up with no other change; the label beside it is `sources.whatsapp`, and the icon stays decorative.
- **Transactions:** the table and cards show no source today (`TransactionList.tsx`). §2.10.5 asks for a WhatsApp source icon there; reusing `sourceIcon()` is the smallest change. Where it sits, and whether the other sources get theirs too, is left to the builder (§5.9.8).
- **Admin · Users:** the chat-links card adds `chatLinks.telegram + chatLinks.zalo` by name today, so WhatsApp joins the sum and the detail line. The transactions card already sums every key; only its detail line needs WhatsApp.

### 5.9.6 Translations (planned)

Keys and wording are left to the builder (§2.10), in vi and en. What needs text:

| Where | Strings |
|---|---|
| `bot`, link card (*built, T32*, except the page `intro`: it says what the bots record, so it changes with the WhatsApp bot, T34) | Card title and description naming all three apps; the picker's group label; `sources.whatsapp`; **Open WhatsApp** and **Copy & open Zalo** (**Open Telegram** exists); one instruction line per app (replacing `link.telegram` and `link.zalo`); one QR label per app; "Copy it yourself"; `Linked ✓ <App> · <name>`; the page `intro`, which names Telegram and Zalo only |
| `link` namespace, the `/link` screen (*built, T33*) | Page `<title>`; loading; the confirm question (app · chat name, user name, email, with bold parts); the warning (vi + en of "Only confirm if you just messaged the bot yourself. The chat you link can see your spending and record money in this account."); **Confirm**; **Cancel**; the done message (may reuse the card's); the expired-or-used text; the already-linked text; **Go to Bot inbox** |
| `link`, claim notice (*built, T33*) | "New chat linked from a chat link: **`<App> · <name>`**. Not you?" (with the bold part); **Unlink** (the dialog's texts exist in `accounts`); the dismiss button's label |
| `admin` | `stats.chatLinksDetail` and `stats.transactionsDetail` with WhatsApp |

### 5.9.7 Accessibility

*Built: the link card's three button names, the picker, its focus and announcement rules, its QR label and the `/link CODE` text (T32); the `/link` screen and the claim notice (T33).*

- **Button names** are their visible text: "Open Telegram", "Open WhatsApp", "Copy & open Zalo", "Confirm", "Cancel", "Go to Bot inbox". App icons are decorative (MUI icons are `aria-hidden`).
- **Picker:** one labelled single-choice group (e.g. MUI `ToggleButtonGroup exclusive` with an `aria-label`, which marks the selected app with `aria-pressed`); each option is named by its app.
- **Focus:** after "Create link code", focus moves to the code (unchanged). Switching apps keeps focus on the picker. "Copy it yourself" and "Linked ✓ …" are announced without moving focus (`role="status"`). On `/link`, each state's heading takes focus when the state changes (a `tabIndex={-1}` heading, as in Linked accounts), so a screen reader reads the question or the error.
- **Confirm warning:** real text between the question and the buttons, read right after the question; **Confirm** points at it with `aria-describedby`, so it is read again on the button. It is not a live region (it is there when the state's heading takes focus) and colour is not its only sign (a warning icon plus the words).
- **Claim notice:** shown when the inbox loads, so it is page content, not a live region. Its buttons are named with the chat: "Unlink `<App> · <name>`" (as Linked accounts' `accounts.unlink`) and "Dismiss notice for `<App> · <name>`", so several notices are told apart. The buttons leave with the notice, so after Unlink or Dismiss focus moves to a heading (as Linked accounts does after its unlink), not to `<body>`.
- **QR alt text:** the SVG keeps `role="img"`, with an `aria-label` that names the selected app and what scanning does.
- The `/link CODE` text stays real text, so it can be selected, copied by hand and read aloud.

### 5.9.8 Open questions

1. **Zalo, copy fails:** does the tab still open? A real link always opens it and no pop-up blocker can stop it; opening only after a successful copy needs `window.open` after an `await`, which some browsers block. *T32: yes, the button is a real link; the card says that copying failed.*
2. **Link card after "Linked ✓":** does the code stay (and polling go on) until it expires, or does the card reset? The code is single use either way. *T32: it resets. "Linked ✓" replaces the code, the checks stop and "Create a new code" is offered.*
3. **Picker edge case:** what the card shows when all three links are `null`. *T32: no picker, button or QR; the code and `/link CODE` stay.*
4. **`/link` gaps:** no token (opened bare, or `sessionStorage` empty) and network or 5xx errors on preview or claim have no state in §2.10.3. The §5.7 rule (error banner with **Retry**) is the obvious candidate for the second. *T33: yes. No token shows the expired-or-used screen; a failed preview has **Retry**; a failed claim keeps **Confirm** and the token.*
5. **New users:** `/login` links to `/register`, and `RegisterPage` always lands on `/`, so someone who registers on the way loses the return to `/link`. Should `RegisterPage` honour `state.from` too? *T33: not changed (`features/auth/` is outside that card's scope). Someone who registers on the way lands on `/`; the link in the chat works until it expires, so they tap it again.*
6. **Clearing the token:** after Confirm, Cancel or an error, so a spent token does not stay in `sessionStorage`. *T33: after Confirm, Cancel, a 404 or 409, and on logout; kept after a network or 5xx error.*
7. **Transactions:** a source icon for WhatsApp only, or for every source (§5.9.5)?

## 5.10 Assistant and agent features (planned, §2.11)

> **Not built yet.** This section lists what changes on the client when [02-features.md §2.11](02-features.md#211-assistant-and-agent-features-planned) is built. The endpoints are in [04-backend.md](04-backend.md). Questions, receipt reading and category suggestions are answered by the team's own **agent service** (FastAPI + LangGraph on the GPU host, with Qwen3.5-2B served by vLLM; §2.11.4). The browser never calls it: Express stays the only API the client sees. Parts arrive in §2.11.7's order. As each part is built it moves into §5.2–§5.7, in the PR that builds it. Left to the builder throughout: file layout inside `features/assistant/`, i18n keys and the exact wording (vi + en).

**No opt-in, no grant, no cost.** The model runs on our own machine, so no data leaves it and there is no bill per question. The client therefore has no disclosure of a third party, no per-user AI grant and no spend display. What stays: the user's **"Trợ lý"** switch in Settings (`users.assistantOn`, on by default), the admin's runtime switch, and a daily question cap per user that protects the one GPU (30 a day on the web). The two switches close the **model gate** only ([§2.11.4](02-features.md#2114-local-model-layer-qwen35-2b-on-vllm)): with either off, questions are still answered by the pipeline skills and templates ("Theo mẫu"), exactly as in Stage R; only the model's parts (picking between close skills, free questions, the "AI" wording) stop.

**When the agent service is down**, the web endpoints answer 503 `AGENT_UNAVAILABLE`. Typed capture never needs it: the QuickAdd chip, the capture card in the drawer and every other screen keep working. Receipt upload works while it reads with KIE (`RECEIPT_READER=kie`, or as the fallback while the KIE container still runs; §2.11.4). Only answers to questions, category suggestions and Qwen receipt reads are missing.

### 5.10.1 The "Hỏi Sổ chi tiêu" drawer (planned, §2.11.5)

No new route. A button opens an MUI `Drawer` (e.g. `AssistantButton` and `AssistantDrawer` in `features/assistant/`).

| | Phone (< `sm`) | Desktop (≥ `sm`) |
|---|---|---|
| Button | Icon only (✨) in the Dashboard header beside `MonthPicker`, with a translated `aria-label` | "✨ Hỏi Sổ chi tiêu" with its text, same place |
| Drawer | Anchored right, full width | Anchored right, 420 px wide |
| Also opened by | The QuickAdd question chip (§5.10.2), with its text already sent | Same |

**Inside, top to bottom:**
- The title "Hỏi Sổ chi tiêu", **Xoá** (`DELETE /api/assistant/thread`) and a close button. Xoá hides the thread; it does not give questions back, because the daily cap counts every question asked (§2.11.6).
- An empty thread shows 4 starter chips. Pressing one sends its text. Suggested: "Tháng này ăn uống hết bao nhiêu?", "Còn tiêu được bao nhiêu mỗi ngày?", "Vì sao tháng này chi nhiều hơn?" and "Ví MoMo còn bao nhiêu?". Each must be the example of a skill that ships in the same step (§2.11.3).
- The thread. Each answer shows, in order:
  - a badge: **"Theo mẫu"** (route `rules`: a template answer, which every pipeline skill gives) or **"AI"** (route `agent`: the local model worded it). "AI" means our local model; nothing goes to a third party.
  - the answer text, as the server wrote it. The client formats no money inside an answer: our code filled every number (§2.11.4, the guard).
  - the **facts** behind it, as a short "Số liệu" list of `label: display` lines (e.g. "Ăn uống 10/2026: 2.150.000 ₫"), folded by default on phones.
  - its sources line ("Nguồn: …").
  - under the newest answer only, the skill's **follow-up chips** (2–3, from `followups`). Pressing one sends its text as the next message.
- **Action card** (C3), when the answer has `action`: its summary, **Đồng ý** and **Thôi**. Đồng ý calls the confirm endpoint; on success the card shows it is done and the money data refetches (§5.10.6). A delete also shows the existing undo snackbar. Thôi calls the cancel endpoint. A 404 (expired, or not this user's) or a 409 (already done) shows that on the card. Every outcome removes the buttons.
- **Capture card**, when the answer has `capture` (e.g. `phở 45k` typed here): the quick-add preview chips with a save button that uses QuickAdd's save path (`POST /api/transactions`). Nothing is saved until it is pressed. A Khác/Other line in it gets the category chip of §5.10.10.
- The input: multi-line, 1–500 characters. Enter sends, Shift+Enter adds a line.
- While waiting: a pending bubble and a **Dừng** button that aborts the request (the RTK Query mutation's `abort()`).
- "Còn N câu hỏi hôm nay" from `remainingToday`: the web cap (30) minus today's questions. Shown whenever the drawer is open: the cap counts every question, with or without the model.

**Each send** is `POST /api/assistant/chat { message, month, requestId }`: `month` is the month on screen (`uiSlice.month`), and `requestId` is a new `crypto.randomUUID()` per message. The agent service adds the last 6 turns of the thread as context, so the client sends only the new message. On open, the drawer loads `GET /api/assistant/thread`, so the thread survives a reload.

**States that are not an answer:**

| State | When | The drawer shows |
|---|---|---|
| Model off for this user | `ai.on` false because `assistantOn` is off | A quiet line under the title: "Trợ lý AI đang tắt, chỉ trả lời theo mẫu" with a link to Settings. Questions are still sent; a question only the model could answer gets the help text |
| Model off for everyone | `ai.on` false because the admin's runtime switch is off (or vLLM is down) | The same line without the Settings link: "Trợ lý AI đang tạm tắt, chỉ trả lời theo mẫu". Questions as above |
| Cap reached | `remainingToday` is 0, or an answer with route `capped` | "Hôm nay bạn đã hỏi đủ 30 câu, mai hỏi tiếp nhé" in place of the input hint, plus the plain commands (`/today`, `/month`) that still work; captures still get their card |
| Service down | 503 `AGENT_UNAVAILABLE` | An error bubble: "Trợ lý đang bận bảo trì, thử lại sau" with **Thử lại**, plus a line that Dashboard and Transactions still show the numbers. The question stays in the input |
| Service busy | 503 `AGENT_BUSY` (more than 16 requests waiting on the GPU) | An error bubble: "Trợ lý đang trả lời nhiều người, thử lại sau vài giây" with **Thử lại** |
| Timeout or network error | No answer within the web budget (40 s) | The same bubble as service down |

**Thử lại** resends with the **same** `requestId`, so a question the server already answered is not answered (or counted) twice (§5.10.9).

### 5.10.2 QuickAdd question chip (planned, §2.11.1)

- `POST /api/transactions/parse` runs the same `classify` as the bots (`followUp: false`), in Express, with no call to the agent service. For a question it answers `{ question: true, drafts: [], noAmountLines: [], truncated: false }`.
- QuickAdd then shows the chip **"Đây là câu hỏi · Hỏi Sổ chi tiêu ›"** instead of preview chips. Enter (and Save) saves nothing.
- Pressing the chip opens the drawer and sends the QuickAdd text as its first message.
- QuickAdd is on Dashboard and Transactions, but the header button is on Dashboard only. Where the drawer is mounted so that the chip works on Transactions too is open (§5.10.9).

### 5.10.3 Dashboard compare sentence (built, T43) and Budgets pace chip (planned) (§2.11.2, §2.11.3)

- **MonthCompare** (`features/dashboard/Charts.tsx`, built in T43) compares the same days, as the agent's `compare_periods` tool does. `sameDays(month, today)` in `features/dashboard/sameDays.ts` returns the two ranges and `sumDays()` adds the selected flow over each: for the current month, days 1..N in both months, N = today's day (Vietnam time) capped at the last day of the month before (28/02 meets 01–28/01, 30/04 meets 01–30/03, 30/11 meets 01–30/10, 31/03 stops at 28/02 on both sides); for any other month, past or still to come, the whole month against the whole month before (so a past February meets all of January). The figure and the sentence follow these ranges and say "cùng kỳ tháng trước" ("the same days last month"); the weekly columns still show both whole months, and a bill dated after today is in the columns but not in the sentence. The "no transactions in these two months" text is shown only when both whole months have nothing for the chosen flow; when just the same days add up to 0 the sentence says 0 ₫. `sameDays()` is the browser's side of the rule that `compareRange()` has in Express (docs/02 §2.11.3) and builds the previous range itself, because `compareRange()` sees only dates and takes 01–28/02 for a whole February; the two agree on every fixture row except the last day of the current month when the month before is longer (marked `compareRangeAgrees: false`). Both are tested on `shared/fixtures/compare-range.json` (TC-F14-02), and the component on the same file (TC-F14-03). The component takes `month` and `today` as props, so a test fixes the day; "today in Vietnam" comes from `utils/vnToday.ts`, the same function that picks the month the app opens on.
- **Budgets:** A2's `pace()` is added to every budget by `listBudgets()` in Express, so `GET /api/budgets` items carry it. From day 5 of the month the Budgets page shows it as a chip (e.g. "tối đa 150.000 ₫/ngày"). The client shows the server's numbers and computes none, so the chip, `/month`, the bot's confirm warning and the agent's `get_budget_pace` answer say the same thing. The field's shape is in docs/04.

### 5.10.4 Settings (planned, §2.11.5)

- **"Trợ lý"** switch = `assistantOn`, on by default. Under it, the line "Câu hỏi được trả lời trên máy chủ của Sổ chi tiêu, không gửi cho bên thứ ba." Off closes the model gate for this user's questions only: the drawer and the bots still answer with the pipeline skills and templates, and the drawer shows "Trợ lý AI đang tắt" (§5.10.1). Receipts follow `RECEIPT_READER`, and the category chip (no model unless there is a near tie) is still offered. Saved with `PATCH /users/me { assistantOn }`.
- **Evening reminder** (B1) = `notify`: off, daily or weekly (`off|daily|weekly`), default off. Saved with `PATCH /users/me { notify }`. The text says where it arrives: Telegram directly; Zalo with the next bot reply; WhatsApp only within 24 h of the user's last message; on the web as a banner on the next visit (§2.11.6).
- Whether these save at once (like `ThemeToggle`) or with Preferences' **Save** is the builder's choice.

### 5.10.5 Admin · Users (planned, §2.11.5)

- **Runtime switch** (`appSettings.assistantEnabled`): turns the assistant on or off for everyone, without a redeploy. It is the only assistant control on the admin page; there is no per-user toggle. Its endpoints are in docs/04.
- **"Chạy ngay"**: `POST /api/admin/cron/daily` runs the daily cron now, for the demo (crons don't fire locally). A snackbar shows the result. Pressing it twice sends nothing twice, because `notices` has a row before each send (§2.11.2).

### 5.10.6 API types and RTK Query endpoints (planned)

In `features/assistant/assistantApi.ts`, except where noted; hook names are the builder's.

| Endpoint | RTK Query | Types | Tags |
|---|---|---|---|
| `POST /api/assistant/chat` (new) | mutation | Arg `{ message: string; month?: string; requestId: string }` → `{ route; text; facts: { id; label; display }[]; sources: string[]; followups: string[]; action?: { id; summary }; capture?: ParseResult; remainingToday }`. The same `requestId` twice → 409 `DUPLICATE`; 503 `AGENT_UNAVAILABLE` or `AGENT_BUSY` (§2.11.5 lists `route`, `text`, `sources`, `action`, `capture` and `remainingToday`; `facts` and `followups` are passed through from `/v1/turn`, and docs/04 adds them to the response) | Invalidates `AssistantThread` (or updates its cache with `updateQueryData`; builder's choice) |
| `GET /api/assistant/thread` (new) | query | → `{ turns, ai: { on, remainingToday } }`; each turn carries the chat answer's fields | Provides `AssistantThread` |
| `DELETE /api/assistant/thread` (new) | mutation | → `void` | Invalidates `AssistantThread` |
| `POST /api/assistant/actions/:id/confirm` (new) | mutation | Arg the action `id`. 404 not this user's or expired, 409 already done | Invalidates `Budget`, `Stats`, `Transaction`, `Draft` and `Wallet` (a deleted transaction changes a balance), plus `AssistantThread` |
| `POST /api/assistant/actions/:id/cancel` (new) | mutation | Arg the action `id`. Same errors | Invalidates `AssistantThread` |
| Categorize (new; e.g. `POST /api/assistant/categorize`, path and body in docs/04) | query (read-only, cached by its argument) | Arg `{ note: string; merchant?: string }` → `{ categoryId; score; method: 'embedding' \| 'llm'; alternatives: string[] }`. 503 `AGENT_UNAVAILABLE` or `AGENT_BUSY` → no chip | Provides `Category`, so a category edit (or an A7 keyword) refetches open suggestions |
| `POST /api/transactions/parse` (existing) | mutation, unchanged | `ParseResult` gains `question?: true` | None, as today |
| `PATCH /users/me` (existing, `usersApi.ts`) | mutation, unchanged | `UpdateMeInput` gains `assistantOn?: boolean` and `notify?: 'off' \| 'daily' \| 'weekly'` | As today |
| `GET /api/budgets` (existing) | query, unchanged | Each budget gains its pace (shape in docs/04) | As today |
| Runtime switch, `POST /api/admin/cron/daily` (`adminApi.ts`) | mutations (and a query for the switch's state) | Paths and bodies in docs/04 | Their own; no `AdminUser` change |

- `route` is `'rules' | 'agent' | 'fallback' | 'capped' | 'off'`: `rules` and `agent` come from `/v1/turn`; `fallback` is the template answer after the guard rejected the model's wording; `capped` means the daily cap was reached; `off` means no agent service is configured (`AGENT_URL` unset: the help text). docs/04 has the final list. It decides the badge: `agent` shows "AI", every other route "Theo mẫu".
- `User` in `types/api.ts` gains `assistantOn: boolean` (default `true`) and `notify: 'off' | 'daily' | 'weekly'` (§2.11.6). No AI grant, opt-in or cost field.
- `errors.ts` maps `AGENT_UNAVAILABLE` and `AGENT_BUSY` like the other codes.
- One new tag, `AssistantThread`.

### 5.10.7 Translations (planned)

Keys and wording are left to the builder, in vi and en. Answers, facts, sources and follow-up chips are written by the server in `user.language`, so they need no client keys. What needs text:

| Where | Strings |
|---|---|
| `assistant` (new namespace; `import.meta.glob` picks it up) | The button's text and its `aria-label`; the drawer title; the 4 starter chips; the input's label and placeholder ("Hỏi về chi tiêu của bạn…"); Send; **Dừng**; **Xoá**; **Thử lại**; the badges "Theo mẫu" and "AI" and the badge's description ("Trả lời bởi mô hình chạy trên máy chủ của Sổ chi tiêu"); the "Số liệu" heading; "Còn N câu hỏi hôm nay" (plural); the model-off, cap, unavailable and busy texts of §5.10.1; the action card's **Đồng ý** / **Thôi** with full labels, and its done, expired and already-done texts; the capture card's save button |
| QuickAdd (`common` or `transactions`, where QuickAdd's texts are) | "Đây là câu hỏi · Hỏi Sổ chi tiêu ›"; "Gợi ý: {{category}} ›" and its full label |
| `dashboard` | The compare sentence with "cùng kỳ tháng trước" (built, T43: `compare.versus`, `compare.more`, `compare.less`, `compare.same`) |
| `budgets` | The pace chip ("tối đa … ₫/ngày") |
| `bot` | The engine-neutral receipt status text, if it changes (§5.10.11) |
| `settings` | "Trợ lý", its line ("Câu hỏi được trả lời trên máy chủ của Sổ chi tiêu, không gửi cho bên thứ ba."), the reminder choice and its three options, and where reminders arrive |
| `admin` | The runtime switch, "Chạy ngay" and its result |
| `errors` | `DUPLICATE`, `AGENT_UNAVAILABLE`, `AGENT_BUSY` |

### 5.10.8 Accessibility (planned, §2.11.5)

- **Drawer:** `aria-labelledby` its title. On open, focus goes to the input; Esc closes it; on close, focus goes back to what opened it (the header button or the QuickAdd chip).
- **Thread:** the list is `role="log"`. While waiting, the pending bubble is `aria-busy="true"`. A visually hidden polite live region announces each finished answer once, and each error bubble once.
- **Buttons with full labels:** chips and card buttons are real buttons whose names say what they do ("Đồng ý đặt ngân sách Đi lại 600.000 ₫", not "Đồng ý"; "Dùng gợi ý danh mục Ăn uống", not "Gợi ý"). Follow-up chips are buttons named by their text. The icon-only button on phones has an `aria-label`.
- **Badge:** "Theo mẫu" or "AI" is text, not colour only; "AI" carries its description for screen readers.
- **Facts:** a real list; when folded, a button with `aria-expanded`.
- **Motion:** no spinner animation under `prefers-reduced-motion`.
- **Keys:** Enter sends, Shift+Enter adds a line.
- **Settings switch:** its line is tied to the switch with `aria-describedby`, so it is read with it.

### 5.10.9 Open questions

1. **Drawer on Transactions:** QuickAdd's chip appears there too, but the drawer's button is on Dashboard. Mount the drawer in `AppLayout`, or send the user to `/` and open it there?
2. **Retry:** **Thử lại** reuses the `requestId`. If the server had answered, it gets 409 `DUPLICATE`. Does 409 return the stored answer, so the client can show it?
3. **Dừng:** the agent service may finish the turn anyway, and the turn counts against the cap. Does the answer then appear the next time the thread loads?
4. **Proactive banner on the web** (§2.11.6): no endpoint, no design and no dismiss rule yet.
5. **"Vì sao? ›" under the compare sentence:** §2.11 does not list it, so it is left out here.
6. **Runtime switch with `ASSISTANT_ENABLED` false or `AGENT_URL` unset:** should the admin switch show as disabled, with the reason? Should the admin page show the agent service's `/health` (model up, GPU free) too?
7. **Shift+Enter or "Open full form" on a question:** open an empty form, or do nothing?
8. **`compare_periods` and MonthCompare:** the agent (Python) and the client (TypeScript) each implement the same-days rule. The shared JSON fixture `shared/fixtures/compare-range.json` is read by the client and Express tests (T43); the agent's pytest joins it when that service exists (docs/07 §7.9).
9. **Category chip and A7:** how the save tells the server that the category came from the suggestion (a field on the request, or a separate call), so A7 learns the keyword only then. Also: should the suggestion be stored on a bot draft, so the Transactions row and the Bot inbox show it without a second call?
10. **Facts list:** always shown, or only behind "Số liệu" on every screen size?

### 5.10.10 Category suggestion chip (planned, A7, §2.11.4)

When the keyword rules fall back to **Khác / Other**, the agent service can suggest a category: the nearest of the user's own categories by embedding, and the model only to break a near tie, choosing from the user's category ids only (§2.11.4).

- **Where:** a line of the QuickAdd preview whose category is Khác/Other; the capture card in the drawer; and a **draft** row in Transactions whose category is Khác/Other. The Bot inbox's `DraftCard` can reuse the same chip (builder's choice).
- **What:** an outlined chip **"Gợi ý: Ăn uống ›"** after the category chip. The client calls the categorize endpoint (§5.10.6) with the line's note (and the receipt merchant, if any), only for Khác/Other lines, after the same 300 ms pause as the preview.
- **Tap:** sets the line's or the draft's category to the suggestion. Nothing is saved by the tap alone: in QuickAdd the user still presses Enter or Save; on a draft the change goes with the existing edit or confirm request. Keyword learning follows A7 on the server (the note's first word joins the category's `keywords`, and the agent's memory gets the hint); how the server learns that the category came from the chip is docs/04's (§5.10.9).
- **No chip** when the endpoint answers 503 (`AGENT_UNAVAILABLE` or `AGENT_BUSY`), or takes longer than 3 s. The line stays Khác/Other and can be changed by hand as today. A failed suggestion never blocks saving.
- **Not for income:** the fallback "Thu khác / Other income" gets no chip unless §2.11.4 says otherwise.

### 5.10.11 Receipt upload (planned, §2.11.4)

The Bot inbox's **Upload receipt** stays as it is: resize, `POST /api/receipts`, the progress spinner and the draft it makes. The server picks the reader with `RECEIPT_READER` (`kie` until the receipt eval passes, then `qwen`). The only client change: any status or error text that names KIE names no engine ("Đang đọc hóa đơn…"), so it stays true after the switch. A "no total found" error keeps today's text asking the user to type the amount.

## 5.11 Email codes: verified sign-up and password reset (planned, §2.12)

> **Not built yet.** This section lists what changes on the client when [02-features.md §2.12](02-features.md#212-email-codes-verified-sign-up-and-password-reset-planned) is built. The endpoints and error codes are in [04-backend.md](04-backend.md). As each part is built it moves into §5.2–§5.7, in the PR that builds it (§2.12.5). Left to the builder (§2.12.6): i18n keys and the exact wording (vi + en), and how the code box shows its countdown.

All the new calls are public auth calls. Like login and register today, they go through `postAuth()` in `auth/session.ts`, not RTK Query, so they have no tags. `postAuth` already throws `AuthError` with the API code and `details`, which carry `attemptsLeft` and `retryAfter`.

### 5.11.1 Register page (planned, §2.12.2, §2.12.4)

The form and its checks are unchanged. `register()` in `AuthContext` gets one of two answers:

| Answer | When | Client does |
|---|---|---|
| **201** `{ accessToken, user }` + `rt` cookie | Production without `GMAIL_*` (§2.12.4) | As today: `setSession`, then `/` |
| **202** `{ email: "a***@gmail.com", resendAfter: 60 }` | Mail is on (or development/test, where the code goes to the server log) | No session. Keep the typed email, the masked one and the name in `sessionStorage` (never the password); go to `/verify-email` |
| 409 `EMAIL_TAKEN`, 400, 429 | As today | As today |
| 503 `EMAIL_SEND_FAILED` | Gmail refused the mail | "We couldn't send the email. Try again in a few minutes." on the form |

- `postAuth` returns only the body, so the two are told apart by `accessToken` in the body (or `postAuth` learns to return the status; builder's choice).
- Coming back from "Wrong email? Change it", the form has the name and email filled in; the password is empty.

### 5.11.2 `/verify-email` screen (planned, §2.12.2)

Sketch in §2.12.2. A public route beside `/login`. With no pending email in `sessionStorage` (opened bare, or in another tab) it goes to `/register`.

- Heading "Kiểm tra email của bạn / Check your email", then "We sent a 6-digit code to a***@gmail.com" (the masked address from the 202).
- **One** input, not six boxes, so paste and screen readers work: `inputmode="numeric"`, `autocomplete="one-time-code"`, `maxLength={6}`. It submits on the 6th digit or on **Confirm**: `POST /api/auth/register/verify { email, code }`.
- Under it: "Didn't get it? Check spam/junk" · **Resend** (with the countdown) · **Wrong email? Change it** (back to `/register`, filled in; the old row expires on its own).
- **Resend:** `POST /api/auth/register/resend { email }` → 202 `{ resendAfter: 60 }`, and the countdown starts again. The old code stops working (§2.12.1), so the screen says a new code was sent.

| State | When | Shows | Actions |
|---|---|---|---|
| Waiting | Page open | The masked address and the code box | Confirm; Resend once the countdown ends; Change it |
| Wrong code | 400 `CODE_INVALID` with `details.attemptsLeft` | "Wrong code" with the tries left (plural); the box is cleared and focused | As above |
| Expired or out of tries | 400 `CODE_EXPIRED` | "This code has expired. Send a new one." | Resend |
| Too soon or too many | 429 `RATE_LIMITED` with `details.retryAfter` | The countdown runs from `retryAfter` seconds | Resend once it ends |
| Taken meanwhile | 409 `EMAIL_TAKEN` | The existing `EMAIL_TAKEN` text | Go to login |
| Send failed | Resend 503 `EMAIL_SEND_FAILED` | "We couldn't send the email. Try again in a few minutes." | Resend later |
| Done | 201 `{ accessToken, user }` + `rt` cookie | `setSession` as after today's register, then `/` (the Dashboard). The `sessionStorage` entry is removed | – |

### 5.11.3 Login: "Forgot password?" link (planned, §2.12.3)

- "Quên mật khẩu? / Forgot password?" under the password field, a link to `/forgot-password`. Passing along the email already typed is the builder's choice.
- Arriving from a reset, the login page shows "Mật khẩu đã được đổi, hãy đăng nhập lại / Password changed, please log in" (passed in router state, like the `ACCOUNT_LOCKED` message in §5.2).

### 5.11.4 `/forgot-password` screen (planned, §2.12.3, §2.12.4)

A public route beside `/login`. One screen, two steps:

1. **Email.** `POST /api/auth/password/forgot { email }` → always 202 `{ resendAfter: 60 }`, then step 2. The wording must not say whether the account exists (e.g. "If this email has an account, we sent a code to it").
2. **Code and new password.** The same code box as §5.11.2, a new password and its confirmation (same checks as Register: ≥ 8 characters, ≤ 72 bytes, confirm matches; `PasswordField` with show/hide), and Resend (it calls `forgot` again; the same countdown). `POST /api/auth/password/reset { email, code, newPassword }` → **204** → `/login` with the "password changed" message. No auto-login.

| Answer | Shows |
|---|---|
| 503 `FEATURE_NOT_CONFIGURED` (step 1) | "Password reset by email isn't set up; ask the admin" (a screen-specific text: today's `errors:FEATURE_NOT_CONFIGURED` is generic) |
| 400 `CODE_INVALID`, 400 `CODE_EXPIRED`, 429 `RATE_LIMITED` | As on `/verify-email` |
| 403 `ACCOUNT_LOCKED` | The existing locked text; the code is spent |
| 400 `VALIDATION_ERROR` | Marks the password fields named in `details`, as Register does |

### 5.11.5 Translations (planned)

Keys and wording are left to the builder (§2.12.6), in vi and en. The email itself is written by the server.

| Where | Strings |
|---|---|
| `auth`, `/verify-email` | Page `<title>`; "Kiểm tra email của bạn"; "We sent a 6-digit code to …"; the code box's label; Confirm; "Didn't get it? Check spam/junk"; Resend and "Resend (in N s)"; "A new code was sent"; "Wrong email? Change it"; "Wrong code" with the tries left (plural) |
| `auth`, `/forgot-password` | Page `<title>`; both steps' headings and help lines (step 1 neutral about whether the account exists); new password and confirm labels; the send and save buttons; "Password reset by email isn't set up; ask the admin" |
| `auth`, Login | "Quên mật khẩu?"; "Mật khẩu đã được đổi, hãy đăng nhập lại" |
| `errors` | `CODE_INVALID`, `CODE_EXPIRED`, `EMAIL_SEND_FAILED` |

### 5.11.6 Accessibility (planned)

- **Code box:** one labelled input. `autocomplete="one-time-code"` lets phones offer the code from the mail. Errors are tied to it with `aria-describedby`, and focus goes back to it after an error (the §5.7 rule: focus moves to the first wrong field).
- **Auto-submit on the 6th digit:** a `role="status"` line says the code is being checked, so a screen reader user knows something happened.
- **Countdown:** the seconds show in the Resend button's text, but they are not a live region (no announcement every second). "A new code was sent" is announced once (`role="status"`).
- **Steps:** when `/forgot-password` moves to step 2, its heading takes focus (a `tabIndex={-1}` heading, as in §5.9.7).
- **Login message:** "Password changed, please log in" is announced once (`role="status"`).

### 5.11.7 Open questions

1. **Other tab or device:** `/verify-email` opened without the `sessionStorage` entry goes to `/register`. Should it instead ask for the email, so a code read on a phone can be typed on a computer?
2. **Pasted codes with spaces** ("123 456") or a leading space: strip them before counting to 6?
3. **Resend on step 2 of `/forgot-password`:** §2.12 has no reset-resend endpoint, so it calls `forgot` again. Confirm that this is meant.
4. **Sign-up on the way to `/link`:** §5.9.8 item 5 asks whether `RegisterPage` honours `state.from`; the same applies after `/verify-email`.
