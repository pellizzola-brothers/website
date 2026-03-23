// routes/users.js
const express = require('express');
const router  = express.Router();
const { getPool } = require('../db');

// ── GET /api/users/:id ──────────────────────────────────────
// Retorna dados do usuário + seus níveis criados
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();

    // Dados do usuário
    const userResult = await pool.query(
      `SELECT id, username, bio, downloaded_levels, liked_levels
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (userResult.rows.length === 0)
      return res.status(404).json({ error: 'Usuário não encontrado' });

    const user = userResult.rows[0];

    // Níveis criados pelo usuário
    const levelsResult = await pool.query(
      `SELECT id, name, description, downloads, likes
       FROM levels
       WHERE author = $1
       ORDER BY downloads DESC, likes DESC`,
      [id]
    );

    user.levels = levelsResult.rows;
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
    const result = await pool.query(`
      SELECT u.id, u.username, u.bio,
             u.downloaded_levels, u.liked_levels,
             COUNT(l.id) AS total_levels
      FROM users u
      LEFT JOIN levels l ON l.author = u.id
      GROUP BY u.id, u.username, u.bio, u.downloaded_levels, u.liked_levels
      ORDER BY total_levels DESC
    `);
    res.json(result.rows);
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
    const dup = await pool.query(
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );
    if (dup.rows.length > 0)
      return res.status(409).json({ error: 'Nome de usuário já existe' });

    const result = await pool.query(
      `INSERT INTO users (username, bio)
       VALUES ($1, $2)
       RETURNING id, username, bio`,
      [username, bio || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST /users]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
