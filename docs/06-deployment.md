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
Static files from `client/dist` are served first. `/api/*` goes to the Express function, which still sees the original path such as `/api/wallets`. Every other path falls back to the SPA.
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
| `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`, `ZALO_BOT_URL` | §6.5 |
| `WHATSAPP_NUMBER` | the WhatsApp bot's number, international format, digits only (e.g. `849…`); optional: without it the link card has no WhatsApp button |
| `KIE_URL` | the value of `KIE_PUBLIC_URL` (§6.6); if that is empty, a non-local `KIE_URL` is pushed as is |
| `KIE_API_KEY` | §6.6 |

Kept local and never pushed: `VERCEL_*`, `SEED_*`, `TEST_USER_*`, `PROD_URL`, `STAGING_URL`, `PORT`, `VITE_PORT`, `WT_SLOT`, the local `APP_URL`, `MONGODB_DB` (replaced by the per-target values above) and `KIE_URL`, `KIE_PUBLIC_URL` (`KIE_PUBLIC_URL` is pushed as `KIE_URL`). Empty values and `.env.example` placeholders are skipped. Seeding runs locally (§6.7).

The bot variables are the same in both projects. A bot has one webhook, and both point at production (§6.4).

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

4. For the web link card's **Copy & open Zalo** button, copy the bot's share link (Zalo Bot Creator → the bot → share, an `https://zalo.me/…` link) into `ZALO_BOT_URL` with `tools/set-secret.sh ZALO_BOT_URL`. Optional: without it the card has no Zalo button, and `/link CODE` still works when typed. The value must start with `https://`, and `WHATSAPP_NUMBER` must be digits only (no `+`, spaces or dashes): the API checks both at startup and **does not start** with a bad value, so check them before you redeploy.
5. Check it with `getWebhookInfo` (same base URL), then send the bot a text and a photo. Look at the **first real payloads** in Vercel → Logs to confirm `event_name`, `message.chat.id` and `message.photo_url` (field names come from community SDKs).

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

## 6.10 CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main` (Node 22): `npm ci`, `npm run typecheck` (client), `npm run lint` (ESLint), `npm test` (Vitest, server then client). The real-KIE contract test skips itself when `KIE_URL` doesn't answer `/health`, so it always skips in CI. JUnit results are uploaded as the `test-results` artifact.

CI does **not** run the Playwright e2e suite (`npm run test:e2e`) and does not deploy. Deploys are manual (§6.3), and the real-chat check above is run by hand after one.

## 6.11 Sources

- Vercel: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [@vercel/functions (`waitUntil`, `attachDatabasePool`)](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Functions limitations](https://vercel.com/docs/functions/limitations), [Hobby plan](https://vercel.com/docs/plans/hobby), [Fluid compute defaults changelog](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute)
- MongoDB: [Free cluster limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [Atlas ↔ Vercel integration](https://mongodb.com/docs/atlas/reference/partner-integrations/vercel), [Atlas on Vercel Marketplace](https://vercel.com/blog/mongodb-atlas-is-now-available-on-the-vercel-marketplace)
- Telegram: [Bot API](https://core.telegram.org/bots/api) (`setWebhook`, `getFile`, inline keyboards)
- Zalo: [Zalo Bot Platform docs (mirror)](https://context7.com/websites/bot_zaloplatforms/llms.txt?tokens=10000); payload fields cross-checked in [chat-adapter-zalo](https://github.com/buiducnhat/chat-adapter-zalo) (`src/types.ts`, `src/adapter.ts`) and [Zalo-Bot-Node-SDK](https://github.com/inti25/Zalo-Bot-Node-SDK)
- KIE: [Document-Intelligence-KIE](https://github.com/NguyenVanVuongDev/Document-Intelligence-KIE) (`README.md`, `src/api/main.py`, `Dockerfile`)
- Hugging Face: [Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview), [2026 community thread on free CPU Spaces](https://discuss.huggingface.co/t/official-community-complaint-revert-free-cpu-basic-spaces-and-remove-anti-developer-sdk-restrictions/177703)
