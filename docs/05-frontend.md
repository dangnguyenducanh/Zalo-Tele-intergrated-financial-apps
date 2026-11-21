# 5. Frontend (React + Vite + TypeScript)

## 5.1 Structure

Created from Vite's `react-ts` template. All source files are `.ts` / `.tsx`.

```text
client/src/
├── main.tsx               # <Provider store> <AuthProvider> <AppThemeProvider> <RouterProvider>
├── router.tsx             # route table (below)
├── app/
│   ├── store.ts           # configureStore({ api.reducer, ui }); exports RootState, AppDispatch
│   ├── hooks.ts           # typed useAppDispatch / useAppSelector
│   ├── api.ts             # RTK Query createApi + baseQueryWithRefresh, typed endpoints
│   └── uiSlice.ts         # themeMode, language, filters, snackbar
├── auth/
│   ├── AuthContext.tsx    # user, accessToken, status, login(), register(), logout(), refresh()
│   ├── ProtectedRoute.tsx # redirect to /login if not authenticated
│   └── AdminRoute.tsx     # 403 page if role !== 'admin'
├── components/            # AppLayout, NavDrawer, BottomNav, QuickAdd, MoneyText, MonthPicker, ConfirmDialog, EmptyState, ThemeToggle, LanguageSwitch
├── features/
│   ├── dashboard/  transactions/  wallets/  categories/  budgets/
│   ├── bot/        # BotInboxPage, LinkCard, DraftList, ReceiptUpload
│   ├── settings/   # ProfileForm, PasswordForm, SessionsList, PreferencesForm
│   └── admin/      # UsersPage, DefaultCategoriesPage
├── types/api.ts           # User, Wallet, Category, Transaction, Budget, Stats, ApiError, Paginated<T>, …
├── i18n/                  # index.ts, vi.json, en.json
└── theme/theme.ts         # createTheme for light and dark
```

### TypeScript rules

- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"jsx": "react-jsx"`, path alias `@/* → src/*`.
- **API types** live in `types/api.ts` and mirror the response shapes in [04-backend.md](04-backend.md) (e.g. `type Transaction = { id: string; type: 'expense' | 'income'; amount: number; status: 'draft' | 'confirmed'; source: 'web' | 'telegram' | 'zalo' | 'receipt'; … }`). Every RTK Query endpoint is typed `builder.query<ResultType, ArgType>`.
- `ApiError = { error: { code: string; message: string; details?: unknown } }`, with a type guard `isApiError()` used by forms and the error toast.
- Money is `number` (integer VND). A branded type `type Vnd = number & { __brand: 'VND' }` is optional polish.
- Scripts: `npm run typecheck` (`tsc --noEmit`) runs in the build and before every commit. The Vercel build fails on type errors.
- The backend stays plain JavaScript (ES modules), as required by the slides (Express). Only the frontend is TypeScript.

## 5.2 Routes

```jsx
/login, /register                      → public (redirect to / if already logged in)
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

Pages are lazy-loaded (`React.lazy`) so the first load stays small.

## 5.3 State management (slide requirement 2)

| State | Where | Why |
|---|---|---|
| Logged-in user, access token, auth status | **`AuthContext`** | Required "Context for login". The token lives only in memory, never in localStorage |
| Server data (wallets, categories, transactions, budgets, stats, drafts, sessions, admin lists) | **Redux Toolkit – RTK Query** (`app/api.js`) | Caching, loading/error flags, automatic refetch after mutations via tags |
| UI state (theme mode, language, transaction filters, snackbar) | **Redux Toolkit – `uiSlice`** | Shared across pages; theme and language are mirrored to localStorage |
| Form input | Local `useState` in the form component | Keeps forms simple |

**RTK Query tags:** `Wallet`, `Category`, `Transaction`, `Budget`, `Stats`, `Draft`, `Session`, `ChatLink`, `AdminUser`, `AdminCategory`. Example: creating a transaction invalidates `Transaction`, `Stats`, `Budget` and `Wallet`, so the dashboard, budget bars and wallet balances update automatically.

**Token handling (`baseQueryWithRefresh`):**

1. Add `Authorization: Bearer <accessToken>` (read from AuthContext through a small token getter).
2. On a 401 `TOKEN_EXPIRED`, call `POST /api/auth/refresh` once (shared promise, so parallel requests wait for one refresh). Then retry the original request.
3. If the refresh fails, `logout()` and redirect to `/login`.
4. On app start, `AuthProvider` calls `/auth/refresh` to restore the session from the httpOnly cookie, showing a splash screen while it runs.

## 5.4 Responsive layout

- **Desktop (≥ md):** permanent left drawer (nav), top app bar (month picker, language, theme, avatar menu), content in a max-width container.
- **Mobile (< md):** top app bar plus **bottom navigation** (Dashboard, Transactions, Bot inbox, Budgets, More); a floating **+** button opens "Add transaction".
- Tables become card lists below `sm`. Dialogs go full-screen below `sm` (`fullScreen={isMobile}`).
- MUI `Grid` and `useMediaQuery(theme.breakpoints.down('md'))` handle the switches.

## 5.5 Theming (light / dark / system)

- `theme/theme.ts` exports `getTheme(mode)` with palettes for `light` and `dark` (draft 3, T18): pale sky ground `#f3f8fd` with white cards, or deep navy `#0a1222` with `#111b2e` cards; sky for income and links (`#0369a1` / `#38bdf8`), pink for spending (`#db2777` / `#f472b6`); the main action and the balance card use the sky→blue→pink `GRADIENT`, deep enough for white text at 4.5:1. Every text colour keeps 4.5:1 on its ground (TC-NF-03 runs axe in both modes). `system` follows the OS live (Settings → Giao diện → Theo hệ thống).
- **Design system (T18, draft 3):** rounded consumer-finance look: 12 px inputs, 20 px cards with a soft shadow, pill buttons, chips and toggles; light-weight large headings and uppercase card captions; Be Vietnam Pro self-hosted from `@fontsource/be-vietnam-pro` (300–600, Vietnamese subset; TC-NF-13). Money uses tabular digits (`moneySx`). Line icons (Lucide via `components/icons.ts`); category rows use a round soft tile with the category's icon in its colour. Phones get a floating pill tab bar whose current tab is a gradient pill with its label; the desktop drawer marks the current page the same way. Hover and press: buttons step up 1 px and press with scale .985, only for a fine pointer without `prefers-reduced-motion`; the ripple is off and `.Mui-focusVisible` draws a 2 px ring.
- `themeMode` in `uiSlice`: `light | dark | system`. `system` follows `prefers-color-scheme` via `useMediaQuery`.
- `ThemeToggle` in the app bar cycles the modes. The choice is saved to localStorage immediately and to `PATCH /users/me {theme}` when logged in. The user's saved theme is applied after login.
- `<CssBaseline enableColorScheme />` so scrollbars and form controls follow the mode. Recharts colours come from `theme.palette`.

## 5.6 Internationalisation (vi / en)

- `i18next` + `react-i18next` + language detector. Order: user profile → localStorage → browser. Fallback `vi`.
- Files: `i18n/vi.json`, `i18n/en.json`, namespaced by page (`dashboard.title`, `transactions.filters.wallet`, `errors.WALLET_IN_USE`, …).
- **API errors:** look up `t('errors.' + error.code)`, falling back to a generic message.
- **Money:** `MoneyText` uses `new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })`.
- **Dates:** `Intl.DateTimeFormat` with `timeZone: 'Asia/Ho_Chi_Minh'`.
- **Default categories** show `names[lang]`; user categories show `name`.
- `LanguageSwitch` updates i18next, `uiSlice`, localStorage, and `PATCH /users/me {language}` (which also changes the bot's reply language).

## 5.7 Screen details

| Screen | Components and behaviour |
|---|---|
| **Login / Register** | Split layout: the form on the left; from `md` up, a dark panel on the right with what the app does and a preview built from the app's own components (month figure, budget bar, Telegram chat), hidden from screen readers because the text beside it says the same; zod validation messages; show/hide password; language and theme switch in the corner; server errors shown with translated codes |
| **QuickAdd (component)** | One text field: "Bạn vừa chi gì? — e.g. phở 45k". After a 300 ms pause it calls `POST /api/transactions/parse` and shows preview chips (amount · category · wallet · date) that can be clicked to change. **Enter** saves via `POST /api/transactions`; **Shift+Enter** opens the full form pre-filled. Several lines save several transactions. Errors (no amount) show inline in the user's language |
| **Dashboard** | `QuickAdd` at the top; `MonthPicker`; a gradient total-balance card (active wallets, month in/out) beside the month's 4 figure cards; this month vs last month in weekly columns with a Chi tiêu / Thu nhập switch and a computed sentence (TC-NF-14); ranked category breakdown; "Drafts waiting" banner linking to Bot inbox; "Budgets to watch" banner listing category budgets past 80 % / 100 % (same thresholds as Budgets) linking to Budgets; latest 5 transactions; one error banner with Retry covers every dashboard query, so a failed request never shows as 0 ₫ |
| **Transactions** | `QuickAdd`; filter bar (date range, type, wallet, category, status, search) synced to the URL query string; paginated table or cards; add/edit dialog (amount input with thousand separators, `k`/`tr` shortcuts like the bot); delete → snackbar with **Undo** (`/restore`) |
| **Wallets** | Card per wallet with computed balance; add/edit dialog (type, opening balance, aliases for the bot); archive toggle; delete blocked with an explanation when in use |
| **Categories** | Tabs Expense / Income; list with icon, colour, keyword chips; add/edit dialog with a keyword chip input (normalised to no-diacritics) |
| **Budgets** | `MonthPicker`; progress bar per category (green < 80 %, amber 80–100 %, red > 100 %); add/edit/delete; "Copy from last month" |
| **Bot inbox** | **Link card**: "Generate code" → shows the code, a countdown, the Telegram deep link and a QR code, plus Zalo instructions (`/link CODE`). **Linked accounts** with unlink. **Drafts list**: source icon (Telegram/Zalo/receipt), parsed fields editable inline, receipt line items expandable, Confirm / Discard. **Upload receipt**: resize in the browser (canvas → JPEG ≤ 1600 px) → `POST /api/receipts` with a progress spinner (~20–40 s) |
| **Settings** | Profile (name, default wallet), password change, preferences (language, theme), sessions list (device, last used, "this device") with revoke and "Log out other devices" |
| **Admin · Users** | Search and filter; role and status chips; lock/unlock and promote/demote with confirm dialogs |
| **Admin · Default categories** | Tabs by type; vi/en names, keywords, icon, colour; CRUD |

## 5.8 Dev setup notes

- `vite.config.js`: `server.proxy = { '/api': 'http://localhost:3000' }`, so local dev is also same-origin and cookies behave as in production.
- Build: `npm run build -w client` → `client/dist` (served by Vercel).
- Accessibility basics: every icon button has an `aria-label` (translated); charts have a text summary and add no Tab stops of their own; colour is never the only signal (labels on budget bars).
