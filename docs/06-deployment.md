# 6. Deployment (Vercel + MongoDB Atlas free)

Target: **0 VND/month**. Web and API on Vercel Hobby, data on an Atlas free cluster, the KIE service in Docker on our own machine behind a Cloudflare Tunnel.

## 6.1 Free tier facts (checked 2026-11-20)

| Service | What we get for free | Limits that matter here |
|---|---|---|
| **Vercel Hobby** | Static hosting + Vercel Functions (Fluid compute) | Function max duration **300 s** (default 300 s); request/response body **4.5 MB**; function bundle 250 MB; an Express app becomes **one** function; `express.static` is ignored (static files are served from build output); Hobby is for **non-commercial** use (a class project qualifies) |
| **MongoDB Atlas Free cluster** (formerly M0) | Shared cluster | **512 MB** storage; one free cluster per project; capped data transfer per rolling 7 days; no backups; can upgrade later |
| **Cloudflare quick tunnel** (`cloudflared tunnel --url …`) | Public HTTPS URL to a local port, no account | Random `*.trycloudflare.com` URL that **changes on every restart**; meant for testing and demos. A named tunnel (free Cloudflare account + own domain) gives a stable URL |
| **Telegram Bot API** | Free | Webhook needs HTTPS; bot file downloads ≤ 20 MB |
| **Zalo Bot Platform** (Basic plan) | Free | Up to **3 bots**, each bot talks to at most **50 users**, **3,000 messages/month**; webhook needs HTTPS; messages ≤ 2000 chars; no buttons |
| **WhatsApp Cloud API** (Meta), *planned, §2.10* | Messages from users; the bot's replies up to **1,000 a month** per business number (figures from §2.10.1) | Replies past that are billed per message, so a payment method is needed by then; the bot may reply only within **24 h** of the user's last message; up to 3 reply buttons; long replies split at 4096 chars (§2.10.4); webhook needs HTTPS |

**Why not host KIE on Hugging Face Spaces?** Its docs still list a free CPU Basic tier (2 vCPU, 16 GB, sleeps after 48 h idle), but 2026 forum threads report free Docker Spaces being restricted. It is not reliable enough for demo day. Our own machine plus a tunnel is fully under our control.

**Checked on the dev server (192.168.30.28):** Docker 29.1.3 ✅, `cloudflared` at `/usr/local/bin/cloudflared` ✅, Node 22.22.1 ✅, **Vercel CLI not installed**: the scripts run it through `npx`, pinned to **`vercel@66.6.0`** (zero-config Express needs ≥ 47.0.5). The version is set in one place, `VERCEL_CLI` at the top of `tools/deploy.sh`, which `tools/vercel-env-push.sh` also reads, so a new CLI release cannot change a deploy until that line is changed.

## 6.2 MongoDB Atlas (≈ 10 min)

> **Done on 2026-11-20** (project "Project 0"):
> - Free cluster **`finance-btl`** on AWS **us-east-1** (MongoDB 8.0); its host is in `server/.env` only
> - One DB user, auto-created by Atlas, then reduced from *Atlas admin* to **readWriteAnyDatabase**
> - IP access list: `0.0.0.0/0` (Vercel) plus the setup machine's IP
> - The password is not stored by Claude. Paste it with `tools/set-secret.sh MONGODB_PASSWORD` (§6.3), which puts it into `MONGODB_URI` in `server/.env` and pushes that to both Vercel projects. If it's lost, use Database Access → Edit → Edit Password → Autogenerate.

1. Sign in at **cloud.mongodb.com** → create a project, e.g. `finance-btl`.
2. **Create cluster → Free**. Pick a region near the Vercel function region: Vercel Functions default to Washington D.C. (`iad1`), so choose **AWS us-east-1**. If you move the function region (Project → Settings → Functions), match it, e.g. Singapore `sin1` ↔ AWS `ap-southeast-1`.
3. **Database Access → Add user**: user `finance_app`, auto-generated strong password, role **readWriteAnyDatabase** (not `atlasAdmin`). One cluster holds several databases: `finance` (production), `finance_staging` (staging) and `finance_wt<n>` (local worktrees, §6.8), so `readWrite` on `finance` alone is not enough.
4. **Network Access → Add IP → `0.0.0.0/0`**. Vercel functions have dynamic IPs, so this is required on the free plan; a strong DB password is the protection.
5. **Connect → Drivers** → copy the URI and add the DB name:
   `mongodb+srv://finance_app:<password>@<cluster>.mongodb.net/finance?retryWrites=true&w=majority&appName=finance-btl`
   When `MONGODB_DB` is set, it overrides the database name in the URI. That is how one URI serves every environment.
6. Not used here: the **Vercel Marketplace → MongoDB Atlas** integration (creates or links a cluster and injects the URI into one Vercel project). Our scripts set `MONGODB_URI` and the per-target `MONGODB_DB` in both projects themselves (§6.3).

## 6.3 Vercel (≈ 10 min)

**Repo files Vercel needs:**

`api/index.js`
```js
import app from '../server/src/app.js';
export default app;
```

`vercel.json`
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "installCommand": "npm ci",
  "buildCommand": "npm run build -w client",
  "outputDirectory": "client/dist",
  "functions": { "api/index.js": { "maxDuration": 300 } },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
Static files from `client/dist` are served first. `/api/*` goes to the Express function, which still sees the original path such as `/api/wallets`. Every other path falls back to the SPA. The planned `/link` screen (§2.10.3) is one of those paths, so `vercel.json` does not change for it.
⚠️ Verify both rewrites in build step 1 (`GET /api/health` and a deep link like `/budgets` on refresh) before building features.

**Projects:** two Vercel projects, **`sochitieu-btl`** (production, DB `finance`) and **`sochitieu-btl-staging`** (staging, DB `finance_staging`). Neither is Git-connected: deploys go through the CLI (below). Build settings live in `vercel.json` (no framework preset, `npm ci`, `npm run build -w client`, output `client/dist`); Node 22.x comes from `engines` in `package.json`. The scripts find the projects through `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_PROD` and `VERCEL_PROJECT_ID_STAGING` in `server/.env`, so no `vercel link` is needed.

**Environment variables** are copied from `server/.env` by `tools/vercel-env-push.sh staging|production [KEY...]` (all keys, or only the ones named). It sets the project's **Production** environment only, since every deploy is a production deploy. Values go through stdin and are never printed. `tools/set-secret.sh KEY...` asks for each value hidden, saves it in `server/.env`, then pushes the changed keys to **both** projects. Changing them needs a **redeploy**.

| Variable | Where it comes from |
|---|---|
| `MONGODB_URI` | Atlas §6.2 (`tools/set-secret.sh MONGODB_PASSWORD` puts the password into it) |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | `15m`, `7` |
| `APP_URL` | per target: `PROD_URL` or `STAGING_URL` from `server/.env` |
| `MONGODB_DB` | per target: `finance` or `finance_staging` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | §6.4 |
| `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET` | §6.5 |
| `ZALO_BOT_URL` *(planned, §2.10)* | §6.5 step 5 |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMBER` *(planned, §2.10)* | §6.12 |
| `KIE_URL` | the value of `KIE_PUBLIC_URL` (§6.6); if that is empty, a non-local `KIE_URL` is pushed as is |
| `KIE_API_KEY` | §6.6 |

Kept local and never pushed: `VERCEL_*`, `SEED_*`, `TEST_USER_*`, `PROD_URL`, `STAGING_URL`, `PORT`, `VITE_PORT`, `WT_SLOT`, the local `APP_URL`, `MONGODB_DB` (replaced by the per-target values above) and `KIE_URL`, `KIE_PUBLIC_URL` (`KIE_PUBLIC_URL` is pushed as `KIE_URL`). Empty values and `.env.example` placeholders are skipped. Seeding runs locally (§6.7).

The bot variables are the same in both projects. A bot has one webhook, and both point at production (§6.4). The planned WhatsApp bot works the same way: its callback URL is set once per Meta app (§6.12).

**Deploy** (staging first):

1. `tools/deploy.sh staging` deploys the current checkout with `--prod` to the project's main domain and prints the URL. It runs the pinned Vercel CLI through `npx` and needs a logged-in CLI.
2. Check staging: `GET /api/health` → `{status:'ok', db:'up'}`, plus a deep link on refresh.
3. `tools/deploy.sh production`, then check it the same way.

## 6.4 Telegram bot

> **Done on 2026-11-20:** bot **"Sổ Chi Tiêu BTL"**, username **@sochitieu_btl_bot** (https://t.me/sochitieu_btl_bot). Command menu set via `/setcommands`: start, link, today, month, lang, help. The token is in your BotFather chat; save it with `tools/set-secret.sh TELEGRAM_BOT_TOKEN` (§6.3).

1. In Telegram, open **@BotFather** → `/newbot` → name + username → copy the **token**.
2. Generate a secret: `openssl rand -hex 24`.
3. Register the webhook (after the first Vercel deploy) with the **production** URL, `https://sochitieu-btl.vercel.app`. A bot has one webhook, so registering the staging URL takes it away from production. One command registers **both** bots (Telegram and Zalo) and prints only each platform's answer; a bot whose token or secret is missing is skipped:

```bash
node --env-file=server/.env server/src/scripts/setWebhooks.js https://<project>.vercel.app
```

   By hand, for Telegram only:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://<project>.vercel.app/api/webhooks/telegram" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","callback_query"]'
```

4. Check it: `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"` should show the URL and no `last_error_message`.

## 6.5 Zalo bot

1. Create the bot **in the Zalo phone app** (official guide: bot.zaloplatforms.com/docs/create-bot). It can't be done from Zalo Web, because Zalo Web search doesn't find OA accounts and the creator is a mini app:
   1. Open Zalo → search the OA **"Zalo Bot Manager"** → open the chat.
   2. Tap **"Tạo bot"** in the chat menu to open **Zalo Bot Creator**.
   3. Name it with the required **"Bot" prefix**, e.g. **"Bot Sổ Chi Tiêu"**, fill in the rest, and tap **Tạo Bot**.
   4. Zalo sends the bot info and the **Bot Token** to your Zalo account as a message. Save it with `tools/set-secret.sh ZALO_BOT_TOKEN` (§6.3), which writes `server/.env` and pushes it to both Vercel projects.
2. Generate a secret (8–256 chars): `openssl rand -hex 24`.
3. Register the webhook (polling via `getUpdates` stops working once a webhook is set). `setWebhooks.js` (§6.4) does it together with Telegram; by hand:

```bash
curl -s "https://bot-api.zaloplatforms.com/bot$ZALO_BOT_TOKEN/setWebhook" -H 'Content-Type: application/json' -d "{\"url\":\"https://<project>.vercel.app/api/webhooks/zalo\",\"secret_token\":\"$ZALO_WEBHOOK_SECRET\"}"
```

4. Check it with `getWebhookInfo` (same base URL), then send the bot a text and a photo. Look at the **first real payloads** in Vercel → Logs to confirm `event_name`, `message.chat.id` and `message.photo_url` (field names come from community SDKs).
5. *(Planned, §2.10.)* `ZALO_BOT_URL` for the link card's **Copy & open Zalo** button (§2.10.2): in **Zalo Bot Creator**, pick the bot to open its details page and copy the bot's share link (this menu path is not verified yet: the only source found documents the bot's group-invite link, so check it on a phone and correct this step). Save it with `tools/set-secret.sh ZALO_BOT_URL` (or together with the WhatsApp values, §6.12), then check on a phone that the link opens the bot's chat. Without it, Zalo is left out of the link card.

## 6.6 KIE service (Docker + Cloudflare Tunnel)

On the dev server (or any machine with Docker and about 4 GB of free RAM):

1. `git clone https://github.com/NguyenVanVuongDev/Document-Intelligence-KIE` (author's permission granted).
2. Add the API-key check: a FastAPI dependency on `/analyze` comparing header `X-KIE-Key` with env `KIE_API_KEY`, returning 401 otherwise.
3. Build and run: `docker compose up -d --build`. The first build downloads PaddleOCR models into the image, which takes several minutes. Map port 8000 to a free host port if 8000 is taken.
4. Check locally: `curl -s localhost:<port>/health` → `{"status":"ok"}`.
5. Expose it: `cloudflared tunnel --url http://localhost:<port>` prints `https://<random>.trycloudflare.com`.
6. Save that URL with `tools/set-secret.sh KIE_PUBLIC_URL` (and `KIE_API_KEY` the same way), then **redeploy**. `server/.env` keeps `KIE_URL` as the local address the dev server calls; Vercel's `KIE_URL` is pushed from `KIE_PUBLIC_URL`.
7. A quick-tunnel URL changes every time `cloudflared` restarts, which means running `tools/set-secret.sh KIE_PUBLIC_URL` again and redeploying. For a stable URL, create a free Cloudflare account and a **named tunnel** on your own domain.

KIE handles **one image at a time** (~20 s each in its own benchmark). That's fine for a demo; tell the audience to send one photo at a time.

## 6.7 Seed the database

From your machine, with the Atlas URI in `server/.env`. `MONGODB_DB` picks the database, and a value in the shell wins over `server/.env` (check it if you ran `tools/wt-env.sh` in this shell):

```bash
MONGODB_DB=finance npm run seed -w server                   # production
MONGODB_DB=finance_staging npm run seed:test -w server      # staging
```

`seed` creates the default category templates and the first admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. `seed:test` also creates **userA** and **userB** from `TEST_USER_A_EMAIL` / `TEST_USER_A_PASSWORD` and `TEST_USER_B_*`. A pair that isn't set is skipped, and existing accounts are left alone, so both are safe to run again. Don't commit those values.

## 6.8 Local development

- `server/.env` (git-ignored) holds the same variables, pointing to the same Atlas cluster with a separate database. `eval "$(tools/wt-env.sh)"` sets `MONGODB_DB=finance_wt<slot>` (the main checkout is slot 0, so `finance_wt0`); a value in the shell wins over `server/.env`.
- `npm run dev` starts the API on `:4100` and Vite on `:5300` with an `/api` proxy, so everything is same-origin like production. (3000/5173 are taken on the dev server; in a treehouse worktree, `eval "$(tools/wt-env.sh)"` gives slot *n* ports `4100+10n` / `5300+10n`.)
- Bots locally: create separate **dev bots** (one Telegram, one Zalo), run `cloudflared tunnel --url http://localhost:4100`, and point the dev bots' webhooks at that URL. The production bots stay attached to Vercel.

## 6.9 Demo-day checklist

- [ ] `https://<project>.vercel.app/api/health` → `{status:'ok', db:'up'}`
- [ ] Register → default wallet and categories appear; log in as the seeded admin → Admin menu visible
- [ ] Telegram: `getWebhookInfo` clean; link via deep link; `phở 45k` → ✅ → shows on the dashboard
- [ ] Zalo: `/link CODE`; `grab 32k` → `ok` → saved
- [ ] KIE: tunnel running, `KIE_PUBLIC_URL` current (pushed with `tools/set-secret.sh KIE_PUBLIC_URL`, then redeployed), a receipt photo becomes a draft in about 20–40 s
- [ ] Light/dark and vi/en switch on login and in the app bar
- [ ] `.env` not in git (`git ls-files | grep -E '(^|/)\.env'` shows only `.env.example`)
- [ ] Real chats after a deploy: `node tools/bot-e2e/bot-e2e.mjs` steps pass (`--target prod` by default; see [docs/testing/bot-e2e.md](testing/bot-e2e.md))
- [ ] *(Planned, §2.10)* WhatsApp: Meta's **Configuration** panel shows the callback URL saved and `messages` subscribed; **Open WhatsApp** on the link card → Send → "Linked ✓" within 5 s; `phở 45k` → ✅ → saved
- [ ] *(Planned, §2.10)* Zalo: **Copy & open Zalo** opens the bot with `/link CODE` on the clipboard; paste + send → "Linked ✓"
- [ ] *(Planned, §2.10)* An unlinked chat gets a claim link on the production `APP_URL` (`…/link?t=…`); Confirm links it and the chat gets the success message
- [ ] *(Planned, §2.10)* The link card shows only the apps whose settings were pushed
- [ ] *(Planned, §2.10)* The `/link` confirm screen shows the warning ("Only confirm if you just messaged the bot yourself…"); after Confirm the Bot inbox shows "New chat linked from a chat link: … Not you? [Unlink]", and dismissing it keeps it gone after a reload
- [ ] *(Planned, §2.10)* WhatsApp: the linked chat shows the profile name, and the test phone's number appears nowhere in the app (Bot inbox, Transactions, Admin) or in the API responses in DevTools

## 6.10 CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main` (Node 22): `npm ci`, `npm run typecheck` (client), `npm run lint` (ESLint), `npm test` (Vitest, server then client). The real-KIE contract test skips itself when `KIE_URL` doesn't answer `/health`, so it always skips in CI. JUnit results are uploaded as the `test-results` artifact.

CI does **not** run the Playwright e2e suite (`npm run test:e2e`) and does not deploy. Deploys are manual (§6.3), and the real-chat check above is run by hand after one.

## 6.11 Sources

- Vercel: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [@vercel/functions (`waitUntil`, `attachDatabasePool`)](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Functions limitations](https://vercel.com/docs/functions/limitations), [Hobby plan](https://vercel.com/docs/plans/hobby), [Fluid compute defaults changelog](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute)
- MongoDB: [Free cluster limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [Atlas ↔ Vercel integration](https://mongodb.com/docs/atlas/reference/partner-integrations/vercel), [Atlas on Vercel Marketplace](https://vercel.com/blog/mongodb-atlas-is-now-available-on-the-vercel-marketplace)
- Telegram: [Bot API](https://core.telegram.org/bots/api) (`setWebhook`, `getFile`, inline keyboards)
- Zalo: [Zalo Bot Platform docs (mirror)](https://context7.com/websites/bot_zaloplatforms/llms.txt?tokens=10000); payload fields cross-checked in [chat-adapter-zalo](https://github.com/buiducnhat/chat-adapter-zalo) (`src/types.ts`, `src/adapter.ts`) and [Zalo-Bot-Node-SDK](https://github.com/inti25/Zalo-Bot-Node-SDK)
- WhatsApp Cloud API (Meta, checked 2026-11-25, for §6.12): [Get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) (use case, API Setup, system-user token), [Access tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens), [Register a business phone number](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration), [Display names](https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names), [Create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint) (verify token, Configuration panel), [Webhooks overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview) (permissions, fields), [Managing webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-webhooks) (`subscribed_apps`)
- Zalo bot link: [Using a Zalo Bot in group chats](https://bot.zapps.me/en/docs/build-bot-interaction-with-group) (the bot's details page in Zalo Bot Creator; it documents the group-invite link, not a 1:1 share link)
- KIE: [Document-Intelligence-KIE](https://github.com/NguyenVanVuongDev/Document-Intelligence-KIE) (`README.md`, `src/api/main.py`, `Dockerfile`)
- Hugging Face: [Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview), [2026 community thread on free CPU Spaces](https://discuss.huggingface.co/t/official-community-complaint-revert-free-cpu-basic-spaces-and-remove-anti-developer-sdk-restrictions/177703)

## 6.12 WhatsApp Cloud API (Meta) setup (planned, §2.10)

> **Planned (§2.10), not built yet.** Today there is no WhatsApp code: `server/src/routes/webhooks.js` has only `/telegram` and `/zalo`, `server/src/config/env.js` has no `WHATSAPP_*` variable, and `setWebhooks.js` knows only Telegram and Zalo. Do these steps when the WhatsApp adapter (§2.10.4) is merged. The bot talks to Meta's WhatsApp Cloud API directly, with no provider in between.

**On Meta's side** (once; §2.10.1 lists what the owner needs):

1. At **developers.facebook.com** → **My Apps → Create app**, choose the **WhatsApp** use case ("Connect with customers through WhatsApp") and attach a **Meta business portfolio** (create one if you have none).
2. In the app: **Use cases → Customize → API Setup** (older apps: **WhatsApp → API Setup**). Connect or create the **WhatsApp Business account**, then add the bot's phone number (**From** → add a new number):
   - a number that is **not already on WhatsApp** and can receive an SMS or a voice call for the code;
   - the **display name** the chat shows. Meta reviews it; the status is in **WhatsApp Manager → Account tools → Phone numbers**.
3. **Permanent token** in **Business settings → Users → System users**: **Add** an **Admin** system user → **Assign assets**: the app (**Manage app**, full control) and the WhatsApp account (full control) → **Generate token**: pick the app, expiry **Never**, permissions `business_management`, `whatsapp_business_messaging`, `whatsapp_business_management`. Meta shows it once, so paste it straight into `tools/set-secret.sh` (below). Don't use the temporary token from API Setup: it expires within a day.
4. **Payment method:** the bot's replies are free only up to the monthly allowance (§2.10.1). Add a payment method to the WhatsApp Business account (Meta Business Suite → WhatsApp Manager) before the bot gets past it.

**Where each value comes from:**

| Variable | Where it comes from |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | the system-user token (step 3) |
| `WHATSAPP_PHONE_NUMBER_ID` | **API Setup**, under the selected **From** number: **Phone number ID** (not the WhatsApp Business account ID shown next to it) |
| `WHATSAPP_APP_SECRET` | **App settings → Basic → App secret → Show**. It signs every webhook `POST` (`X-Hub-Signature-256`, §2.10.4) |
| `WHATSAPP_VERIFY_TOKEN` | you choose it: `openssl rand -hex 24`. It goes into Meta's **Verify token** field below and is only used for Meta's `GET` setup check |
| `WHATSAPP_NUMBER` | the business number in international format, **digits only** (country code first, no `+`, spaces or leading 0), for `wa.me` links |
| `ZALO_BOT_URL` | §6.5 step 5 |

**Save and push** all six at once:

```bash
tools/set-secret.sh WHATSAPP_ACCESS_TOKEN WHATSAPP_PHONE_NUMBER_ID WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_NUMBER ZALO_BOT_URL
```

It saves them in `server/.env` and pushes them to **both** Vercel projects. The scripts don't change for this: none of the six is on the local-only list in `tools/vercel-env-push.sh`, so they are pushed as typed, like the Telegram and Zalo keys. If a push fails, repeat it with `tools/vercel-env-push.sh production WHATSAPP_ACCESS_TOKEN …` (and `staging`). Then **redeploy** (`tools/deploy.sh production`): Meta's setup check below needs `WHATSAPP_VERIFY_TOKEN` live. The PR that builds the adapter also adds the six names, without values, to `.env.example`.

**Register the number and the webhook** (after that deploy; production URL, as in §6.4):

1. Register the number for the Cloud API, once, with a 6-digit two-step verification PIN you choose (keep it: Meta asks for it to change or remove the number). `<version>` is the Graph API version pinned in the adapter (§2.10.4, chosen at build time):

```bash
curl -s "https://graph.facebook.com/<version>/$WHATSAPP_PHONE_NUMBER_ID/register" -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"messaging_product":"whatsapp","pin":"<6 digits>"}'
```

   Check it: `GET https://graph.facebook.com/<version>/$WHATSAPP_PHONE_NUMBER_ID?fields=status,name_status` (same header) shows `status: CONNECTED`, and `name_status` tells whether the display name is approved. If the display name is changed later, register again once Meta approves the new name.
2. **Use cases → Customize → Configuration** (older apps: **WhatsApp → Configuration**): **Callback URL** `https://sochitieu-btl.vercel.app/api/webhooks/whatsapp`, **Verify token** = the `WHATSAPP_VERIFY_TOKEN` value → **Verify and save**. Meta sends the `GET` setup check (§2.10.4) and saves only if the route answers 200 with `hub.challenge`.
3. Under **Webhook fields**, **Subscribe** to `messages` only. It carries incoming messages and the sent/delivered/read statuses, which the route ignores.
4. Check it: send `phở 45k` to the business number from a phone; the draft comes back with ✅ / ❌ / ✏️ buttons and the `POST` shows in Vercel → Logs. If Meta's dashboard test reaches the route but real messages never do, the app may not be subscribed to the WhatsApp Business account: `GET https://graph.facebook.com/<version>/<WABA_ID>/subscribed_apps` should list it, and a `POST` to the same URL with the access token subscribes it.

A Meta app has one callback URL, so, like the Telegram and Zalo bots, the WhatsApp bot points at production only.

`setWebhooks.js` (§6.4) gains a `whatsapp` entry that is **skipped** when its settings are missing (§2.10.5). What it does when they are set is **left to the builder**: Meta keeps the callback URL on the app, and a script can set it only through the Graph API's app subscriptions with an app token, which needs the app ID. The app ID is not one of the six variables. Until the builder decides, steps 2–3 above are the way.

**When settings are missing** (§2.10.2, §2.10.5):

- The webhook-registration script skips that platform and prints `skipped: …`, as it does for Telegram and Zalo today.
- The link card leaves the app out of the picker: `POST /api/chat-links/code` returns `null` for its entry in `links`. WhatsApp's link is built from `WHATSAPP_NUMBER` and Zalo's is `ZALO_BOT_URL`, so without them the button is hidden; which of the other `WHATSAPP_*` variables also count as "missing" is left to the builder. Today the Telegram button already behaves this way when `TELEGRAM_BOT_USERNAME` is unset (`telegramDeepLink: null`).
- §2.10 doesn't name the case of an unset `WHATSAPP_APP_SECRET` or `WHATSAPP_VERIFY_TOKEN`. Following §2.10.4's rule that a failed check answers 401 (`POST`) or 403 (`GET`), and the way `sameSecret` treats an unset secret for Telegram and Zalo today, a missing one fails the check like a wrong one; the builder confirms this ([04-backend.md §4.2](04-backend.md#42-configuration)).
