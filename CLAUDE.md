# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install backend dependencies
cd backend && npm install

# Run backend locally (with auto-reload)
cd backend && npm run dev

# Run backend in production mode
cd backend && npm start

# Lint frontend JS
npx eslint frontend/
```

There is no test suite. Manual testing against a local Postgres instance is the norm.

## Environment setup

Copy `.env.example` to `backend/.env` and fill in:
- `DATABASE_URL` — Neon/Railway/Supabase connection string, **or** the individual `DB_*` vars for local Postgres
- `JWT_SECRET` — required or the server refuses to start; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ALLOWED_ORIGINS` — leave empty in dev (allows all); set comma-separated domains in prod

## Architecture

This is a single-repo web app: a vanilla-JS frontend served as static files by the same Express backend that exposes the API.

```
backend/           Express API (Node.js)
  server.js        Entry point — CORS, rate limiting, mounts routes
  db.js            Singleton pg Pool; supports DATABASE_URL or individual DB_* vars
  middleware/
    auth.js        JWT Bearer token verification
  routes/
    auth.js        register, login, password recovery (bcrypt + JWT)
    users.js       user profile CRUD
    levels.js      level listing, likes/unlikes (atomic PostgreSQL arrays), comments, reports, downloads
    upload.js      multer file upload → saves to /levels dir + inserts into DB
    files.js       serve uploaded level files

frontend/          Static HTML pages + vanilla JS
  config.js        Single source of truth for API base URL — change this one line to switch between local and production
  auth.js          LocalStorage session helpers (saveSession, getToken, getUser, isLoggedIn, clearSession)
  cache.js         Simple in-memory cache for API responses
  i18n.js          i18n loader; translations in i18n/en.json and i18n/pt_BR.json
                   (also compiled into i18n/en.js and i18n/pt_BR.js for file:// compatibility)

  download.html    Download page for PB Game and PB Studio — linked from the global nav
  little_coffee.html  Cafézinho da Chapeleira community chat/lounge — linked from the global nav
  sobre.html       About page — linked from its own nav entry only
  creditos.html    Credits page — hidden Easter egg, accessible by clicking the nav brand 9 times

levels/            Uploaded level files stored on disk (multer destination)
pauro_database.sql Full schema + seed data + migration scripts for v5→v6 and v6→v6.1
```

## Key design decisions

**API prefix**: All API routes live under `/api/*`. The frontend must prefix every fetch with the `API` constant from `config.js` (e.g., `${API}/auth/login`), never a bare path.

**Deployment**: Deployed on Railway. `railway.json` builds with `cd backend && npm install` and starts with `node backend/server.js`. The backend also serves the frontend as static files via `express.static`.

**Database**: Uses `@neondatabase/serverless` with a WebSocket constructor for Neon compatibility, but falls back to standard `pg` Pool for local Postgres. Always use `await getPool()` to get the pool instance.

**Likes**: Stored as a PostgreSQL `INT[]` column (`liked_by_ids`) with a GIN index. Like/unlike are single atomic `UPDATE ... WHERE NOT (liked_by_ids @> ARRAY[$1]::int[])` queries — no separate join table, no race condition.

**Password recovery**: Generates a 6-digit code, hashes it with bcrypt, stores it with a 15-minute expiry. In non-production, the code is returned in the response for testing.

**Switching to production API**: Edit `frontend/config.js` — comment/uncomment the two `const API =` lines.

**Nav brand Easter egg**: Clicking "🎮 Pellizzola Brothers" 9 times navigates to `creditos.html`. The counter persists in `sessionStorage` under the key `pb_brand_clicks` and is reset after the redirect. The script is injected inline before `</body>` in every page.

**i18n keys to add**: When creating a new page, add `nav.download` and `nav.cafezinho` keys to both `i18n/en.json` + `i18n/en.js` and `i18n/pt_BR.json` + `i18n/pt_BR.js`. The `.js` files are the same content wrapped in `window.PB_I18N[lang] = {...}` for `file://` compatibility — keep both in sync.
