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
npx eslint frontend/   (flat config: eslint.config.js)
```

End-to-end tests (headless Chrome via Selenium) live in `tests/`:

```bash
cd tests && npm install && npm test   # HEADFUL=1 to watch
```

They boot the backend on :3000 against the `DATABASE_URL` in `backend/.env`, use a temp `LEVELS_DIR`, create `e2e_*` users and delete them afterwards. Each step's page HTML is saved in `tests/output/` (gitignored) and failures print the `<body>` markup.

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
    auth.js        JWT Bearer verification + per-request ban check
    admin.js       requireAdmin (role check)
  lib/
    captcha.js     SVG captcha with AES-GCM token
    bruteforce.js  per-IP login throttling, in memory (captcha after 3 fails; 3 fails = timeout 1min/15min/24h)
    lvlhash.js     .lvl structure check + level_hash verification (the hash recipe below)
    blacklist.js   IP blacklist guard (first middleware in server.js), in-memory `net.BlockList` of the `blacklist` table
    settings.js    global flags (maintenance_mode, allow_registration, allow_upload)
  routes/
    admin.js       admin dashboard API (/api/admin/*)
    auth.js        register, login, password recovery (bcrypt + JWT)
    users.js       user profile CRUD
    levels.js      level listing, likes/unlikes (atomic PostgreSQL arrays), comments, reports, downloads
    upload.js      multer upload (.lvl only) → checkLvl() → saves to /levels dir + inserts into DB
    files.js       serve uploaded level files

frontend/          Static HTML pages + vanilla JS
  config.js        Single source of truth for API base URL — change this one line to switch between local and production
  auth.js          LocalStorage session helpers (saveSession, getToken, getUser, isLoggedIn, clearSession)
  cache.js         Simple in-memory cache for API responses
  util.js          Shared escHtml() — always use it when interpolating API/user data into innerHTML
  nav.js           Shared nav behaviour: swaps "Entrar" for the logged-in username (#nav-auth) Pages must NOT set #nav-auth themselves; include via <script src="nav.js"> before </body>
  i18n.js          i18n loader; translations in i18n/en.json and i18n/pt_BR.json
                   (also compiled into i18n/en.js and i18n/pt_BR.js for file:// compatibility)

  download.html    Download page for PB Game and PB Studio — linked from the global nav
  sobre.html       About page — linked from its own nav entry only
  creditos.html    Credits page — linked from sobre.html and download.html
  admin.html       Admin dashboard, backed by /api/admin/* (requires role=admin, enforced by backend/middleware/admin.js).

levels/            Uploaded level files stored on disk (multer destination)
pauro_database.sql Schema only (fresh database)
```

## The level_hash recipe

`information.level_hash` in a `.lvl`'s `level.json` must equate to a SHA-256 (hex) over the archive's contents: every file sorted by name (directory entries skipped), each fed as `name NUL byte-length NUL bytes`, with `level.json` replaced by compact `JSON.stringify()` of its parse minus `level_hash`. Zip timestamps, compression and `level.json`'s layout never matter. `backend/lib/lvlhash.js` implements this and `routes/upload.js` rejects any `.lvl` that is missing the hash, has an invalid one, or doesn't match.

## Key design decisions

**API prefix**: All API routes live under `/api/*`. The frontend must prefix every fetch with the `API` constant from `config.js` (e.g., `${API}/auth/login`), never a bare path.

**Deployment**: Deployed on Railway. `railway.json` builds with `cd backend && npm install` and starts with `node backend/server.js`. The backend also serves the frontend as static files via `express.static`.

**Database**: Uses `@neondatabase/serverless` with a WebSocket constructor for Neon compatibility, but falls back to standard `pg` Pool for local Postgres. Always use `await getPool()` to get the pool instance.

**Deleting levels is a soft delete**: `levels.active = false` + the file is removed from `levels/` (`deactivateLevel()` in `backend/lib/levels.js`). The row stays in the DB; every public query filters `active`, only admins can still read it (`GET /levels/:id`, `/api/admin/levels`). Never `DELETE FROM levels` in app code.

**Likes**: Stored as a PostgreSQL `INT[]` column (`liked_by_ids`) with a GIN index. Like/unlike are single atomic `UPDATE ... WHERE NOT (liked_by_ids @> ARRAY[$1]::int[])` queries — no separate join table, no race condition.

**IP blacklist**: `blacklist(ip INET, expires_at)`, `expires_at NULL` = permanent. `ip` may be a single address or a CIDR range (`192.0.0.0/8`; `/0` rejected) — ranges are added only via the Blacklist page form, the user "IP-Ban" button is always one exact IP. Matching uses `net.BlockList` in memory. `lib/blacklist.js` `guard` runs before everything: blocked IPs get a redirect to `forbidden.html` (pages) or 403 JSON (`/api`); static assets and `admin.html` pass; admins (Bearer token, role checked in DB) bypass the API block. The set is cached in memory (30s TTL, reloaded on admin changes). Managed from admin.html (Blacklist page, and "IP-Ban" on users, which bans `users.last_ip` — set at login/register — without banning the account). `server.js` sets `trust proxy` to 1 only when `RAILWAY_ENVIRONMENT` is set; change it there if the proxy setup changes, or `req.ip` will be wrong/spoofable.

**Password recovery**: Generates a 6-digit code, hashes it with bcrypt, stores it with a 15-minute expiry. In non-production, the code is returned in the response for testing.

**Switching to production API**: Edit `frontend/config.js` — comment/uncomment the two `const API =` lines.

**Escaping user data**: Every page builds its DOM via string-concatenated `innerHTML` rather than templates. Any value that originated from the API or user input (level name/description, username, bio, comments, report reason) **must** go through `escHtml()` from `util.js` before being concatenated in — plain `+` concatenation without it is a stored-XSS hole. Never splice such a value directly into an inline `onclick="fn('...')"` attribute either, even escaped — HTML-attribute-decoding happens before the browser parses the handler as JS, so `escHtml()` does not make that safe. Pass only the numeric id through the attribute and look the record up by id inside the handler (see `openDeleteModal` in `perfil_do_usuario.html` or `banUser`/`deleteLevel` in `admin.html`).

**i18n keys to add**: When creating a new page, add a `nav.<page>` key to both `i18n/en.json` + `i18n/en.js` and `i18n/pt_BR.json` + `i18n/pt_BR.js`. The `.js` files are the same content wrapped in `window.PB_I18N[lang] = {...}` for `file://` compatibility — keep both in sync.
