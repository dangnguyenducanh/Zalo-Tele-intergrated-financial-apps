# Zalo-Tele Integrated Financial App

A personal finance web app (topic #16, *Quản lý chi tiêu cá nhân*) with **Telegram and Zalo bots**: send `phở 45k` or a receipt photo to the bot, confirm the draft, and it becomes a transaction. The web app has wallets, categories, monthly budgets and statistics. It supports Vietnamese and English and has light and dark themes.

> Status: **live** since 2026-11-21. 29 task cards built, reviewed and merged (T17–T18 are the UI redesigns, T19 the real-chat bot e2e, T20–T29 the bug fixes found by charter runs, recorded retests, code review, the deploy check and real-chat runs). 366 automated tests: 195 server and 126 client (Vitest), 41 end-to-end (Playwright), 4 tool self-tests. The last logged run (RUN-022, Vitest on the merged code) passed 320 with 1 skipped; CI runs only the Vitest suites, and the last logged Playwright run (RUN-008/009) predates round 2. Two receipt tests, TC-F10-01 (Vitest) and TC-F10-03 (Playwright), need the live KIE service and skip without it; TC-F10-01 is the one skipped in CI. 159 test cases and 22 test runs are logged. 33 bugs (2 found by automated tests, 25 by manual charter runs, 2 by real-chat bot runs, 2 by recorded retests, 1 by code review, 1 by a deploy check), all fixed and closed. Final-term web class project (BTL), done by one student.

| | |
|---|---|
| Web app (production) | https://sochitieu-btl.vercel.app (live, database up) |
| Test site (staging) | https://sochitieu-btl-staging.vercel.app (live, separate database `finance_staging` with test users) |
| Telegram bot | [@sochitieu_btl_bot](https://t.me/sochitieu_btl_bot) (webhook points at production) |
| Zalo bot | created in the Zalo phone app; webhook points at production ([docs/06 §6.5](docs/06-deployment.md)) |
| Test & bug report | [docs/testing/test-report.xlsx](docs/testing/test-report.xlsx) |

## Run it locally

Needs Node.js 22 and npm. Tests need no database or secrets: they start an in-memory MongoDB and stub the bot APIs. Once per clone, the end-to-end tests need a browser (`npx playwright install chromium`) and the report tool needs its own package (`npm install --prefix tools/test-report`).

```bash
npm ci
cp .env.example server/.env   # fill it in; never commit it
npm run dev                    # API on :4100, web on :5300 (Vite proxies /api)
npm run seed                   # default categories + the admin from SEED_ADMIN_EMAIL/PASSWORD
```

Secrets go in with `tools/set-secret.sh KEY…`, which asks for each value without showing it, saves it in `server/.env` and pushes it to both Vercel projects. Deploys go through `tools/deploy.sh staging|production`, staging first. See [docs/06](docs/06-deployment.md) for Atlas, Vercel, the bots and the receipt service.

## Tests

```bash
npm run typecheck && npm run lint
npm test                 # Vitest: API, webhooks, parser, components (writes test-results/*.xml)
npm run test:e2e         # Playwright: journeys, responsive, axe accessibility, security (with video)
npm run report -- --junit test-results/server-vitest.xml --junit test-results/client-vitest.xml --junit test-results/e2e.xml
```

The last command rebuilds the Excel report: test cases with what each one proves, the bug log with root cause and fix, and the run history. The test plan and the fix-and-retest loop are in [docs/07](docs/07-testing.md).

## Team (Phân công)

One member did every part: requirements and design, frontend, backend, database, both bots, receipt reading, testing and deployment. The build was split into 29 task cards (T01–T29) plus one bug card (#34, BUG-002), each implemented, reviewed and merged as its own pull request; T20–T29 are bug-fix cards ([docs/08](docs/08-agent-workflow.md)).

## Documentation

| Doc | What it covers |
|---|---|
| [Architecture & tech stack](docs/01-architecture.md) | System diagram, components, request flows, tech stack with versions, repo layout, key decisions |
| [Features](docs/02-features.md) | Roles, screens, bot behaviour, text parser rules, i18n/themes, slide requirement checklist, build order |
| [Database](docs/03-database.md) | MongoDB collections, fields, relations, indexes, seed data |
| [Backend](docs/04-backend.md) | Express structure, JWT auth, REST API reference, webhooks, KIE client, errors |
| [Frontend](docs/05-frontend.md) | React routes, layouts, state (AuthContext + Redux Toolkit), i18n, theming |
| [Deployment](docs/06-deployment.md) | Vercel + MongoDB Atlas free setup, bot webhooks, hosting the KIE service, env vars |
| [Testing](docs/07-testing.md) | Test levels, per-feature test cases, manual browser sessions with recordings and logs, fix-and-retest loop, Excel bug report |
| [Agent workflow](docs/08-agent-workflow.md) | Coder / reviewer / merger agents on treehouse worktrees: roles, scope, procedures, task cards, merge queue |

## Stack at a glance

- **Frontend:** React 19 + **TypeScript**, Vite, React Router, Redux Toolkit (RTK Query), MUI, react-i18next
- **Backend:** Node.js 22, Express 5 (one Vercel Function), Mongoose, JWT + bcrypt
- **Database:** MongoDB Atlas (free cluster)
- **Bots:** Telegram Bot API and Zalo Bot Platform, both through webhooks
- **Receipt reading:** [Document-Intelligence-KIE](https://github.com/NguyenVanVuongDev/Document-Intelligence-KIE), used with the author's permission. It runs as a separate Docker service (PaddleOCR + spatial KIE).
- **Hosting:** Vercel (Hobby) for web and API, Atlas for data, KIE on a machine reached through a Cloudflare Tunnel

## Credits

- Data model and parsing ideas are adapted from [ezBookkeeping](https://github.com/mayswind/ezbookkeeping) (MIT). No code is copied.
- Receipt extraction comes from [Document-Intelligence-KIE](https://github.com/NguyenVanVuongDev/Document-Intelligence-KIE) by NguyenVanVuongDev, used with permission.
