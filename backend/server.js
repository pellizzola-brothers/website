require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const usersRouter  = require('./routes/users');
const levelsRouter = require('./routes/levels');
const authRouter   = require('./routes/auth');
const uploadRouter = require('./routes/upload');
const filesRouter  = require('./routes/files');
const adminRouter  = require('./routes/admin');
const { getSetting } = require('./lib/settings');
const blacklist = require('./lib/blacklist');

// Express 4 ignora promises rejeitadas em handlers async: a requisição travava e o
// Node derrubava o processo (ex.: body {"username": 123} → username.toLowerCase()).
// Encaminha a rejeição para next(err), tratado no handler de erro no fim do arquivo.
const Layer = require('express/lib/router/layer');
const handleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  if (this.handle.length > 3) return handleRequest.call(this, req, res, next);
  try {
    const p = this.handle(req, res, next);
    if (p && typeof p.catch === 'function') p.catch(next);
  } catch (err) { next(err); }
};

const app  = express();
const PORT = process.env.PORT || 3000;

// Atrás do proxy da Railway, req.ip seria o IP do proxy (blacklist e rate limit
// agiriam sobre todo mundo). Local não tem proxy: confiar no X-Forwarded-For deixaria
// qualquer cliente forjar o próprio IP. Se mudar a infra, ajuste aqui (nº de proxies na frente).
if (process.env.RAILWAY_ENVIRONMENT) app.set('trust proxy', 1);

app.use(blacklist.guard);

// ── Rate limiting global ─────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um momento.' }
});

// ── CORS configurável via env ────────────────────────────────
// ALLOWED_ORIGINS=https://meusite.com,https://outro.com
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [];

const corsOptions = {
  origin: (origin, callback) => {
    // Sem origem = requisição direta (ex: curl, Postman) ou same-origin — permitir
    if (!origin) return callback(null, true);
    // Lista vazia = desenvolvimento, permite tudo
    if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
// Só a API é limitada: contar CSS/JS/HTML estáticos estourava o limite com poucas páginas abertas
app.use('/api', globalLimiter);
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Modo manutenção ───────────────────────────────────────────
// Bloqueia a API para todo mundo, exceto login e o próprio painel admin
// (assim um admin sempre consegue entrar e desligar a manutenção).
// req.path aqui já vem SEM o prefixo /api (Express remove o trecho do mount)
const MAINTENANCE_ALLOWLIST = ['/health', '/auth/login'];
app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/admin') || MAINTENANCE_ALLOWLIST.includes(req.path))
    return next();
  try {
    if (await getSetting('maintenance_mode'))
      return res.status(503).json({ error: 'Site em manutenção. Volte em instantes.' });
  } catch (_) { /* se falhar a checagem, não derruba o site */ }
  next();
});

// ── Rotas da API ─────────────────────────────────────────────
app.use('/api/users',  usersRouter);
app.use('/api/levels', levelsRouter);
app.use('/api/auth',   authRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/files',  filesRouter);
app.use('/api/admin',  adminRouter);

// ── Health-check ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '6' }));

// ── 404 para rotas /api/* desconhecidas ───────────────────────
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ── Catch-all para SPA: serve 404.html para rotas desconhecidas
app.get('*', (_req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../frontend', '404.html'));
});

// ── Erros não tratados (JSON inválido, multer, rejeições async) ──
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : 500);
  if (status >= 500) console.error('[unhandled]', err);
  const msg = err.name === 'MulterError'
    ? (err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede 10 MB' : 'Erro no upload')
    : status >= 500 ? 'Erro interno do servidor' : 'Requisição inválida';
  res.status(status).json({ error: msg });
});

// ── Inicia servidor ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎮  Pellizzola Brothers v6 em http://localhost:${PORT}`);
  console.log(`🔒  JWT auth ativado | ⚡ Rate limiting ativo | 🔐 bcrypt`);
  if (!process.env.JWT_SECRET)
    console.warn('⚠️   JWT_SECRET não definido no .env — configure antes de subir em produção!\n');
});
