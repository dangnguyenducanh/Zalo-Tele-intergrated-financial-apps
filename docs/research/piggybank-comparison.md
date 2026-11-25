# PiggyBank vs our app: feature comparison

> Research note, 2026-11-25. PiggyBank is the public hackathon repo [HackPrincetonQANT/backend-frontned-agent-alltogether](https://github.com/HackPrincetonQANT/backend-frontned-agent-alltogether), run locally in demo mode (DuckDB instead of Snowflake, a stub user instead of Clerk) to compare features and pick ideas worth bringing over. Its picks feed [docs/09-agent-features.md](../09-agent-features.md).

## PiggyBank (theirs) vs our Vietnamese personal-finance app

Effort scale: **S** = about a day, **M** = 2 to 4 days, **L** = a week or more. Before ranking the top picks I re-read the files behind them: `predictor.py`, `smart_tips.py`, `main.py` (`/api/coach`, lines 210-301), `do_llm.py`, `agent/aiAgent.js`, `Insights.tsx` lines 111-122, `Home.tsx` lines 11-14 and 100, and `Mascot.tsx`. On our side I re-read `services/stats.js`, `services/budgets.js`, `bot/core.js` `runCommand`, `models/Transaction.js`, `seed/*`, `vercel.json` and `docs/02-features.md` (non-goals).

## 1. Summaries

**PiggyBank (theirs).** This is a hackathon US savings app. It has a React + Tailwind front end behind Clerk sign-in, a FastAPI back end on Snowflake (run locally on a DuckDB stand-in) and a Node iMessage agent that only runs on macOS. What it does well is the "smart layer": a heuristic model that predicts the next repeat purchase with a confidence score, rule-based "Piggy Tips", a "cheaper store" sidebar, a React Flow spending graph and a charming CSS piggy mascot. Its weakness is that much of what you see is staged. Every screen hardcodes `userId = 'u_demo_min'`, so every user sees the same data. The goal (Bike $250) is hardcoded and contradicts itself ($17 saved on Home, $167 on Insights). The streak (12 days) is hardcoded. Three of the four onboarding steps are buttons that only flip a state, and the Connections tab shows every vendor as connected. The LLM path of the graph never runs because of a call-signature bug, and the AI coach endpoint works but no screen calls it. The back end has no auth and no tests, and opens a new Snowflake connection for every query. Receipts come in through iMessage and Gemini and are all saved under the demo user, whoever sent them.

**Ours.** This is a working, deployed (Vercel + Atlas) Vietnamese-first expense tracker. It has its own JWT and refresh-cookie auth with session management, wallets, categories with bot keywords, transactions, monthly budgets with 80% and 100% warnings, a monthly dashboard and an admin console. Capture is the strong point. A rule-based vi/en parser (`phở 45k`, `+lương 15tr`, `grab 32k hôm qua mm`) powers web quick add, a Telegram bot (buttons) and a Zalo bot (`ok` / `huy`). Bot and receipt inputs become drafts that the user confirms. Receipt photos are read by a self-hosted KIE OCR service. The project has 300+ automated tests. Its main gap against PiggyBank is that it records and reports but never looks ahead or advises. The only "insight" is the budget warning. It also has no personality (mascot, streaks) and never messages the user first. The docs deliberately rule out AI text parsing (`docs/02-features.md` non-goals; `docs/01-architecture.md`: "deterministic, free, and fully explainable at the defense").

## 2. Feature matrix

| Feature | Theirs: maturity | Ours | Gap |
|---|---|---|---|
| Sign-in / auth | Clerk sign-in: working. Back end has no auth | F1 JWT + rotating refresh cookie, sessions, revoke, rate limit: working | We are ahead |
| Per-user data isolation | Stub: everyone is `u_demo_min` | Every query scoped by `userId` from the JWT | We are ahead |
| Onboarding wizard | Partial/stub: 4 steps, 2 fake connect buttons, goal thrown away | None: register, then dashboard with default wallet and 13 categories | Idea gap: first-run checklist |
| Merchant linking (Knot) | Stub/partial: route not served by the default stack | Not needed (manual, bot and receipt capture) | Skip |
| Bank balance (Nessie) | Working on one sandbox account; key shipped to browser; plain HTTP | F2 wallets with computed balances | We cover the real need |
| Savings goal + progress | Stub: hardcoded, two different numbers | None | Gap (idea only) |
| Weekly savings target | Partial: local state, not saved | F5 monthly budgets per category and overall | We are ahead (different concept) |
| Piggy mascot | Working visuals; mood never wired (always 100) | None | Gap: cheap demo charm |
| Transaction list | Working: last 20 rows, "This Week" label is wrong | F4 CRUD, filters, paging, undo | We are ahead |
| Spending by category chart | Working SVG pie; one category = blank pie | Ranked list with bars, accessible `<figure>` | About equal |
| Next-purchase predictions | Working heuristic (`predictor.py`) | None | **Gap: top pick** |
| Savings tips | Working rules, but USD/US brands, and a 60-day window labelled "/mo" | Budget warning at 80/100% only | **Gap: top pick** |
| Better Deals (cheaper store) | Partial: static US store map, groceries only | None | Skip |
| "AI" Deals | Stub: hardcoded marketing copy, no AI | None | Skip |
| Piggy Graph | Partial: LLM call broken (1 argument vs 2), fallback strings mention Princeton | None | Skip |
| Savings streak | Stub: `streakDays = 12` | None | Gap (idea only, cheap) |
| AI coach text | Partial: `/api/coach` works but no UI calls it; errors return HTTP 200 | None (deliberately no LLM) | Optional |
| Chat Q&A agent (GPT tools) | Partial: not the default entry point; history-trim bug | `/today`, `/month`, `/lang`, `/help` | Optional, later |
| Multi-language | README only | F12 full vi/en in UI, errors and bots | We are ahead |
| Reaction-aware coaching / terminal chat | README only | None | Skip |
| Receipt photo to transactions | Working: Gemini vision, no validation, date = now, demo user | F8/F10 KIE OCR to draft, line items, reconciliation, confirm | We are ahead on flow |
| Chat channel | iMessage on a Mac; any sender writes to the demo account | Telegram + Zalo webhooks, link codes, secret check, dedupe | We are ahead |
| Push nudge ("Ping Me Now") | Working for the demo: manual button, hardcoded phone number | None (no outbound messages) | Gap (idea) |
| Cheap nearby places | Partial: experimental Gemini model, Princeton hardcoded | None | Skip |
| Search | Partial: `ILIKE` labelled "semantic" | Note regex search (not accent-insensitive) | About equal |
| LLM product categorization | Partial: offline script, test user | Rule-based keyword match | Skip (our own decision) |
| Demo data seed | Working: scripted 60-day story, dates relative to now | `seed:test` creates users only, no transactions | **Gap: enabler** |
| Wallets | None | F2 working | Ours only |
| Category management + keywords | Fixed category strings | F3 working | Ours only |
| Quick-add text parser | None | F13 working, shared with bots | Ours only |
| Bot linking + draft inbox | None (no user mapping) | F7 + F9 working | Ours only |
| Admin console | None | F11 working | Ours only |
| Theme | Cream/brown Tailwind, no dark mode, invalid classes | MUI light/dark/system, synced | We are ahead |
| Tests / ops | No tests, CORS localhost only, macOS/conda scripts | Vitest server + client, Playwright, Vercel deploy | We are ahead |

## 3. Worth bringing over (ranked)

### 1. Upcoming repeat spending ("Sắp tới bạn có thể chi"), from `predictor.py`
- **User value:** the app tells you what is coming ("Grab in about 2 days, Netflix 260k on the 3rd") instead of only recording the past. This is the one feature that most visibly looks smart in a demo.
- **Mapping:**
  - Add a new `predictUpcoming(userId)` in a new `server/src/services/insights.js`. It runs a Mongo `find` over confirmed, non-deleted expenses from the last 90 days, grouped in JS by `(categoryId, normalize(note))` using the existing `utils/normalize.js`. Rows with an empty note are skipped.
  - Expose it as `GET /api/stats/upcoming`, show a dashboard card, and add a bot command (`/next`, `/sapchi`) through `runCommand` and `messages.vi.js` / `messages.en.js`. Dates use `vnTime.js`.
  - Mongo instead of Snowflake. No LLM.
- **Effort:** S to M.
- **Reusable?** The idea and the formula are worth taking (mean interval; confidence = 0.2 + 0.4·min(n/10,1) + 0.4·clamp(1−CV)). It is about 40 lines of Python to re-write in JS, so their code itself is not reusable. Fix two real flaws while porting:
  - With 2 purchases there is one interval, so CV = 0 and confidence is already **0.68**. Require at least 3 purchases.
  - Predictions already in the past are never filtered out. Drop or roll forward anything more than one interval overdue.
- **Risks:** notes are free text, so "phở" and "pho bo" become separate groups. A fresh account shows nothing (see pick 6).

### 2. Rule-based savings tips ("Gợi ý tiết kiệm"), from `smart_tips.py`
- **User value:** 2 to 4 concrete, explainable observations each month.
- **Mapping:** same `insights.js`, built on `stats.totalsByCategory`, `budgets.listBudgets` and pick 1's intervals. Rules rewritten for VND and our default categories:
  - **Frequent small spend:** the same normalized note at least 8 times in 30 days in Ăn uống or Đi lại, for example "phở 45k × 12 = 540k this month".
  - **Category up against last month** by more than 30%. The dashboard already loads the previous month.
  - **Likely subscription:** the same amount at a roughly monthly interval, reusing pick 1.
  - **Budget pace:** percent of budget used is ahead of percent of the month elapsed, so the projected month-end figure goes over. This rule is our addition, not theirs; it reuses the budgets data.

  Show it as a dashboard card and in `/month`.
- **Effort:** M.
- **Reusable?** Only the idea. Their rules use US brands (Disney+/Hulu bundle, gym), USD thresholds and invented saving factors ("60% savings possible", "30%"). They also total a 60-day window but label it "/mo". Show real amounts, not made-up savings figures. That keeps the "explainable at the defense" principle.
- **Risks:** noisy tips when data is thin; every string needs both vi and en.

### 3. Logging streak, an idea taken from their hardcoded Savings Streak
- **User value:** a habit hook that fits a bot-first tracker ("🔥 6 ngày liên tiếp").
- **Mapping:** one aggregation with `$dateToString` in `Asia/Ho_Chi_Minh`, the same pattern as `stats.daily`. It collects the distinct dates with at least one confirmed transaction in the last 60 days and counts back from today (or from yesterday). Show it on a dashboard card, and append it to the bot's "✅ Saved" reply and to `/today`.
- **Effort:** S.
- **Reusable?** Idea only: theirs is the constant `12`.
- **Risks:** call it a *logging* streak. A *savings* streak needs goal data that we don't have.

### 4. First-run checklist, a working version of their stubbed onboarding
- **User value:** guides a new user, and the examiner, through the demo path: link Telegram or Zalo, send "phở 45k", confirm, set a budget, try a receipt.
- **Mapping:** a dashboard card computed from existing data: count of `ChatLink`, any `Budget` this month, any transaction, any `source: 'receipt'` transaction. No new model. Remember a dismissal in `localStorage` (wrapped in try/catch, as `uiSlice` already does).
- **Effort:** S.
- **Reusable?** Idea only. Their steps are Clerk-metadata flags plus fake Capital One and iMessage buttons.
- **Risks:** small. Keep it hidden once everything is done.

### 5. Piggy-bank ("heo đất") mascot whose mood follows the budget, from `Mascot.tsx`
- **User value:** personality and a glanceable "am I OK this month". *Heo đất* is the traditional Vietnamese piggy bank, so it fits the local audience naturally.
- **Mapping:** client only. Happiness = 100 − the fullest budget percentage, using the existing `budgetLevel` / budgets query, shown on the dashboard. Optionally map the 5 moods to an emoji in bot replies.
- **Effort:** S to M.
- **Reusable?** The 5-mood thresholds and the hover-only eye-tracking `mousemove` logic carry over. The markup does not: it is Tailwind and we use MUI `sx` or plain CSS, and some classes such as `border-3` are invalid. Note that their Home always passes `happiness={100}`, so the mood logic was never actually shown.
- **Risks:** respect `prefers-reduced-motion`; give it dark-theme colours; keep it small on phones.

### 6. Scripted demo history seed, from `seed_data.py`
- **User value:** picks 1 to 3 need about 60 days of history to look good. Their demo looks rich only because of this script.
- **Mapping:** add `npm run seed:demo` beside `seed/index.js`. It inserts about 60 days of VN spending for the test user, with dates relative to now (daily phở or cà phê, Grab, tiền trọ, Netflix 260k monthly, lương), through the `Transaction` model as `source: 'web'`.
- **Effort:** S.
- **Reusable?** Idea only. Avoid their mistakes: they keep three copies of the data, and `reseed.py` crashes on a KeyError.
- **Risks:** it must never run against production. Guard it the same way `seed:test` is guarded.

### 7. Push reminders to Telegram/Zalo, from their "Ping Me Now" button
- **User value:** the app comes to the user, for example "Hôm nay bạn chưa ghi chi tiêu" or "Netflix 260k is probably due tomorrow".
- **Mapping:** `ChatLink.chatId` and the adapters' `sendText` already exist.
  - **Step a (S):** a "Remind me on Telegram" button on a pick-1 card.
  - **Step b (M):** a Vercel Cron that calls `/api/cron/digest`, protected by a `CRON_SECRET` header, plus an opt-in flag on `User` (Settings) and a short digest from picks 1 and 3.
- **Effort:** S for step a, M for step b.
- **Reusable?** Idea only. Theirs texts a hardcoded phone number from a Mac, ignores `userId`, and has open CORS with no auth.
- **Risks:**
  - Vercel Hobby crons run at most once a day and not at a precise minute. Check the current limits.
  - Zalo has a monthly message quota, and I have not checked whether Zalo allows unsolicited bot messages.
  - It must be opt-in.

### 8. AI coach paragraph (optional; needs a team decision), from `/api/coach`
- **User value:** a friendly 2 to 3 sentence monthly summary in the user's language.
- **Mapping:** a server-only endpoint behind the same `503 FEATURE_NOT_CONFIGURED` pattern KIE uses.
  - Send the model only numbers we have already computed (month summary, top categories, tips from pick 2), and ask it only to phrase them. That stops it from inventing figures.
  - Cache the result per user per day in Mongo to limit cost.
  - Any cheap hosted model works (Gemini Flash or Claude Haiku class); use whichever the team has a key for.
- **Effort:** M.
- **Reusable?** Only the prompt shape (summary, 1 or 2 actions, mascot mood, 3 sentences). Don't copy their error handling: `call_do_llm` returns the `repr(e)` error text to the client as a 200, and the DigitalOcean URL looks wrong (not verified).
- **Risks:**
  - It conflicts in spirit with our documented "deterministic, explainable" stance. That non-goal is literally about AI *parsing*, so this is allowed but should be decided on purpose.
  - It adds an external dependency on demo day, plus latency, cost and handling an API key.

## 4. Skip

- **Clerk auth:** it would replace our working, tested F1, and their back end never checks the token anyway.
- **Knot merchant linking:** US merchants only, development environment, and the route is not even served by their default stack. It gives nothing for Vietnam.
- **Capital One Nessie balance:** a US sandbox, the API key ships in the browser bundle, it uses plain HTTP (blocked as mixed content on HTTPS) and reads one fixed account.
- **iMessage channel (`photon.js`, `photon-agent.js`):** macOS only, with a hardcoded demo user and phone number, and any sender writes to one account. Our Telegram and Zalo bots are strictly better.
- **Better Deals:** a static US store map (Trader Joe's to Aldi), groceries only, and it undercounts spend. We have no Vietnamese price data to replace it with.
- **"AI" Deals:** no AI at all, just hardcoded marketing copy (Princeton, Black Friday).
- **Piggy Graph:** a 950px React Flow canvas whose LLM path never runs (`call_do_llm(llm_prompt)` against a 2-argument signature) and which falls back to Princeton strings. Pick 2 says the same things more clearly.
- **"Semantic" search:** it is only `ILIKE`. Our real search gap is accent-insensitive note search (already noted in our own code), so fix that directly with a normalized note field.
- **LLM product categorization (Dedalus):** an offline script for a test user that contradicts our rule-based decision.
- **Gemini receipt parsing as a KIE fallback:** our docs say "no AI fallback", and KIE is our showcase. Revisit only if the KIE tunnel proves unreliable before demo day. Their version also labels every image `image/jpeg` (iPhone HEIC photos may fail) and does no schema validation.
- **GPT function-calling chat agent:**
  - It is L effort. Webhooks on Vercel are stateless, so chat memory would have to live in Mongo, and every reply costs Zalo quota.
  - Their code has real defects:
    - `addToHistory` trims, but tool messages are pushed straight into the history. A long chat can therefore keep a `tool` message whose `tool_calls` message was trimmed away, and the OpenAI API rejects that request.
    - `get_category_stats` reads a different table.
    - The model id is the old `gpt-4-turbo-preview`.

  A cheaper deterministic alternative is to add `/week`, `/top` and `/next` commands to `runCommand`.
- **Multi-language, tapback reactions, terminal chat:** these exist only in the README, with no code.
- **Weekly savings target:** local state only; our budgets already cover it.
- **Cheap nearby places:** an experimental Gemini model with Princeton hardcoded.
- **Pie chart:** our ranked list is more readable and accessible. Recharts is installed, so a donut is an S task if a panel member insists.

## 5. What we already do better

- **Real users.** Auth, sessions and per-user isolation work. In PiggyBank every user is `u_demo_min` and the API is unauthenticated.
- **Capture flow.** Draft then confirm on Telegram (buttons), Zalo (`ok` / `huy` / amount correction) and the web Bot inbox, with webhook dedupe, one-time link codes and locked-account handling. Theirs saves any iMessage photo straight into one demo account, with no confirm step and the date set to now.
- **Vietnamese-first.** The parser understands `45k`, `1tr2` and `hôm qua`. The UI, errors and bot replies are vi/en, with VND formatting. Theirs is English and USD only.
- **Money model.** Wallets with computed balances, categories with keywords and a fallback, and monthly budgets with 80/100% warnings in bots and on the web. Theirs has no editable money data at all.
- **Receipt quality.** KIE returns line items, a reconciliation check and the receipt date into a reviewable draft.
- **Engineering.**
  - zod validation, a consistent error shape and Mongo operator-injection guards.
  - About 190 server and 125 client tests passing, plus Playwright and real-bot end-to-end tests.
  - A single-origin Vercel deploy.

  Theirs has no tests, CORS limited to localhost, a new connection per query, and start-up scripts that need macOS and conda.
- **Honesty of the UI.** Our screens show real data. Theirs shows staged values: a hardcoded goal, the streak, an all-green Connections tab, and connect buttons that only flip a state.
- **Polish.** Light, dark and system themes; accessible charts.

**Bottom line:** borrow their *insight and personality* ideas (picks 1 to 6, all rule-based, all S/M, about 1.5 to 2 weeks in total) and none of their infrastructure.
