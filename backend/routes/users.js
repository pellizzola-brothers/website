// routes/users.js
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');

// ── GET /api/users/:id ──────────────────────────────────────
// Retorna dados do usuário + seus níveis criados
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();

    // Dados do usuário
    const userResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT id, username, bio, downloaded_levels, liked_levels
        FROM dbo.users
        WHERE id = @id
      `);

    if (userResult.recordset.length === 0)
      return res.status(404).json({ error: 'Usuário não encontrado' });

    const user = userResult.recordset[0];

    // Níveis criados pelo usuário
    const levelsResult = await pool.request()
      .input('author', sql.Int, id)
      .query(`
        SELECT id, name, description, downloads, likes
        FROM dbo.levels
        WHERE author = @author
        ORDER BY downloads DESC, likes DESC
      `);

    user.levels = levelsResult.recordset;
    res.json(user);

  } catch (err) {
    console.error('[GET /users/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/users ──────────────────────────────────────────
// Lista todos os usuários (resumo)
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.username, u.bio,
             u.downloaded_levels, u.liked_levels,
             COUNT(l.id) AS total_levels
      FROM dbo.users u
      LEFT JOIN dbo.levels l ON l.author = u.id
      GROUP BY u.id, u.username, u.bio, u.downloaded_levels, u.liked_levels
      ORDER BY total_levels DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('[GET /users]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/users ─────────────────────────────────────────
// Cria novo usuário (cadastro)
router.post('/', async (req, res) => {
  const { username, bio, password_hash } = req.body;
  if (!username) return res.status(400).json({ error: 'username obrigatório' });

  try {
    const pool = await getPool();

    // Verifica duplicata
    const dup = await pool.request()
      .input('username', sql.VarChar(100), username)
      .query(`SELECT id FROM dbo.users WHERE username = @username`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: 'Nome de usuário já existe' });

    const result = await pool.request()
      .input('username', sql.VarChar(100), username)
      .input('bio',      sql.VarChar(500), bio || null)
      .query(`
        INSERT INTO dbo.users (username, bio)
        OUTPUT INSERTED.id, INSERTED.username, INSERTED.bio
        VALUES (@username, @bio)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error('[POST /users]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
