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
/link                                  → (planned, §2.10) Link a chat: outside <ProtectedRoute>, logs in by itself (§5.9.2)
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
| *(planned, §2.10)* Claim token from `/link?t=` | Memory or `sessionStorage` (builder's choice), never the URL or `state.from` | It is a one-time credential: it leaves the address bar as soon as the page reads it (§5.9.2) |

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
| **Transactions** | `QuickAdd`; filter bar (date range, type, wallet, category, status, search) synced to the URL query string; paginated table or cards; add/edit dialog (amount input with thousand separators, `k`/`tr` shortcuts like the bot, at most `MAX_MONEY` = 10¹³ ₫ with an "At most …" message); delete → snackbar with **Undo** (`/restore`). *Planned (§5.9.5):* a WhatsApp source icon (no source is shown today) |
| **Wallets** | Card per wallet with computed balance; add/edit dialog (type cash / bank / e-wallet / credit card, opening balance from −10¹³ to 10¹³ ₫ so a credit card can start negative, aliases for the bot); archive toggle; delete blocked with an explanation when in use. Archiving or deleting the default wallet clears it (server), and the signed-in user is updated so forms stop offering it |
| **Categories** | Tabs Expense / Income; list with icon, colour, keyword chips; add/edit dialog with a keyword chip input (normalised to no-diacritics) |
| **Budgets** | `MonthPicker`; progress bar per category (green < 80 %, amber 80–100 %, red > 100 %); add/edit/delete (limit at most 10¹³ ₫); "Copy from last month" |
| **Bot inbox** | **Link card**: "Generate code" → shows the code, a countdown, the Telegram deep link and a QR code, plus Zalo instructions (`/link CODE`). **Linked accounts** with unlink. **Drafts list** (refetched every time the inbox opens, since drafts also change in the chats): source icon (Telegram/Zalo/receipt), parsed fields editable inline (amount at most 10¹³ ₫), receipt line items expandable, Confirm / Discard. Confirm sends the edits together with the confirm in one request (`POST /transactions/:id/confirm`); a 409 (already confirmed in the chat) or 404 (deleted) removes the card; a budget warning from the server shows as a warning snackbar. **Upload receipt**: resize in the browser (canvas → JPEG ≤ 1600 px) → `POST /api/receipts` with a progress spinner (~20–40 s). *Planned (§5.9.1, §5.9.3, §5.9.5):* an app picker (Telegram / WhatsApp / Zalo) with one button, instruction line and QR per app; the "New chat linked from a chat link: … Not you? [Unlink]" notice for a link made by a claim link, until dismissed; and a WhatsApp source icon |
| **Link a chat** *(planned, §2.10)* | `/link` screen opened from the bot's "tap to link" message: preview, then Confirm / Cancel (§5.9.2) |
| **Settings** | Profile (name, default wallet), password change, preferences (language, theme), sessions list (device, last used, "this device") with revoke and "Log out other devices" |
| **Admin · Users** | System stats cards (users, active in 7 days, chat links, transactions by source; not shown if that request fails); search and filter, applied on submit (the same search again refetches); role and status chips; lock/unlock and promote/demote with confirm dialogs; a failed list load shows an error with Retry |
| **Admin · Default categories** | Tabs by type; vi/en names, keywords, icon, colour; CRUD in `TemplateDialog`. A failed load shows an error message without a Retry button |

A failed load of a page's main data (Dashboard, Transactions, Wallets, Categories, Budgets, Bot drafts and linked accounts, Settings sessions, Admin users) shows an error banner with **Retry** instead of empty or zero data; the dashboard uses one banner for every query whose figures it shows (the drafts-waiting count and category names are secondary lookups). Exceptions: Admin · Default categories has no Retry, and the admin stats cards are hidden on failure. Secondary lookups (e.g. category names on Budgets and Dashboard, the drafts-waiting count, the wallet list in Settings) do not show their own error.

## 5.8 Dev setup notes

- `vite.config.ts`: `server.proxy` forwards `/api` to `http://localhost:<PORT>` (default 4100; Vite itself on `VITE_PORT`, default 5300; `tools/wt-env.sh` gives each worktree its own ports), so local dev is also same-origin and cookies behave as in production. The same file holds the Vitest config.
- Build: `npm run build -w client` → `client/dist` (served by Vercel).
- Accessibility basics: every icon button has an `aria-label` (translated); charts have a text summary and add no Tab stops of their own; colour is never the only signal (labels on budget bars).

## 5.9 One-tap linking and WhatsApp (planned, §2.10)

> **Not built yet.** §5.1–§5.8 describe the client as it is today. This section lists what changes on the client when [02-features.md §2.10](02-features.md#210-one-tap-linking-and-whatsapp-planned) is built; the endpoints and error codes are in [04-backend.md](04-backend.md). Each part moves into §5.2–§5.7 in the PR that builds it (§2.10.5). Left to the builder throughout: component and file layout, i18n keys and the exact wording (vi + en).

### 5.9.1 Link card on `/bot` (planned, §2.10.2)

Today `LinkCard.tsx` shows, once a code exists, the code and countdown, then a Telegram block (instruction, **Open Telegram**, QR of the deep link) and the Zalo `/link CODE` text, all at once. Planned (sketch in §2.10.2):

| | Today | Planned |
|---|---|---|
| Data | `telegramDeepLink` from `POST /api/chat-links/code` | `links: { telegram, whatsapp, zalo }`, each a URL or `null`. The client uses them as given and builds no URL itself |
| Layout | Telegram block and Zalo text shown together | An app picker **Telegram \| WhatsApp \| Zalo** (one choice); below it only the selected app's button, instruction line and QR |
| Default app | – | The first shown app (link not `null`), in that order, that is not linked yet: no row in `GET /api/chat-links` for this user (the list the card already polls). An app left out of the picker is never the default |
| Missing settings | Telegram block hidden when `telegramDeepLink` is `null`; Zalo text always shown | Any app whose link is `null` is left out of the picker (Zalo too, when `ZALO_BOT_URL` is not set) |
| QR | The Telegram deep link | The selected app's link. For Zalo it only opens the bot, so the large code stays on screen |
| Feedback | The new account appears under **Linked accounts** | Also `Linked ✓ <App> · <name>` on the card, as soon as the polled list has a link it did not have when the code was made |

| App | Button | On click | Instruction line |
|---|---|---|---|
| Telegram | **Open Telegram** (`TelegramIcon`) | Opens `links.telegram` (`https://t.me/<bot>?start=<CODE>`) in a new tab, as today | One tap, then press Start |
| WhatsApp | **Open WhatsApp** (`WhatsAppIcon`) | Opens `links.whatsapp` (`https://wa.me/<WHATSAPP_NUMBER>?text=%2Flink%20<CODE>`) in a new tab | `/link CODE` is already typed: tap Send |
| Zalo | **Copy & open Zalo** | `navigator.clipboard.writeText('/link CODE')`, then opens `links.zalo` (`ZALO_BOT_URL`) in a new tab | Paste and send. If copying fails (no Clipboard API, permission refused), the card says "Copy it yourself"; the `/link CODE` text, shown as today, stays visible and selectable |

**Unchanged from F7:** the "Create link code" button, 6-character code, 10-minute countdown, the 429 message after 5 codes in 10 minutes, checking `GET /api/chat-links` every 5 s while the code is live (`CHECK_LINKS_MS`), focus moving to the code, and the black-on-white QR from `qrCode.ts`.

**Builder notes:**
- `qrMatrix()` throws above 106 bytes. A `wa.me` link is at most ~51 bytes and a `t.me` link at most ~58, but `ZALO_BOT_URL` is whatever the owner pastes from Zalo Bot Creator, so it has to fit too.
- Opening the tab only after the clipboard promise settles can be stopped by a pop-up blocker. A real link (`href`, `target="_blank"`) whose click handler starts the copy always opens; see §5.9.8 for whether Zalo should open when the copy fails.

### 5.9.2 `/link` screen (planned, §2.10.3)

The bot's "tap to link" message opens `<APP_URL>/link?t=<token>`, a 32-character claim token.

**Route.** `ProtectedRoute` copies the query string into `state.from` and redirects before the page's code runs, so behind it `?t=` would ride through the login page and back into the address bar. `/link` therefore sits outside `<ProtectedRoute>`, beside `/login` (§5.2), and sends a logged-out visitor to log in itself, after removing `t`. §2.10 leaves layout to the builder; this placement is what §2.10.3 step 4 (token out of the address bar before the login redirect) needs with today's `ProtectedRoute`. Whether it is wrapped in `AppLayout` is left to the builder.

**Flow.** The router mounts only after the session is restored (`App` shows `<Splash />` until then), so the page knows at once whether the user is logged in.

1. Read `t` from the query string and remove it from the address bar with `history.replaceState` (React Router's `navigate('/link', { replace: true })` does that and keeps the router's location in step). This comes before any request or redirect.
2. Keep the token in memory or `sessionStorage`, never in the URL or `state.from`. Builder's choice: memory is lost if the login page is reloaded; `sessionStorage` survives that and stays in this tab.
3. Logged out: `<Navigate to="/login" replace state={{ from: '/link' }} />`. `LoginPage` already returns to `state.from` after login, so the user comes back to `/link` and the token is read from where step 2 kept it.
4. Logged in: `POST /api/chat-links/claim/preview { token }`. The server answers with the chat's `platform` and `displayName` from `linkCodes.chat`.
5. **Confirm:** the confirm screen shows §2.10.3's warning above the buttons (see the table). `POST /api/chat-links/claim { token }`. On 201 the page goes to `/bot` with `Linked ✓ <App> · <displayName>` (how that shows, e.g. the existing `showSnackbar`, is left to the builder), and the Bot inbox shows the claim notice (§5.9.3). The success message in the chat is sent by the server.
6. **Cancel:** goes to `/bot` with no request; the token expires by itself.

| State | When | Shows | Buttons |
|---|---|---|---|
| Loading | The preview request is running | A progress indicator | – |
| Confirm | Preview 200 `{ platform, displayName }` | "Link **`<App> · <displayName>`** to **`<user.name> (<user.email>)`**?" The app name is `sources.<platform>`; the name and email come from `useAuth().user`. Above the buttons, a warning: "Only confirm if you just messaged the bot yourself. The chat you link can see your spending and record money in this account." (the display name comes from the chat app and is not proof, §2.10.3) | **Confirm** (shows loading while the claim runs), **Cancel** |
| Done | Claim 201 `{ id, platform, displayName, createdAt, viaClaim: true }` | Redirect to `/bot` with `Linked ✓ <App> · <displayName>`; the claim notice (§5.9.3) shows there | – |
| Expired or used | Preview or claim 404 `LINK_TOKEN_INVALID` | "This link has expired or was already used. Send any message to the bot to get a new one." | **Go to Bot inbox** |
| Already linked | Claim 409 `CHAT_ALREADY_LINKED` (the token is spent anyway) | "This chat is already linked to an account." | **Go to Bot inbox** |

`<App> · <displayName>` uses the same format as Linked accounts (`nameOf()` in `LinkedAccounts.tsx`).

### 5.9.3 "Not you? [Unlink]" notice in the Bot inbox (planned, §2.10.3, §2.10.5)

The phishing guard after a link made from a chat (§2.10.3): someone may have confirmed a claim link that an attacker sent them, so the inbox says so until the user dismisses it.

- **When:** for every item of `GET /api/chat-links` (the list `LinkedAccounts.tsx` and the link card already load) with `viaClaim && !claimNoticeDismissedAt`. A link made with a code from the website has `viaClaim: false` and never shows it.
- **What:** one notice per such link: "New chat linked from a chat link: **`<App> · <displayName>`**. Not you? [Unlink]", with a dismiss button. Where it sits on `/bot` is left to the builder; above the two columns, under the intro, is seen first, and the linked accounts list keeps its own unlink button either way (§2.10.3).
- **Unlink:** the existing unlink of Linked accounts (its `ConfirmDialog`, then `DELETE /api/chat-links/:id`); the link goes, and its notice with it.
- **Dismiss:** `PATCH /api/chat-links/:id/claim-notice` (no body) → 204; the `ChatLink` tag is invalidated, the list refetches with `claimNoticeDismissedAt` set, and the notice is gone for good, on every device. A 404 (the link was unlinked meanwhile) also just refetches.

### 5.9.4 API types and RTK Query endpoints (planned)

In `features/bot/botApi.ts`, or with the `/link` screen's files; hook names are the builder's.

| Endpoint | RTK Query | Types | Tags |
|---|---|---|---|
| `POST /api/chat-links/code` (existing `createLinkCode`) | mutation, unchanged | Result `LinkCode = { code: string; expiresAt: string; links: { telegram: string \| null; whatsapp: string \| null; zalo: string \| null } }`; `telegramDeepLink` goes. Client and server change in the same PR (§2.10.2) | None, as today |
| `POST /api/chat-links/claim/preview` (new) | mutation, or a query with `method: 'POST'` and `body` | Arg `{ token: string }` → `{ platform: ChatLink['platform']; displayName: string }` | None |
| `POST /api/chat-links/claim` (new) | mutation | Arg `{ token: string }` → 201 `{ id, platform, displayName, createdAt, viaClaim: true }` (a `ChatLink` without `claimNoticeDismissedAt`) | Invalidates `ChatLink`, so Linked accounts, the link card and the claim notice refetch |
| `GET /api/chat-links` (existing `getChatLinks`) | query, unchanged | `ChatLink` gains `viaClaim: boolean` and `claimNoticeDismissedAt: string \| null` | Provides `ChatLink`, as today |
| `PATCH /api/chat-links/:id/claim-notice` (new) | mutation | Arg the link `id` → `void` (204) | Invalidates `ChatLink`, so the notice disappears |

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
| `bot`, link card | Card title and description naming all three apps (today "Link Telegram / Zalo"); the picker's group label; `sources.whatsapp`; **Open WhatsApp** and **Copy & open Zalo** (**Open Telegram** exists); one instruction line per app (replacing `link.telegram` and `link.zalo`); one QR label per app; "Copy it yourself"; `Linked ✓ <App> · <name>`; the page `intro`, which names Telegram and Zalo only |
| `/link` screen (in `bot`, or a new namespace: `import.meta.glob` picks it up, making 13) | Page `<title>`; loading; the confirm question (app · chat name, user name, email, with bold parts); the warning (vi + en of "Only confirm if you just messaged the bot yourself. The chat you link can see your spending and record money in this account."); **Confirm**; **Cancel**; the done message (may reuse the card's); the expired-or-used text; the already-linked text; **Go to Bot inbox** |
| `bot`, claim notice | "New chat linked from a chat link: **`<App> · <name>`**. Not you?" (with the bold part); **Unlink** (the dialog's texts exist in `accounts`); the dismiss button's label |
| `admin` | `stats.chatLinksDetail` and `stats.transactionsDetail` with WhatsApp |

### 5.9.7 Accessibility (planned)

- **Button names** are their visible text: "Open Telegram", "Open WhatsApp", "Copy & open Zalo", "Confirm", "Cancel", "Go to Bot inbox". App icons are decorative (MUI icons are `aria-hidden`).
- **Picker:** one labelled single-choice group (e.g. MUI `ToggleButtonGroup exclusive` with an `aria-label`, which marks the selected app with `aria-pressed`); each option is named by its app.
- **Focus:** after "Create link code", focus moves to the code (unchanged). Switching apps keeps focus on the picker. "Copy it yourself" and "Linked ✓ …" are announced without moving focus (`role="status"`). On `/link`, each state's heading takes focus when the state changes (a `tabIndex={-1}` heading, as in Linked accounts), so a screen reader reads the question or the error.
- **Confirm warning:** real text between the question and the buttons, read right after the question; **Confirm** points at it with `aria-describedby`, so it is read again on the button. It is not a live region (it is there when the state's heading takes focus) and colour is not its only sign (a warning icon plus the words).
- **Claim notice:** shown when the inbox loads, so it is page content, not a live region. Its buttons are named with the chat: "Unlink `<App> · <name>`" (as Linked accounts' `accounts.unlink`) and "Dismiss notice for `<App> · <name>`", so several notices are told apart. The buttons leave with the notice, so after Unlink or Dismiss focus moves to a heading (as Linked accounts does after its unlink), not to `<body>`.
- **QR alt text:** the SVG keeps `role="img"`, with an `aria-label` that names the selected app and what scanning does (today one Telegram label, `link.qr`).
- The `/link CODE` text stays real text, so it can be selected, copied by hand and read aloud.

### 5.9.8 Open questions

1. **Zalo, copy fails:** does the tab still open? A real link always opens it and no pop-up blocker can stop it; opening only after a successful copy needs `window.open` after an `await`, which some browsers block.
2. **Link card after "Linked ✓":** does the code stay (and polling go on) until it expires, or does the card reset? The code is single use either way.
3. **Picker edge cases:** which app is selected when every shown app is already linked, and what the card shows when all three links are `null`.
4. **`/link` gaps:** no token (opened bare, or `sessionStorage` empty) and network or 5xx errors on preview or claim have no state in §2.10.3. The §5.7 rule (error banner with **Retry**) is the obvious candidate for the second.
5. **New users:** `/login` links to `/register`, and `RegisterPage` always lands on `/`, so someone who registers on the way loses the return to `/link`. Should `RegisterPage` honour `state.from` too?
6. **Clearing the token:** after Confirm, Cancel or an error, so a spent token does not stay in `sessionStorage`.
7. **Transactions:** a source icon for WhatsApp only, or for every source (§5.9.5)?
