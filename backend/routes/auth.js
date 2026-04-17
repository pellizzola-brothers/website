// ============================================================
//  routes/auth.js — Cadastro, Login, Recuperação de Senha
// ============================================================
const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const { getPool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const SALT_ROUNDS = 10;

// Rate limit: máximo 10 tentativas de login por IP a cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit: máximo 5 pedidos de recuperação por IP a cada hora
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de recuperação. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── POST /api/auth/register ─────────────────────────────────
router.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const { bio, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  if (username.length > 100)
    return res.status(400).json({ error: 'username deve ter no máximo 100 caracteres' });
  if (req.body.bio && req.body.bio.length > 500)
    return res.status(400).json({ error: 'bio deve ter no máximo 500 caracteres' });
  if (/\s/.test(username))
    return res.status(400).json({ error: 'Nome de usuário não pode conter espaços' });
  if (password.length <= 7)
    return res.status(400).json({ error: 'Senha deve ter mais de 7 caracteres' });
  if (!/[A-Z]/.test(password))
    return res.status(400).json({ error: 'Senha deve conter pelo menos uma letra maiúscula' });
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
    return res.status(400).json({ error: 'Senha deve conter pelo menos um caractere especial' });
  if (password.toLowerCase().includes(username))
    return res.status(400).json({ error: 'Senha não pode conter o nome de usuário' });

  try {
    const pool = await getPool();
    const dup = await pool.query(`SELECT id FROM users WHERE username = $1`, [username]);
    if (dup.rows.length > 0)
      return res.status(409).json({ error: 'Nome de usuário já existe' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, bio, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, bio`,
      [username, bio || null, passwordHash]
    );

    const user  = result.rows[0];
    const token = generateToken(user);
    // Fix #4: cadastro também retorna token para login automático
    res.status(201).json({ ok: true, user, token });
  } catch (err) {
    console.error('[POST /auth/register]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/login — rate limited ─────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const { password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT id, username, bio, password_hash FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Usuário não encontrado' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Senha incorreta' });

    const { password_hash, ...safeUser } = user;
    const token = generateToken(safeUser);
    res.json({ ok: true, user: safeUser, token });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/request — rate limited ─────────
// Gera um código de 6 dígitos e salva no banco (sem e-mail — o usuário
// copia o código da resposta ou de um canal seguro configurado pelo admin)
router.post('/recovery/request', recoveryLimiter, async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  if (!username)
    return res.status(400).json({ error: 'username é obrigatório' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT id FROM users WHERE username = $1`, [username]
    );
    // Sempre retorna 200 para não vazar quais usuários existem
    if (result.rows.length === 0)
      return res.json({ ok: true, message: 'Se o usuário existir, o código foi gerado.' });

    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 dígitos
    const hash = await bcrypt.hash(code, SALT_ROUNDS);

    await pool.query(
      `UPDATE users
       SET recovery_code = $1, recovery_expires = NOW() + INTERVAL '15 minutes'
       WHERE id = $2`,
      [hash, result.rows[0].id]
    );

    // Em produção, enviar por e-mail. Por ora retorna o código diretamente
    // para facilitar o desenvolvimento sem servidor de e-mail configurado.
    res.json({ ok: true, code, message: 'Código válido por 15 minutos.' });
  } catch (err) {
    console.error('[POST /auth/recovery/request]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/verify ─────────────────────────
// Valida o código e retorna um token JWT para o usuário redefinir a senha
router.post('/recovery/verify', recoveryLimiter, async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const { code }  = req.body;
  if (!username || !code)
    return res.status(400).json({ error: 'username e code são obrigatórios' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT id, username, bio, recovery_code, recovery_expires
       FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Código inválido ou expirado' });

    const user = result.rows[0];

    if (!user.recovery_code || !user.recovery_expires)
      return res.status(401).json({ error: 'Nenhum código de recuperação ativo' });

    if (new Date() > new Date(user.recovery_expires))
      return res.status(401).json({ error: 'Código expirado. Solicite um novo.' });

    const match = await bcrypt.compare(code, user.recovery_code);
    if (!match)
      return res.status(401).json({ error: 'Código inválido ou expirado' });

    // Invalida o código após uso
    await pool.query(
      `UPDATE users SET recovery_code = NULL, recovery_expires = NULL WHERE id = $1`,
      [user.id]
    );

    const { recovery_code, recovery_expires, ...safeUser } = user;
    const token = generateToken(safeUser);
    res.json({ ok: true, user: safeUser, token });
  } catch (err) {
    console.error('[POST /auth/recovery/verify]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/reset — PROTEGIDO ──────────────
// Redefine a senha usando o token obtido em /verify
const { authMiddleware } = require('../middleware/auth');
router.post('/recovery/reset', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const userId = req.user.id;

  if (!password)
    return res.status(400).json({ error: 'password é obrigatório' });
  if (password.length <= 7)
    return res.status(400).json({ error: 'Senha deve ter mais de 7 caracteres' });
  if (!/[A-Z]/.test(password))
    return res.status(400).json({ error: 'Senha deve conter pelo menos uma letra maiúscula' });
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
    return res.status(400).json({ error: 'Senha deve conter pelo menos um caractere especial' });

  try {
    const pool = await getPool();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
    res.json({ ok: true, message: 'Senha redefinida com sucesso.' });
  } catch (err) {
    console.error('[POST /auth/recovery/reset]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
