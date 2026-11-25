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
│   ├── settings/   # SettingsPage, ProfileForm, PasswordForm, SessionsList, PreferencesForm
│   ├── admin/      # AdminUsersPage, AdminCategoriesPage, TemplateDialog
│   └── notFound/   # NotFoundPage
├── types/api.ts           # shared types: User, Language, ThemeMode, AuthResponse, RegisterInput, UpdateMeInput, ApiError + isApiError()
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

## 5.3 State management (slide requirement 2)

| State | Where | Why |
|---|---|---|
| Logged-in user, access token, auth status | **`AuthContext`** | Required "Context for login". The token lives only in memory (`auth/session.ts`), never in localStorage |
| Server data (wallets, categories, transactions, budgets, stats, drafts, sessions, admin lists) | **Redux Toolkit – RTK Query** (base `app/api.ts`; each feature with server data adds its endpoints in its own `*Api.ts` with `api.injectEndpoints`, e.g. `features/dashboard/statsApi.ts`; `PATCH /users/me` is in `auth/usersApi.ts`) | Caching, loading/error flags, automatic refetch after mutations via tags |
| UI state (theme mode, language, selected month, snackbar) | **Redux Toolkit – `uiSlice`** | Shared across pages; theme and language are mirrored to localStorage. The month is shared by Dashboard and Budgets |
| Transaction filters and page | URL query string (`useSearchParams`) | Shareable, survive reload and the login redirect |
| Form input | Local `useState` in the form component | Keeps forms simple |

**RTK Query tags:** `Wallet`, `Category`, `Transaction`, `Budget`, `Stats`, `Draft`, `Session`, `ChatLink`, `AdminUser`, `AdminCategory`. Example: creating a transaction invalidates `Transaction`, `Stats`, `Budget` and `Wallet`, so the dashboard, budget bars and wallet balances update automatically.

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
- Files: `i18n/<lang>/<namespace>.json`, one namespace per feature, picked up automatically by `import.meta.glob`. 12 namespaces: `common` (the default), `auth`, `dashboard`, `transactions`, `wallets`, `categories`, `budgets`, `bot`, `settings`, `admin`, `notFound`, `errors`. Counts use i18next plurals (`key_one` / `key_other`).
- **API errors:** `errorMessage(code)` in `i18n/errors.ts` looks up `errors:<CODE>`, falling back to `errors:GENERIC`.
- **Money:** `formatMoney()` in `i18n/format.ts` (used by `MoneyText`) uses `new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })`.
- **Dates:** `Intl.DateTimeFormat` with `timeZone: 'Asia/Ho_Chi_Minh'`.
- **Default categories** show `names[lang]`; user categories show `name`.
- `LanguageSwitch` updates i18next, `uiSlice`, localStorage, and `PATCH /users/me {language}` (which also changes the bot's reply language). A saved language change invalidates `Stats`, because `GET /stats/by-category` names categories in the profile's language.
- If the `PATCH` for a theme or language change fails, the change still applies on this device and a warning snackbar says it only lasts until the page is reloaded.

## 5.7 Screen details

| Screen | Components and behaviour |
|---|---|
| **Login / Register** | Split layout: the form on the left; from `md` up, a dark panel on the right with what the app does and a preview built from the app's own components (month figure, budget bar, Telegram chat), hidden from screen readers because the text beside it says the same; hand-written checks before sending (no zod on the client): email with the same pattern as the server, name 1–60 characters, password ≥ 8 characters and ≤ 72 bytes (a Vietnamese letter takes 2–3), confirm matches; focus moves to the first wrong field; a `VALIDATION_ERROR` from the API marks the fields named in its `details`; show/hide password; language and theme switch in the corner; server errors shown with translated codes |
| **QuickAdd (component)** | One text field: "Bạn vừa chi gì? — e.g. phở 45k". After a 300 ms pause it calls `POST /api/transactions/parse` and shows preview chips (amount · category · wallet · date) that can be clicked to change. **Enter** (or Save) saves via `POST /api/transactions`; **Shift+Enter** or the **Open full form** button opens the full form pre-filled. Several lines save several transactions, at most 10: with more, nothing is saved and the box says so. Lines the parser cannot read (no amount, or above 10¹³ ₫) are named by line number and nothing is saved until they are fixed. A preview line with no wallet or category blocks saving too. Errors show inline in the user's language |
| **Dashboard** | `QuickAdd` at the top; `MonthPicker`; a gradient total-balance card (active wallets, month in/out) beside the month's 4 figure cards; this month vs last month in weekly columns with a Chi tiêu / Thu nhập switch and a computed sentence (TC-NF-14); ranked category breakdown; "Drafts waiting" banner linking to Bot inbox; "Budgets to watch" banner listing category budgets past 80 % / 100 % (same thresholds as Budgets) linking to Budgets; latest 5 transactions; one error banner with Retry covers every query whose figures it shows, so a failed request never shows as 0 ₫ |
| **Transactions** | `QuickAdd`; filter bar (date range, type, wallet, category, status, search) synced to the URL query string; paginated table or cards; add/edit dialog (amount input with thousand separators, `k`/`tr` shortcuts like the bot, at most `MAX_MONEY` = 10¹³ ₫ with an "At most …" message); delete → snackbar with **Undo** (`/restore`) |
| **Wallets** | Card per wallet with computed balance; add/edit dialog (type cash / bank / e-wallet / credit card, opening balance from −10¹³ to 10¹³ ₫ so a credit card can start negative, aliases for the bot); archive toggle; delete blocked with an explanation when in use. Archiving or deleting the default wallet clears it (server), and the signed-in user is updated so forms stop offering it |
| **Categories** | Tabs Expense / Income; list with icon, colour, keyword chips; add/edit dialog with a keyword chip input (normalised to no-diacritics) |
| **Budgets** | `MonthPicker`; progress bar per category (green < 80 %, amber 80–100 %, red > 100 %); add/edit/delete (limit at most 10¹³ ₫); "Copy from last month" |
| **Bot inbox** | **Link card** (docs/02 §2.10.2): "Generate code" → shows the code and a countdown (focus moves to it), an app picker (Telegram \| WhatsApp \| Zalo, only the apps whose `links` entry is not `null`; it starts on the first app not linked yet, else the first shown), the picked app's instruction line, its button and a QR code of the same link, and `/link CODE` to send by hand. **Open Telegram** and **Open WhatsApp** open the link in a new tab; **Copy & open Zalo** copies `/link CODE` (`navigator.clipboard.writeText`) and opens `ZALO_BOT_URL`; a status line says "Copied" or, if copying fails, to copy the command by hand. Every 5 s while the code is live it reloads the linked accounts; a link that was not there when the code was made replaces the code with "Linked ✓ <app> · <name>" (focused) and stops the checks. **Linked accounts** with unlink. **Drafts list** (refetched every time the inbox opens, since drafts also change in the chats): source icon (Telegram/Zalo/receipt), parsed fields editable inline (amount at most 10¹³ ₫), receipt line items expandable, Confirm / Discard. Confirm sends the edits together with the confirm in one request (`POST /transactions/:id/confirm`); a 409 (already confirmed in the chat) or 404 (deleted) removes the card; a budget warning from the server shows as a warning snackbar. **Upload receipt**: resize in the browser (canvas → JPEG ≤ 1600 px) → `POST /api/receipts` with a progress spinner (~20–40 s) |
| **Settings** | Profile (name, default wallet), password change, preferences (language, theme), sessions list (device, last used, "this device") with revoke and "Log out other devices" |
| **Admin · Users** | System stats cards (users, active in 7 days, chat links, transactions by source; not shown if that request fails); search and filter, applied on submit (the same search again refetches); role and status chips; lock/unlock and promote/demote with confirm dialogs; a failed list load shows an error with Retry |
| **Admin · Default categories** | Tabs by type; vi/en names, keywords, icon, colour; CRUD in `TemplateDialog`. A failed load shows an error message without a Retry button |

A failed load of a page's main data (Dashboard, Transactions, Wallets, Categories, Budgets, Bot drafts and linked accounts, Settings sessions, Admin users) shows an error banner with **Retry** instead of empty or zero data; the dashboard uses one banner for every query whose figures it shows (the drafts-waiting count and category names are secondary lookups). Exceptions: Admin · Default categories has no Retry, and the admin stats cards are hidden on failure. Secondary lookups (e.g. category names on Budgets and Dashboard, the drafts-waiting count, the wallet list in Settings) do not show their own error.

## 5.8 Dev setup notes

- `vite.config.ts`: `server.proxy` forwards `/api` to `http://localhost:<PORT>` (default 4100; Vite itself on `VITE_PORT`, default 5300; `tools/wt-env.sh` gives each worktree its own ports), so local dev is also same-origin and cookies behave as in production. The same file holds the Vitest config.
- Build: `npm run build -w client` → `client/dist` (served by Vercel).
- Accessibility basics: every icon button has an `aria-label` (translated); charts have a text summary and add no Tab stops of their own; colour is never the only signal (labels on budget bars).
