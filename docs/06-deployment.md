# 6. Deployment (Vercel + MongoDB Atlas free)

Target: **0 VND/month**. Web and API on Vercel Hobby, data on an Atlas free cluster, the KIE service in Docker on our own machine behind a Cloudflare Tunnel. The planned agent service and its local model (§2.11) also run on our own hardware, the team's GPU host, behind a tunnel of their own, so they add no bill either (§6.13).

## 6.1 Free tier facts (checked 2026-11-20)

| Service | What we get for free | Limits that matter here |
|---|---|---|
| **Vercel Hobby** | Static hosting + Vercel Functions (Fluid compute) | Function max duration **300 s** (default 300 s); request/response body **4.5 MB**; function bundle 250 MB; an Express app becomes **one** function; `express.static` is ignored (static files are served from build output); Hobby is for **non-commercial** use (a class project qualifies) |
| **MongoDB Atlas Free cluster** (formerly M0) | Shared cluster | **512 MB** storage; one free cluster per project; capped data transfer per rolling 7 days; no backups; can upgrade later |
| **Cloudflare quick tunnel** (`cloudflared tunnel --url …`) | Public HTTPS URL to a local port, no account | Random `*.trycloudflare.com` URL that **changes on every restart**; meant for testing and demos. A named tunnel (free Cloudflare account + own domain) gives a stable URL. Used for KIE today and, planned, for the agent service (§6.13) |
| **Telegram Bot API** | Free | Webhook needs HTTPS; bot file downloads ≤ 20 MB |
| **Zalo Bot Platform** (Basic plan) | Free | Up to **3 bots**, each bot talks to at most **50 users**, **3,000 messages/month**; webhook needs HTTPS; messages ≤ 2000 chars; no buttons |
| **WhatsApp Cloud API** (Meta), §2.10 | Messages from users; the bot's replies up to **1,000 a month** per business number (figures from §2.10.1) | Replies past that are billed per message, so a payment method is needed by then; the bot may reply only within **24 h** of the user's last message; up to 3 reply buttons; long replies split at 4096 chars (§2.10.4); webhook needs HTTPS |
| **Vercel Cron Jobs** (Hobby), *planned, §2.11* | Scheduled `GET` calls to our own function | Once a day at most, fired at any time within the scheduled hour, on **production deployments only**, no retry (§2.11.2) |
| **GPU host** (our own machine), *planned, §2.11* | vLLM serving Qwen3.5-2B (Apache-2.0) and the agent service with bge-m3; weights downloaded once from Hugging Face | One RTX 5880 Ada (48 GB) shared with other services that already use about 30 GB: vLLM gets `--gpu-memory-utilization 0.25` (≈ 12 GB: 4.5 GB of weights + KV cache), bge-m3 ≈ 2.3 GB. At most **8** requests in the model at once and **16** queued; beyond that `AGENT_BUSY` (§6.13) |
| **Gmail SMTP**, *planned, §2.12* | A Google account with an app password | About **500 mails a day**; too many bounces or mails to fake addresses make Google stop the account sending for up to 24 h (§2.12.1). Vercel blocks only port 25, so port 465 works |

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
Static files from `client/dist` are served first. `/api/*` goes to the Express function, which still sees the original path such as `/api/wallets`. Every other path falls back to the SPA. The planned `/link` screen (§2.10.3) is one of those paths, so `vercel.json` does not change for it. The same holds for the planned `/verify-email` and `/forgot-password` screens (§2.12).

*(Planned, §2.11.2.)* The daily cron adds one key to `vercel.json`, next to `rewrites`:

```json
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 13 * * *" }
  ]
```
`0 13 * * *` is 13:00 UTC, so 20:00–20:59 Vietnam time. See §6.13.
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
| `WHATSAPP_NUMBER` | the WhatsApp bot's number, international format, digits only, no leading 0 (e.g. `849…`); optional: without it the link card has no WhatsApp button (§6.12) |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | §6.12; all four are needed, or the WhatsApp webhook answers 503 and the link card hides WhatsApp |
| `AGENT_URL`, `AGENT_SECRET`, `RECEIPT_READER`, `ASSISTANT_ENABLED`, `ASSISTANT_CHANNELS`, `CRON_SECRET` *(planned, §2.11)* | §6.13 (`AGENT_URL` is pushed from `AGENT_PUBLIC_URL`, like `KIE_URL`) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` *(planned, §2.12)* | §6.14 |
| `KIE_URL` | the value of `KIE_PUBLIC_URL` (§6.6); if that is empty, a non-local `KIE_URL` is pushed as is |
| `KIE_API_KEY` | §6.6 |

Kept local and never pushed: `VERCEL_*`, `SEED_*`, `TEST_USER_*`, `PROD_URL`, `STAGING_URL`, `PORT`, `VITE_PORT`, `WT_SLOT`, the local `APP_URL`, `MONGODB_DB` (replaced by the per-target values above) and `KIE_URL`, `KIE_PUBLIC_URL` (`KIE_PUBLIC_URL` is pushed as `KIE_URL`). Planned (§2.11): `AGENT_URL` and `AGENT_PUBLIC_URL` the same way (`AGENT_PUBLIC_URL` is pushed as `AGENT_URL`). Empty values and `.env.example` placeholders are skipped. Seeding runs locally (§6.7).

The bot variables are the same in both projects. A bot has one webhook, and both point at production (§6.4). The WhatsApp bot works the same way: its callback URL is set once per Meta app (§6.12).

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

   By hand, for Telegram only. `set-secret.sh` writes the values only to `server/.env` and Vercel, so **load them from `server/.env` first**: in a subshell `( … )`, so they don't stay in your shell, and only the keys the command needs (sourcing the whole file can break on values such as a `MONGODB_URI` with `&`). The token and secret then reach curl **through stdin** (`-K -` reads curl options from it), not as arguments: `printf` is a shell builtin and starts no process, while curl's arguments are visible to every user of the machine in `ps` for as long as curl runs.

```bash
( . <(grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET)=' server/.env)
  printf 'url = https://api.telegram.org/bot%s/setWebhook\ndata = secret_token=%s\n' "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_WEBHOOK_SECRET" |
    curl -s -K - -d "url=https://<project>.vercel.app/api/webhooks/telegram" -d 'allowed_updates=["message","callback_query"]' )
```

4. Check it the same way: `( . <(grep '^TELEGRAM_BOT_TOKEN=' server/.env); printf 'url = https://api.telegram.org/bot%s/getWebhookInfo\n' "$TELEGRAM_BOT_TOKEN" | curl -s -K - )` should show the URL and no `last_error_message`.

## 6.5 Zalo bot

1. Create the bot **in the Zalo phone app** (official guide: bot.zaloplatforms.com/docs/create-bot). It can't be done from Zalo Web, because Zalo Web search doesn't find OA accounts and the creator is a mini app:
   1. Open Zalo → search the OA **"Zalo Bot Manager"** → open the chat.
   2. Tap **"Tạo bot"** in the chat menu to open **Zalo Bot Creator**.
   3. Name it with the required **"Bot" prefix**, e.g. **"Bot Sổ Chi Tiêu"**, fill in the rest, and tap **Tạo Bot**.
   4. Zalo sends the bot info and the **Bot Token** to your Zalo account as a message. Save it with `tools/set-secret.sh ZALO_BOT_TOKEN` (§6.3), which writes `server/.env` and pushes it to both Vercel projects.
2. Generate a secret (8–256 chars): `openssl rand -hex 24`.
3. Register the webhook (polling via `getUpdates` stops working once a webhook is set). `setWebhooks.js` (§6.4) does it together with Telegram; by hand, loading the two keys from `server/.env` and passing them through stdin as in §6.4 (keep the JSON free of spaces: curl reads an unquoted option value up to the first space):

```bash
( . <(grep -E '^(ZALO_BOT_TOKEN|ZALO_WEBHOOK_SECRET)=' server/.env)
  printf 'url = https://bot-api.zaloplatforms.com/bot%s/setWebhook\ndata = {"url":"https://<project>.vercel.app/api/webhooks/zalo","secret_token":"%s"}\n' "$ZALO_BOT_TOKEN" "$ZALO_WEBHOOK_SECRET" |
    curl -s -K - -H 'Content-Type: application/json' )
```

4. Check it with `getWebhookInfo` (same base URL), then send the bot a text and a photo. Look at the **first real payloads** in Vercel → Logs to confirm `event_name`, `message.chat.id` and `message.photo_url` (field names come from community SDKs).
5. `ZALO_BOT_URL` for the link card's **Copy & open Zalo** button (§2.10.2): in **Zalo Bot Creator**, pick the bot to open its details page and copy the bot's share link, an `https://` link such as `https://zalo.me/…` (this menu path is not verified yet: the only source found documents the bot's group-invite link, so check it on a phone and correct this step). Save it with `tools/set-secret.sh ZALO_BOT_URL` (or together with the WhatsApp values, §6.12), then check on a phone that the link opens the bot's chat. Optional: without it, Zalo is left out of the link card, and `/link CODE` still works when typed. The value must start with `https://` and be at most 106 bytes (it goes into the card's QR code), and `WHATSAPP_NUMBER` must be digits only with the country code first (no `+`, spaces, dashes or leading 0): the API checks both at startup and **does not start** with a bad value, so check them before you redeploy.

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

*(Planned, §2.11.)* KIE is **retired after the receipt eval**: once Qwen3.5-2B in the agent service reads at least as many true payable totals as KIE on the eval set (and p95 ≤ 15 s), `RECEIPT_READER` flips to `qwen` (§6.13). Keep KIE running until then: with `RECEIPT_READER=kie`, or when the agent service is down, photos still go to KIE. After the flip, stop the KIE container and its tunnel and remove `KIE_URL`, `KIE_PUBLIC_URL` and `KIE_API_KEY` in the PR that removes the KIE client.

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
- [ ] *(After the Meta setup, §6.12)* WhatsApp: Meta's **Configuration** panel shows the callback URL saved and `messages` subscribed; **Open WhatsApp** on the link card → Send → "Linked ✓" within 5 s; `phở 45k` → ✅ → saved
- [ ] Zalo: **Copy & open Zalo** opens the bot with `/link CODE` on the clipboard; paste + send → "Linked ✓"
- [ ] An unlinked chat gets a claim link on the production `APP_URL` (`…/link?t=…`); Confirm links it and the chat gets the success message
- [ ] The link card shows only the apps whose settings were pushed
- [ ] The `/link` confirm screen shows the warning ("Only confirm if you just messaged the bot yourself…"); after Confirm the Bot inbox shows "New chat linked from a chat link: … Not you? [Unlink]", and dismissing it keeps it gone after a reload
- [ ] *(Planned, §2.11)* Agent service: the `tunnel` container is up and `AGENT_PUBLIC_URL` is current (the KIE lesson: a dead tunnel silently broke receipts); `https://<agent tunnel>/health` → `vllm: ok`; `nvidia-smi` shows GPU memory headroom; one receipt is read in under 10 s (§6.13)
- [ ] *(Planned, §2.11)* With the admin runtime switch **off**, ask "tháng này ăn uống hết bao nhiêu?" in the drawer and on Telegram → the help text and the plain commands; switch it **on** (no redeploy) → an exact answer with its sources line; "tháng 10 thu bao nhiêu" in QuickAdd → nothing saved, the question chip shows
- [ ] *(Planned, §2.11)* A note no keyword matches (e.g. `quà sinh nhật 200k`) lands in Khác/Other → a category suggestion follows the draft within 3 s
- [ ] *(Planned, §2.11)* **Chạy ngay** on the admin page sends the digest to an opted-in Telegram test user; pressing it again sends nothing new
- [ ] *(Planned, §2.11)* Vercel → the production project → **Cron Jobs** lists `/api/cron/daily`
- [ ] *(Planned, §2.11)* Stop the agent service (`docker compose -p sochitieu-agent stop agent`) → a question gets the help text, a photo still becomes a draft through KIE (or the bot asks for the amount); start it again
- [ ] *(Planned, §2.12)* Register a new address → the code arrives within about 15 s (check spam) → entering it lands on the Dashboard; **Forgot password?** → code → new password → the old one fails
- [ ] *(After the Meta setup, §6.12)* WhatsApp: the linked chat shows the profile name, and the test phone's number appears nowhere in the app (Bot inbox, Transactions, Admin) or in the API responses in DevTools

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
- Agent service and local model (for §6.13): [Qwen/Qwen3.5-2B model card](https://huggingface.co/Qwen/Qwen3.5-2B) (non-thinking mode, sampling settings), [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3), [vLLM docs](https://docs.vllm.ai/) (OpenAI-compatible server, structured outputs, Docker image `vllm/vllm-openai`), [LangGraph](https://langchain-ai.github.io/langgraph/), [Atlas custom database roles](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/) (also on free clusters, checked 2026-11-25), [Cloudflare quick tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
- Vercel Cron Jobs (for §6.13): [Cron jobs](https://vercel.com/docs/cron-jobs), [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) (`CRON_SECRET`, Hobby limits)
- Gmail (for §6.14): [Sign in with app passwords](https://support.google.com/accounts/answer/185833), [Nodemailer with Gmail](https://nodemailer.com/usage/using-gmail/)
- KIE: [Document-Intelligence-KIE](https://github.com/NguyenVanVuongDev/Document-Intelligence-KIE) (`README.md`, `src/api/main.py`, `Dockerfile`)
- Hugging Face: [Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview), [2026 community thread on free CPU Spaces](https://discuss.huggingface.co/t/official-community-complaint-revert-free-cpu-basic-spaces-and-remove-anti-developer-sdk-restrictions/177703)

## 6.12 WhatsApp Cloud API (Meta) setup (§2.10)

> **The adapter is built (card T34, #74); the Meta side is yours.** `server/src/bot/whatsapp.js` and the route `/api/webhooks/whatsapp` are in the code, and nothing was ever sent to Meta by the build: its tests stub the Graph API. Until you have done the steps below the app deploys and works with WhatsApp off: with any of the four webhook settings unset, `GET` and `POST /api/webhooks/whatsapp` answer 503 and the link card hides WhatsApp, even when `WHATSAPP_NUMBER` is set. Do the steps in this order, once. The bot talks to Meta's WhatsApp Cloud API directly, with no provider in between.

**In short:** (1) create the Meta app and the business number (Meta's side, steps 1–4); (2) `tools/set-secret.sh` the six values and redeploy; (3) register the number; (4) enter the callback URL and verify token in Meta's dashboard and subscribe to `messages`; (5) send `phở 45k` from a phone.

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

It saves them in `server/.env` and pushes them to **both** Vercel projects. The scripts don't change for this: none of the six is on the local-only list in `tools/vercel-env-push.sh`, so they are pushed as typed, like the Telegram and Zalo keys. If a push fails, repeat it with `tools/vercel-env-push.sh production WHATSAPP_ACCESS_TOKEN …` (and `staging`). Then **redeploy** (`tools/deploy.sh production`): Meta's setup check below needs `WHATSAPP_VERIFY_TOKEN` live. `.env.example` lists the six names without values.

**Register the number and the webhook** (after that deploy; production URL, as in §6.4):

1. Register the number for the Cloud API, once, with a 6-digit two-step verification PIN you choose (keep it: Meta asks for it to change or remove the number). `<version>` is the Graph API version pinned in the adapter: `v26.0` (`GRAPH_VERSION` in `server/src/bot/whatsapp.js`, §2.10.4; Meta's changelog lists it as supported until July 2028). Load the two keys from `server/.env` first, and pass the token through stdin as in §6.4: `-H @-` reads the `Authorization` header from stdin, so the token never appears in curl's arguments (visible in `ps`):

```bash
( . <(grep -E '^(WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID)=' server/.env)
  printf 'Authorization: Bearer %s\n' "$WHATSAPP_ACCESS_TOKEN" |
    curl -s "https://graph.facebook.com/<version>/$WHATSAPP_PHONE_NUMBER_ID/register" -H @- -H 'Content-Type: application/json' -d '{"messaging_product":"whatsapp","pin":"<6 digits>"}' )
```

   Check it: `GET https://graph.facebook.com/<version>/$WHATSAPP_PHONE_NUMBER_ID?fields=status,name_status` (same subshell, header through stdin) shows `status: CONNECTED`, and `name_status` tells whether the display name is approved. If the display name is changed later, register again once Meta approves the new name.
2. **Use cases → Customize → Configuration** (older apps: **WhatsApp → Configuration**): **Callback URL** `https://sochitieu-btl.vercel.app/api/webhooks/whatsapp`, **Verify token** = the `WHATSAPP_VERIFY_TOKEN` value → **Verify and save**. Meta sends the `GET` setup check (§2.10.4) and saves only if the route answers 200 with `hub.challenge`.
3. Under **Webhook fields**, **Subscribe** to `messages` only. It carries incoming messages and the sent/delivered/read statuses, which the route ignores.
4. Check it: send `phở 45k` to the business number from a phone; the draft comes back with ✅ / ❌ / ✏️ buttons and the `POST` shows in Vercel → Logs. If Meta's dashboard test reaches the route but real messages never do, the app may not be subscribed to the WhatsApp Business account: `GET https://graph.facebook.com/<version>/<WABA_ID>/subscribed_apps` should list it, and a `POST` to the same URL with the access token subscribes it.

A Meta app has one callback URL, so, like the Telegram and Zalo bots, the WhatsApp bot points at production only.

`setWebhooks.js` (§6.4) has a `whatsapp` entry. With the four settings present it calls nothing and prints `whatsapp: manual: …` with the callback URL to enter: Meta keeps the callback URL on the app, and a script could set it only through the Graph API's app subscriptions with an app token, which needs the app ID, and the app ID is not one of the six variables. So steps 2–3 above are the way. Without the settings it prints `whatsapp: skipped: …`, as it does for Telegram and Zalo.

**If something fails** (the Vercel logs show the status of every call):

- **Verify and save** is refused: a `503` on the `GET` means one of the four settings is missing in that Vercel project or the deploy is older than the push (redeploy); a `403` means the **Verify token** typed in Meta differs from `WHATSAPP_VERIFY_TOKEN`.
- Meta's dashboard test works but your own messages don't arrive: the app is not subscribed to the WhatsApp Business account (`subscribed_apps`, step 4 above). A `401` on the `POST` means `WHATSAPP_APP_SECRET` is not the secret of the app that owns the webhook (**App settings → Basic**, the same app as the number). If the secret is certainly right and every real `POST` still gets 401 on Vercel, the platform may hand the body to Express already read, so the raw bytes Meta signed are gone (`req.rawBody`, [04-backend.md §4.1](04-backend.md)); tests cannot show that, so tell the developer, with the request id from the log.
- The bot is silent and the log says `WhatsApp send failed: …`: the access token is expired or lacks `whatsapp_business_messaging` (code 190 or 10), or the 24-hour window was closed (code 131047): only reply to a message you just sent. Nothing in the log contains the token.
- A user who changed their phone number may get a new BSUID: the bot then sees a new, unlinked chat and sends the claim link, and the user links again.

**When settings are missing** (§2.10.2, §2.10.5):

- The webhook-registration script skips that platform and prints `skipped: …`, as it does for Telegram and Zalo today.
- The link card leaves the app out of the picker: `POST /api/chat-links/code` returns `null` for its entry in `links`. WhatsApp's link is built from `WHATSAPP_NUMBER` and Zalo's is `ZALO_BOT_URL`, so without them the button is hidden (§2.10.2). WhatsApp is also hidden while any of the four webhook settings in the next point is unset (card T34, #74; `createLinkCode` checks `whatsappConfigured()`). Telegram's button follows the same rule with `TELEGRAM_BOT_USERNAME`. The card's side of this rule is built (card T32).
- If any of `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` is unset, the WhatsApp webhook is disabled: `GET` and `POST /api/webhooks/whatsapp` answer 503 `FEATURE_NOT_CONFIGURED` and process nothing (card T34, #74; [04-backend.md §4.2](04-backend.md#42-configuration)). So staging deploys and works without the WhatsApp settings, with WhatsApp hidden and its webhook off.

## 6.13 Agent service and local model (planned, §2.11)

> **Planned (§2.11), not built yet.** Today there is no agent code: `server/src/config/env.js` has none of these variables, there is no `agent/` folder, `vercel.json` has no `crons`, and there is no `/api/cron/daily` route. Do these steps when the agent service and `services/agent.js` are merged. The design is in [01-architecture.md §1.9](01-architecture.md#19-agent-service-and-local-model-planned-211) and [§2.11.4](02-features.md#2114-local-model-layer-qwen35-2b-on-vllm). Choices marked ⚑ are recommendations.

**What runs where.** Express on Vercel stays the only public API. On the GPU host, one `docker compose` project, `sochitieu-agent`, runs three services:

| Service | Image | Listens on | Job |
|---|---|---|---|
| `vllm` | `vllm/vllm-openai:v0.31.0` (pinned) | `127.0.0.1:8300` only | Serves `Qwen/Qwen3.5-2B` as `qwen3.5-2b` (OpenAI-compatible API) |
| `agent` | built from `agent/` (Python 3.12) | `127.0.0.1:8310` only | FastAPI + LangGraph, with the bge-m3 embedder in the same process |
| `tunnel` | `cloudflare/cloudflared` (tag pinned at setup) | — | Quick tunnel to the agent only. vLLM is never exposed |

### GPU host requirements

- An NVIDIA GPU with **≥ 12 GB free** for vLLM plus about 2.3 GB for bge-m3. The team's host has an RTX 5880 Ada (48 GB), of which other services already use about 30 GB, so vLLM is held to `--gpu-memory-utilization 0.25`.
- Docker with Compose v2 and the NVIDIA Container Toolkit (`docker run --rm --gpus all <any CUDA image> nvidia-smi` works).
- About **10 GB of disk** for the model cache (`HF_HOME`): Qwen3.5-2B ≈ 4.5 GB and bge-m3 ≈ 2.3 GB, downloaded once.
- Outbound HTTPS to Hugging Face (first start), Cloudflare (the tunnel) and Atlas (port 27017). Nothing inbound: the tunnel dials out.

### The vLLM command and model pinning

The command the `vllm` service runs (the same command works by hand for a test):

```bash
vllm serve Qwen/Qwen3.5-2B --served-model-name qwen3.5-2b --host 127.0.0.1 --port 8300 \
  --max-model-len 16384 --gpu-memory-utilization 0.25 --max-num-seqs 8 \
  --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --limit-mm-per-prompt '{"image": 1}'
```

- Non-thinking mode only (the model card warns the 2B model loops in thinking mode). The agent sends structured requests through `response_format: {type: json_schema}` (guided JSON) for `decide`, `read_receipt` and `llm_choose`.
- **Pinning.** At setup, record the Hugging Face commit hash of `Qwen/Qwen3.5-2B` and of `BAAI/bge-m3` in `agent/models.lock` (committed). The compose file passes the Qwen hash to vLLM as `--revision`, and the agent loads bge-m3 at its hash. The vLLM image tag and the Python packages are pinned too (versions in [01-architecture.md §1.4](01-architecture.md#14-tech-stack)). Change a pin only together with a run of the skill and receipt evals ([07-testing.md](07-testing.md)).

### The compose project (`agent/docker-compose.yml`)

All three services use host networking, so `127.0.0.1` means the host's loopback and no port is published to the network. A sketch for the builder (file layout is theirs):

```yaml
name: sochitieu-agent
x-gpu: &gpu
  deploy:
    resources:
      reservations:
        devices: [{ driver: nvidia, count: all, capabilities: [gpu] }]
services:
  vllm:
    image: vllm/vllm-openai:v0.31.0
    <<: *gpu
    network_mode: host
    ipc: host
    entrypoint: ["vllm", "serve"]
    command: ["Qwen/Qwen3.5-2B", "--revision", "<Qwen hash from models.lock>",
      "--served-model-name", "qwen3.5-2b", "--host", "127.0.0.1", "--port", "8300",
      "--max-model-len", "16384", "--gpu-memory-utilization", "0.25", "--max-num-seqs", "8",
      "--enable-auto-tool-choice", "--tool-call-parser", "qwen3_coder",
      "--limit-mm-per-prompt", "{\"image\": 1}"]
    environment: { HF_HOME: "${HF_HOME}" }
    volumes: ["${HF_HOME}:${HF_HOME}"]
    restart: unless-stopped
  agent:
    build: .
    <<: *gpu
    network_mode: host
    env_file: .env            # the only service that gets the secrets
    volumes: ["${HF_HOME}:${HF_HOME}"]
    depends_on: [vllm]
    restart: unless-stopped
  tunnel:
    image: cloudflare/cloudflared:<pinned tag>
    network_mode: host
    command: ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8310"]
    restart: unless-stopped
```

Compose reads `HF_HOME` from `agent/.env` for the volume paths. The `agent` image starts uvicorn on `127.0.0.1:8310`.

### Atlas: a custom role and the user `sochitieu_agent`

The agent service never uses the app's `finance_app` user. In Atlas → the project → **Database & Network Access**:

1. **Custom Roles → Add New Custom Role**, name `sochitieuAgent`, with these **Collection Actions** on database `finance`:

| Actions | Collections |
|---|---|
| `find` | `users`, `categories`, `wallets`, `transactions`, `budgets` |
| `find`, `insert`, `update` | `pendingActions` |
| `find`, `insert`, `update`, `remove` | `agentSkills`, `agentTools`, `agentTurns`, `agentMemory`, `agentCategoryVectors`, `receiptReads` |

   No database or global actions. Free clusters support custom roles; a change can take up to 30 s to apply.
2. ⚑ **Collections and indexes** (the TTL and unique indexes of [03-database.md](03-database.md)) are created once with the app user, by the agent's setup command run with `MONGODB_URI`, so `sochitieu_agent` needs no index or drop rights. The command's name is left to the builder.
3. **Database Users → Add New Database User**: `sochitieu_agent`, **Autogenerate Secure Password**, role: only the custom role `sochitieuAgent`. The network access list already allows `0.0.0.0/0` (§6.2).
4. Its URI, with the database name: `mongodb+srv://sochitieu_agent:<password>@<cluster>.mongodb.net/finance?retryWrites=true&w=majority&appName=sochitieu-agent`. It goes only into `agent/.env` (next step).

### Agent host `agent/.env`

Git-ignored, on the GPU host only, never on Vercel. Create it empty with mode 600 (`install -m 600 /dev/null agent/.env`) and fill it in an editor, so no secret is typed on a command line:

| Variable | Value |
|---|---|
| `AGENT_SECRET` | `openssl rand -hex 32`. The same value goes to Vercel (setup step 6) |
| `MONGODB_URI_AGENT` | the `sochitieu_agent` URI above |
| `VLLM_BASE_URL` | `http://127.0.0.1:8300/v1` |
| `LLM_MODEL` | `qwen3.5-2b` |
| `EMBED_MODEL` | `BAAI/bge-m3` |
| `HF_HOME` | the model cache directory on the host, e.g. `/srv/hf-cache` |

⚑ The agent service refuses to start without `AGENT_SECRET` or `MONGODB_URI_AGENT`, so it never runs open.

### Vercel variables (Express)

All optional; a missing one turns its feature off (§2.11.6):

| Variable | Purpose | Value | When unset |
|---|---|---|---|
| `AGENT_URL` | The agent service's base URL | Vercel: pushed from `AGENT_PUBLIC_URL` (the tunnel URL). `server/.env`: the local address, e.g. `http://127.0.0.1:8310`, when you develop on the GPU host | No call to the agent service: a question gets the help text and the plain commands, a photo goes to KIE (or the bot asks for the amount), a fallback draft stays Khác/Other with the A7 buttons, and the cron sends only B3 drafts |
| `AGENT_SECRET` | `Authorization: Bearer …` on every call to the agent service | the same value as in `agent/.env` | The agent client is off, as with `AGENT_URL` unset |
| `RECEIPT_READER` | Which reader gets photos: `kie` or `qwen` | `kie` until the receipt eval passes, then `qwen` | `kie` |
| `ASSISTANT_ENABLED` | Hard on/off for questions to the agent service. The admin runtime switch works only below it; changing this one needs a redeploy | `true` or `false` | `false`: a question gets the help text and the plain commands |
| `ASSISTANT_CHANNELS` | Where agent answers may go | `web,telegram,zalo,whatsapp` | all four; the per-channel daily caps (30 web, 20 Telegram, 10 Zalo, 5 WhatsApp) still apply |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer …` on every cron call; the route checks it with `sameSecret()` | `openssl rand -hex 32` | `sameSecret()` refuses an unset secret, so the scheduled call gets 401 and no proactive message goes out on a schedule |

`AGENT_PUBLIC_URL` stays local (like `KIE_PUBLIC_URL`) and is pushed as `AGENT_URL`. The PR that adds `AGENT_URL` also adds `AGENT_URL` and `AGENT_PUBLIC_URL` to the local-only list and the `KIE_PUBLIC_URL` mapping in `tools/vercel-env-push.sh`, and the names, without values, to `.env.example`.

### Setup order

1. **GPU check:** `nvidia-smi` on the GPU host shows **≥ 12 GB free**.
2. **Atlas:** the custom role and the user `sochitieu_agent` (above), then the agent's setup command for collections and indexes.
3. **`agent/.env`** (above), and the two hashes in `agent/models.lock`.
4. **Start:** `docker compose -p sochitieu-agent up -d --build` in `agent/`. The first start downloads the models (several minutes). Then `curl -s http://127.0.0.1:8310/health` → `{"vllm":"ok","embedder":"ok",…}`.
5. **Tunnel URL:** `docker compose -p sochitieu-agent logs tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1`.
6. **Save and push** on the machine with `server/.env` (values are asked hidden; paste the URL from step 5 and the `AGENT_SECRET` from `agent/.env`; type `-` to skip one):

```bash
tools/set-secret.sh AGENT_PUBLIC_URL AGENT_SECRET RECEIPT_READER ASSISTANT_ENABLED CRON_SECRET
```

   This saves them in `server/.env` and pushes them to **both** Vercel projects, `AGENT_PUBLIC_URL` as `AGENT_URL`. Leave `RECEIPT_READER` at `kie` (or skip it) until the receipt eval passes, and set `ASSISTANT_ENABLED=true` only when Stage AI is ready. If a push fails, repeat it with `tools/vercel-env-push.sh production AGENT_URL …` (and `staging`).
7. **Redeploy** both projects (`tools/deploy.sh staging`, then `production`).
8. **Smoke test:**
   - `curl -s https://<agent tunnel>/health` from any machine → `vllm: ok`.
   - One question: ask "hôm nay tiêu bao nhiêu?" in the web drawer → an answer with its sources line. By hand on the GPU host, with the secret read from `agent/.env` and passed through stdin (as in §6.4: `-H @-` reads the header from stdin, so the secret never appears in `ps`):

```bash
( . <(grep '^AGENT_SECRET=' agent/.env)
  printf 'Authorization: Bearer %s\n' "$AGENT_SECRET" |
    curl -s http://127.0.0.1:8310/v1/turn -H @- -H 'Content-Type: application/json' \
      -d '{"trigger":"chat","userId":"<a test user id>","channel":"web","threadKey":"smoke","requestId":"smoke-1","text":"hôm nay tiêu bao nhiêu?","language":"vi","today":"2026-11-25"}' )
```

   - One receipt: `POST /v1/receipt` the same way with one photo from `server/test/fixtures/receipts/` (base64 in `image`) → a `total` in under 10 s.

### When something is missing or down

- **A Vercel variable unset:** see the "When unset" column above. Typed capture, drafts, `ok`/`huy`, buttons and the plain commands never depend on the agent service.
- **The agent service down, slow or busy:** questions get the help text and the plain commands (web: 503 `AGENT_UNAVAILABLE`, or `AGENT_BUSY` past 8 running + 16 queued); photos fall back to KIE when `KIE_URL` is set, else "type the amount"; categories stay Khác/Other; the cron skips that night's agent messages.
- **vLLM down but the agent up:** `/health` shows `vllm: down`. Pipeline skills still answer (they need no LLM); agent-mode questions, receipts and ties in the categorizer fall back as above.

### The tunnel URL changes

A quick-tunnel URL changes every time the `tunnel` container restarts (a reboot, `docker compose restart`, an image update). Then: step 5 for the new URL, `tools/set-secret.sh AGENT_PUBLIC_URL`, redeploy both projects. Until then every agent call fails and the fallbacks above apply. For a stable URL, use a free Cloudflare account and a **named tunnel** on your own domain, as for KIE (§6.6).

### Demo-day checks

The KIE lesson: a dead tunnel silently broke receipts. So before a demo (also in §6.9):

- `docker compose -p sochitieu-agent ps`: all three services up.
- `curl -s https://<agent tunnel>/health` → `vllm: ok`, and the URL equals the pushed `AGENT_PUBLIC_URL`.
- `nvidia-smi`: GPU memory headroom (nothing else has grabbed the 12 GB).
- One receipt read in under 10 s.

### Staging

⚑ Leave `AGENT_URL` unset on staging: questions there get the help text, photos go to KIE. The agent service reads one database (the one in `MONGODB_URI_AGENT`, `finance`), so pointing staging at it would find none of the staging users' data in `finance_staging` and would write their `agentTurns` into `finance`. If staging needs the agent, run a second `agent` service in the same compose project with its own port, its own `MONGODB_URI_AGENT` (database `finance_staging`, the role granted on that database too) and its own tunnel; it can share the one `vllm`.

### Daily cron

`CRON_SECRET` is in the table above: generate it with `openssl rand -hex 32` and paste it at the step 6 prompt. You never type it anywhere else: Vercel adds the header itself. After the deploy that carries the `crons` entry (§6.3), Vercel → the project → **Settings → Cron Jobs** lists `/api/cron/daily`, with a **Run** button for a manual test. Crons don't fire locally; use the admin **Chạy ngay** button (`POST /api/admin/cron/daily`) there and for the demo.

**Both projects run the cron.** §2.11.2 says production only, but every deploy of ours is a production deploy (§6.3), so Vercel runs the `crons` entry in the staging project too, against `finance_staging` and with the same bot tokens. Whether staging should send proactive messages is **left to you**. To stop it, remove `CRON_SECRET` from the staging project after the push (Vercel → `sochitieu-btl-staging` → Settings → Environment Variables) and redeploy staging: its cron calls then get 401. With `AGENT_URL` unset on staging (above), its cron sends only B3 drafts anyway.

## 6.14 Gmail SMTP for email codes (planned, §2.12)

> **Planned (§2.12), not built yet.** Today `server/src/config/env.js` has no `GMAIL_*` variable and there is no mailer; register logs the user in at once. Do these steps when `services/mail.js` is merged.

**What each variable does** (both optional; both must be set for mail to be on, §2.12.4):

| Variable | Purpose | When unset |
|---|---|---|
| `GMAIL_USER` | The sending Gmail address; mails come from `"Sổ chi tiêu" <GMAIL_USER>` | see below |
| `GMAIL_APP_PASSWORD` | The 16-character Google app password for that address (not the account password) | see below |

With either one unset:
- **Development and test:** the API boots, and the code is written to the server log instead of sent (`[mail] signup code for a***@gmail.com: 123456`), so the whole flow works without Gmail.
- **Production:** register works as today (201, logged in, no code), so sign-ups never stop; `POST /api/auth/password/forgot` answers 503 `FEATURE_NOT_CONFIGURED`.

**One-time setup** on the Google account that will send the mail:

1. Turn on **2-Step Verification**: Google account → **Security** → **2-Step Verification**. App passwords exist only with it on.
2. Make an **app password**: Google account → Security → 2-Step Verification → **App passwords**; name it, e.g. `sochitieu`. Google shows the 16 characters once, in groups of four: paste them without the spaces straight into `tools/set-secret.sh` (below).
3. Changing the Google account's password revokes every app password. Then make a new one and push it again.

**Save and push:**

```bash
tools/set-secret.sh GMAIL_USER GMAIL_APP_PASSWORD
```

It saves both in `server/.env` and pushes them to **both** Vercel projects (§2.12.5); never commit them. Then **redeploy** both projects. Check it: register a new address on staging, and the code should arrive within about 15 s (look in spam too).

**The escape hatch** (§2.12.4): if Google stops the account sending (bounces, or the 500-a-day limit), remove the two values and redeploy. Sign-up then works without codes until the account recovers. §2.12.4 says to do this with `tools/set-secret.sh`, but today the script can't remove a key (an empty paste is asked again, `-` skips), so either the PR that builds the mailer gives it a remove option, or remove them by hand: delete the two lines from `server/.env` and the two variables in Vercel → each project → **Settings → Environment Variables**.

**Logs** never contain the code or the password in production; addresses are masked (`a***@gmail.com`, §2.12.5).
