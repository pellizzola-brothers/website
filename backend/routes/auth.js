// routes/auth.js — Login e cadastro com hash SHA-256
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { getPool, sql } = require('../db');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ── POST /api/auth/register ─────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, bio, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Senha muito curta (mínimo 4 caracteres)' });

  try {
    const pool = await getPool();

    // Verifica duplicata
    const dup = await pool.request()
      .input('username', sql.VarChar(100), username)
      .query(`SELECT id FROM dbo.users WHERE username = @username`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: 'Nome de usuário já existe' });

    const hash = sha256(password);

    const result = await pool.request()
      .input('username',      sql.VarChar(100), username)
      .input('bio',           sql.VarChar(500),  bio || null)
      .input('password_hash', sql.VarChar(64),   hash)
      .query(`
        INSERT INTO dbo.users (username, bio, password_hash)
        OUTPUT INSERTED.id, INSERTED.username, INSERTED.bio
        VALUES (@username, @bio, @password_hash)
      `);

    res.status(201).json({ ok: true, user: result.recordset[0] });
  } catch (err) {
    console.error('[POST /auth/register]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('username', sql.VarChar(100), username)
      .query(`
        SELECT id, username, bio, password_hash
        FROM dbo.users
        WHERE username = @username
      `);

    if (result.recordset.length === 0)
      return res.status(401).json({ error: 'Usuário não encontrado' });

    const user = result.recordset[0];
    const hash = sha256(password);

    if (hash !== user.password_hash)
      return res.status(401).json({ error: 'Senha incorreta' });

    // Retorna dados do usuário (sem hash)
    const { password_hash, ...safeUser } = user;
    res.json({ ok: true, user: safeUser });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
