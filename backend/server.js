// server.js — Entrada principal do backend Pellizzola Brothers
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const usersRouter  = require('./routes/users');
const levelsRouter = require('./routes/levels');
const authRouter   = require('./routes/auth');
const uploadRouter = require('./routes/upload');
const filesRouter  = require('./routes/files');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Rotas da API ────────────────────────────────────────────
app.use('/api/users',  usersRouter);
app.use('/api/levels', levelsRouter);
app.use('/api/auth',   authRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/files',  filesRouter);

// ── Health-check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Catch-all ───────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ── Inicia servidor ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎮  Pellizzola Brothers backend rodando em http://localhost:${PORT}`);
  console.log(`📋  Rotas disponíveis:`);
  console.log(`    GET  /api/health`);
  console.log(`    GET  /api/levels                  — lista todos os níveis`);
  console.log(`    GET  /api/levels/featured         — nível em destaque`);
  console.log(`    GET  /api/levels/:id              — nível + semelhantes`);
  console.log(`    POST /api/levels/:id/download     — incrementa downloads`);
  console.log(`    POST /api/levels/:id/like         — curtir (1x por usuário, body: {user_id})`);
  console.log(`    GET  /api/levels/:id/liked        — verifica se curtiu (?user_id=X)`);
  console.log(`    GET  /api/users                   — lista usuários`);
  console.log(`    GET  /api/users/:id               — perfil + níveis criados`);
  console.log(`    POST /api/auth/register`);
  console.log(`    POST /api/auth/login`);
  console.log(`    POST /api/upload/level            — upload de nível (multipart)`);
  console.log(`    GET  /api/upload/level/:filename  — download do arquivo`);
  console.log(`    GET  /api/files/:id               — metadados do arquivo\n`);
});
