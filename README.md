# Zalo-Tele Integrated Financial App

A personal finance web app (topic #16, *Quản lý chi tiêu cá nhân*) with **Telegram and Zalo bots**: send `phở 45k` or a receipt photo to the bot, confirm the draft, and it becomes a transaction. The web app has wallets, categories, monthly budgets and statistics. It supports Vietnamese and English and has light and dark themes.

> Status: **specification only**, no code yet. Final-term web class project (BTL).

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
