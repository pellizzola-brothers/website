const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const { getPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRES   = '7d';

function makeToken(user, expiresIn) {
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: expiresIn || JWT_EXPIRES }
  );
}

// ── POST /api/auth/register ──────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, bio, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  if (/\s/.test(username))
    return res.status(400).json({ error: 'Nome de usuário não pode conter espaços' });
  if (username.length < 3)
    return res.status(400).json({ error: 'Nome de usuário muito curto (mínimo 3 caracteres)' });
  if (password.length <= 7)
    return res.status(400).json({ error: 'A senha deve ter mais de 7 caracteres' });
  if (!/[A-Z]/.test(password))
    return res.status(400).json({ error: 'A senha deve ter pelo menos uma letra maiúscula' });
  if (!/[!@#$%^&*()+\-=[\]{};:'",.<>/?|]/.test(password))
    return res.status(400).json({ error: 'A senha deve ter pelo menos um caractere especial' });

  try {
    const pool = await getPool();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, bio, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, bio`,
      [username.toLowerCase(), bio ? bio.trim() : null, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: makeToken(user) });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Nome de usuário já está em uso' });
    console.error('[POST /auth/register]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });

  try {
    const pool   = await getPool();
    const result = await pool.query(
      `SELECT id, username, password_hash FROM users WHERE username = $1`,
      [username.toLowerCase()]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    const user = result.rows[0];
    const ok   = await bcrypt.compare(password, user.password_hash || '');
    if (!ok)
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    res.json({ user: { id: user.id, username: user.username }, token: makeToken(user) });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/request ─────────────────────────
router.post('/recovery/request', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  if (!username)
    return res.status(400).json({ error: 'Informe o nome de usuário' });

  try {
    const pool   = await getPool();
    const result = await pool.query(
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0)
      return res.json({ ok: true, message: 'Se o usuário existir, o código foi gerado.' });

    const code    = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    const hashed  = await bcrypt.hash(code, 10);

    await pool.query(
      `UPDATE users SET recovery_code = $1, recovery_expires = $2 WHERE id = $3`,
      [hashed, expires, result.rows[0].id]
    );

    const response = { ok: true, message: 'Se o usuário existir, o código foi gerado.' };
    if (process.env.NODE_ENV !== 'production') response.code = code;
    res.json(response);
  } catch (err) {
    console.error('[POST /auth/recovery/request]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/verify ──────────────────────────
router.post('/recovery/verify', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const code     = (req.body.code || '').trim();
  if (!username || !code)
    return res.status(400).json({ error: 'Usuário e código são obrigatórios' });

  try {
    const pool   = await getPool();
    const result = await pool.query(
      `SELECT id, username, recovery_code, recovery_expires FROM users WHERE username = $1`,
      [username]
    );

    const invalid = () => res.status(400).json({ error: 'Código inválido ou expirado' });

    if (result.rows.length === 0) return invalid();
    const user = result.rows[0];
    if (!user.recovery_code || !user.recovery_expires) return invalid();
    if (new Date() > new Date(user.recovery_expires)) return invalid();

    const valid = await bcrypt.compare(code, user.recovery_code);
    if (!valid) return invalid();

    await pool.query(
      `UPDATE users SET recovery_code = NULL, recovery_expires = NULL WHERE id = $1`,
      [user.id]
    );
    res.json({ token: makeToken({ id: user.id, username: user.username }, '15m') });
  } catch (err) {
    console.error('[POST /auth/recovery/verify]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/reset ───────────────────────────
router.post('/recovery/reset', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const userId = req.user.id;

  if (!password || password.length <= 7)
    return res.status(400).json({ error: 'A senha deve ter mais de 7 caracteres' });
  if (!/[A-Z]/.test(password))
    return res.status(400).json({ error: 'A senha deve ter pelo menos uma letra maiúscula' });
  if (!/[!@#$%^&*()+\-=[\]{};:'",.<>/?|]/.test(password))
    return res.status(400).json({ error: 'A senha deve ter pelo menos um caractere especial' });

  try {
    const pool = await getPool();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /auth/recovery/reset]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
