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

**Checked on the dev server (192.168.30.28):** Docker 29.1.3 ✅, `cloudflared` at `/usr/local/bin/cloudflared` ✅, Node 22.22.1 ✅, **Vercel CLI not installed** (use `npx vercel@latest`, which must be ≥ 47.0.5 for zero-config Express; or deploy through the GitHub integration).

## 6.2 MongoDB Atlas (≈ 10 min)

> **Done on 2026-11-20** (project "Project 0"):
> - Free cluster **`finance-btl`** on AWS **us-east-1** (MongoDB 8.0); its host is in `server/.env` only
> - One DB user, auto-created by Atlas, then reduced from *Atlas admin* to **readWriteAnyDatabase**
> - IP access list: `0.0.0.0/0` (Vercel) plus the setup machine's IP
> - The password is not stored by Claude. Paste it into `server/.env` and Vercel yourself. If it's lost, use Database Access → Edit → Edit Password → Autogenerate.

1. Sign in at **cloud.mongodb.com** → create a project, e.g. `finance-btl`.
2. **Create cluster → Free**. Pick a region near the Vercel function region: Vercel Functions default to Washington D.C. (`iad1`), so choose **AWS us-east-1**. If you move the function region (Project → Settings → Functions), match it, e.g. Singapore `sin1` ↔ AWS `ap-southeast-1`.
3. **Database Access → Add user**: user `finance_app`, auto-generated strong password, role **readWrite on database `finance`** only (not `atlasAdmin`).
4. **Network Access → Add IP → `0.0.0.0/0`**. Vercel functions have dynamic IPs, so this is required on the free plan; a strong DB password is the protection.
5. **Connect → Drivers** → copy the URI and add the DB name:
   `mongodb+srv://finance_app:<password>@<cluster>.mongodb.net/finance?retryWrites=true&w=majority&appName=finance-btl`
6. Alternative: **Vercel Marketplace → MongoDB Atlas** integration. It creates the cluster or links an existing one and injects the URI as an env var into the Vercel project, adding `0.0.0.0/0` for you.

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
  "functions": { "api/index.js": { "maxDuration": 300 } },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
Static files from `client/dist` are served first. `/api/*` goes to the Express function, which still sees the original path such as `/api/wallets`. Every other path falls back to the SPA.
⚠️ Verify both rewrites in build step 1 (`GET /api/health` and a deep link like `/budgets` on refresh) before building features.

**Project settings** (vercel.com → Add New → Project → import the GitHub repo):

| Setting | Value |
|---|---|
| Framework preset | Other |
| Root directory | repo root |
| Install command | `npm install` (npm workspaces) |
| Build command | `npm run build -w client` |
| Output directory | `client/dist` |
| Node.js version | 22.x |

**Environment variables** (Settings → Environment Variables → Production + Preview). Changing them needs a **redeploy**.

| Variable | Where it comes from |
|---|---|
| `MONGODB_URI` | Atlas §6.2 (or set by the Marketplace integration) |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | `15m`, `7` |
| `APP_URL` | `https://<project>.vercel.app` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | §6.4 |
| `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET` | §6.5 |
| `KIE_URL`, `KIE_API_KEY` | §6.6 |

`SEED_ADMIN_*` is **not** set on Vercel; seeding runs locally (§6.7).

## 6.4 Telegram bot

> **Done on 2026-11-20:** bot **"Sổ Chi Tiêu BTL"**, username **@sochitieu_btl_bot** (https://t.me/sochitieu_btl_bot). Command menu set via `/setcommands`: start, link, today, month, lang, help. The token is in your BotFather chat; copy it into `server/.env` and Vercel yourself.

1. In Telegram, open **@BotFather** → `/newbot` → name + username → copy the **token**.
2. Generate a secret: `openssl rand -hex 24`.
3. Register the webhook (after the first Vercel deploy):

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://<project>.vercel.app/api/webhooks/telegram" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","callback_query"]'
```

4. Check it: `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"` should show the URL and no `last_error_message`.

## 6.5 Zalo bot

1. Create the bot **in the Zalo phone app** (official guide: bot.zaloplatforms.com/docs/create-bot). It can't be done from Zalo Web, because Zalo Web search doesn't find OA accounts and the creator is a mini app:
   1. Open Zalo → search the OA **"Zalo Bot Manager"** → open the chat.
   2. Tap **"Tạo bot"** in the chat menu to open **Zalo Bot Creator**.
   3. Name it with the required **"Bot" prefix**, e.g. **"Bot Sổ Chi Tiêu"**, fill in the rest, and tap **Tạo Bot**.
   4. Zalo sends the bot info and the **Bot Token** to your Zalo account as a message. Paste it into `server/.env` (`ZALO_BOT_TOKEN`) and Vercel.
2. Generate a secret (8–256 chars): `openssl rand -hex 24`.
3. Register the webhook (polling via `getUpdates` stops working once a webhook is set):

```bash
curl -s "https://bot-api.zaloplatforms.com/bot$ZALO_BOT_TOKEN/setWebhook" -H 'Content-Type: application/json' -d "{\"url\":\"https://<project>.vercel.app/api/webhooks/zalo\",\"secret_token\":\"$ZALO_WEBHOOK_SECRET\"}"
```

4. Check it with `getWebhookInfo` (same base URL), then send the bot a text and a photo. Look at the **first real payloads** in Vercel → Logs to confirm `event_name`, `message.chat.id` and `message.photo_url` (field names come from community SDKs).

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

From your machine, with the **production** URI in `server/.env`:

```bash
npm run seed -w server
```

This creates the default category templates and the first admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Don't commit those values.

## 6.8 Local development

- `server/.env` (git-ignored) holds the same variables, pointing to the same Atlas cluster with a separate database name, e.g. `finance_dev`.
- `npm run dev` starts the API on `:4100` and Vite on `:5300` with an `/api` proxy, so everything is same-origin like production. (3000/5173 are taken on the dev server; in a treehouse worktree, `eval "$(tools/wt-env.sh)"` gives slot *n* ports `4100+10n` / `5300+10n`.)
- Bots locally: create separate **dev bots** (one Telegram, one Zalo), run `cloudflared tunnel --url http://localhost:4100`, and point the dev bots' webhooks at that URL. The production bots stay attached to Vercel.

## 6.9 Demo-day checklist

- [ ] `https://<project>.vercel.app/api/health` → `{status:'ok', db:'up'}`
- [ ] Register → default wallet and categories appear; log in as the seeded admin → Admin menu visible
- [ ] Telegram: `getWebhookInfo` clean; link via deep link; `phở 45k` → ✅ → shows on the dashboard
- [ ] Zalo: `/link CODE`; `grab 32k` → `ok` → saved
- [ ] KIE: tunnel running, `KIE_URL` current, a receipt photo becomes a draft in about 20–40 s
- [ ] Light/dark and vi/en switch on login and in the app bar
- [ ] `.env` not in git (`git ls-files | grep -i env` shows only `.env.example`)

## 6.10 Sources

- Vercel: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [@vercel/functions (`waitUntil`, `attachDatabasePool`)](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Functions limitations](https://vercel.com/docs/functions/limitations), [Hobby plan](https://vercel.com/docs/plans/hobby), [Fluid compute defaults changelog](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute)
- MongoDB: [Free cluster limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [Atlas ↔ Vercel integration](https://mongodb.com/docs/atlas/reference/partner-integrations/vercel), [Atlas on Vercel Marketplace](https://vercel.com/blog/mongodb-atlas-is-now-available-on-the-vercel-marketplace)
- Telegram: [Bot API](https://core.telegram.org/bots/api) (`setWebhook`, `getFile`, inline keyboards)
- Zalo: [Zalo Bot Platform docs (mirror)](https://context7.com/websites/bot_zaloplatforms/llms.txt?tokens=10000); payload fields cross-checked in [chat-adapter-zalo](https://github.com/buiducnhat/chat-adapter-zalo) (`src/types.ts`, `src/adapter.ts`) and [Zalo-Bot-Node-SDK](https://github.com/inti25/Zalo-Bot-Node-SDK)
- KIE: [Document-Intelligence-KIE](https://github.com/NguyenVanVuongDev/Document-Intelligence-KIE) (`README.md`, `src/api/main.py`, `Dockerfile`)
- Hugging Face: [Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview), [2026 community thread on free CPU Spaces](https://discuss.huggingface.co/t/official-community-complaint-revert-free-cpu-basic-spaces-and-remove-anti-developer-sdk-restrictions/177703)
