# 🎮 Pellizzola Brothers

A platform for creating and managing user-generated content. (UGC) <br>
Vanilla-JS frontend, Express/PostgreSQL backend, no build step.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon%20%7C%20Railway-4169E1?logo=postgresql&logoColor=white)
![JavaScript](https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)
![i18n](https://img.shields.io/badge/i18n-PT--BR%20%2F%20EN-informational)

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [API Overview](#api-overview)
- [Internationalization](#internationalization)
- [Deployment](#deployment)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🔐 **Accounts** — registration, login, and password recovery (6-digit code flow) with JWT + bcrypt
- 🎮 **Levels** — upload, browse, search, filter, and download player-made levels
- ❤️ **Likes & comments** — atomic like/unlike (no race conditions), threaded comments, report/flag a level
- 👤 **Profiles** — public creator profiles with stats, bio editing, avatar picker, like/download history
- 🌐 **i18n** — PT-BR and EN, switchable live, works even opened directly via `file://`
- 🥚 Click the nav logo 9 times for a surprise

## Tech Stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | Vanilla HTML/CSS/JS — no framework, no build step |
| Backend   | Node.js + Express |
| Database  | PostgreSQL (`@neondatabase/serverless` with WebSocket, falls back to plain `pg` locally) |
| Auth      | JWT Bearer tokens + bcrypt password hashing |
| Uploads   | Multer (disk storage) |
| Hosting   | Railway (Nixpacks build) |

## Project Structure

```
backend/           Express API
  server.js        Entry point — CORS, rate limiting, mounts routes, serves frontend/ as static files
  db.js            Singleton pg Pool (DATABASE_URL or local DB_* vars)
  middleware/auth.js   JWT verification
  routes/
    auth.js        register, login, password recovery
    users.js       profile CRUD
    levels.js      listing, likes, comments, reports, downloads
    upload.js      multer upload → /levels + DB insert
    files.js       serve uploaded level files

frontend/          Static pages + vanilla JS
  config.js        API base URL — the one line to switch local ↔ production
  auth.js / util.js / cache.js / nav.js / i18n.js   Shared helpers (see CLAUDE.md for details)
  *.html           One page per route — index, levels, usuarios (creators), login,
                    upload, perfil_do_usuario/jogo (profiles), little_coffee (lounge), etc.

levels/            Uploaded level files (multer destination)
pauro_database.sql Full schema + seed data + migrations
railway.json       Railway build/deploy config
```

For the deeper architectural notes (why things are built the way they are, escaping conventions, i18n key rules), see **[CLAUDE.md](./CLAUDE.md)**.

## Getting Started

### Prerequisites

- Node.js 18+
- A PostgreSQL database — local instance, or a free one on [Neon](https://neon.tech) / [Railway](https://railway.app) / [Supabase](https://supabase.com)

### Installation

```bash
git clone <this-repo>
cd website/backend
npm install
```

### Environment Variables

Copy `.env.example` to `backend/.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | one of these two | Neon/Railway/Supabase connection string |
| `DB_SERVER` / `DB_USER` / `DB_PASSWORD` / `DB_DATABASE` / `DB_PORT` | one of these two | individual vars for a local Postgres instance |
| `JWT_SECRET` | **yes** | server refuses to start without it — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ALLOWED_ORIGINS` | no | comma-separated origins; leave empty in dev to allow all |
| `PORT` | no | defaults to `3000` |

Load `pauro_database.sql` into your database to get the schema (and seed data, if you want it).

### Running Locally

```bash
cd backend
npm run dev     # nodemon, auto-reload
# or
npm start       # production mode
```

The Express server also serves `frontend/` as static files, so once it's running, open **http://localhost:3000** — no separate frontend server or build step needed.

To point the frontend at a different backend (e.g. production), edit the one active line in `frontend/config.js`.

## API Overview

All routes are namespaced under `/api/*`.

| Route | Purpose |
|---|---|
| `POST /api/auth/register`, `/login` | account creation & login |
| `POST /api/auth/recovery/request`, `/verify`, `/reset` | 3-step password recovery |
| `GET /api/users`, `/api/users/:id` | list / view creator profiles |
| `PUT /api/users/:id` | edit own profile (auth) |
| `GET /api/levels`, `/api/levels/:id`, `/api/levels/featured` | browse & search levels |
| `POST /api/levels/:id/like`, `/unlike`, `/comment`, `/report` | level interactions (auth) |
| `POST /api/levels/:id/download` | download counter, optional user attribution |
| `POST /api/upload/level` | multipart upload of a level file (auth) |
| `GET /api/files/:id` | resolve a file's metadata for download |

There's no Swagger/OpenAPI doc — read the route files directly, they're short and each endpoint is a few lines with inline comments.

## Internationalization

Translations live in `frontend/i18n/en.json` / `pt_BR.json`, additionally compiled into `en.js` / `pt_BR.js` so pages work even opened straight from disk (`file://`) without a server. When adding a new page, add its `nav.*` keys to **both** the `.json` and `.js` copies of each language, or the two will drift.

## Deployment

Deployed on [Railway](https://railway.app). `railway.json` builds with `cd backend && npm install` and starts with `node backend/server.js`; the same Express process serves the API and the static frontend, so there's only one service to deploy.

## Known Limitations

- **No test suite.** Manual testing against a local Postgres instance is the norm — see [CLAUDE.md](./CLAUDE.md).
- **`admin.html`** is an unlinked UI mockup, not a real admin panel — its password gate and every action (ban/delete/promote) are client-side decoration with no backend authorization behind them.

## Contributing

Issues and PRs are welcome. Keep changes framework-free and dependency-light — this project intentionally stays vanilla JS with no build step. If you're using an AI coding assistant, read [CLAUDE.md](./CLAUDE.md) first; it documents the conventions the codebase expects (escaping rules, i18n key duplication, shared script loading order, etc.).

## License

No license file is currently included in this repository — all rights reserved by default until one is added.
