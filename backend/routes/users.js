// routes/users.js — CRUD de usuários
const express = require('express');
const router  = express.Router();
const { getPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ── GET /api/users/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();

    const [userResult, levelsResult] = await Promise.all([
      pool.query(
        `SELECT id, username, bio, downloaded_levels, liked_levels
         FROM users WHERE id = $1`,
        [id]
      ),
      pool.query(
        `SELECT id, name, description, downloads, likes
         FROM levels WHERE author = $1
         ORDER BY downloads DESC, likes DESC`,
        [id]
      ),
    ]);

    if (userResult.rows.length === 0)
      return res.status(404).json({ error: 'Usuário não encontrado' });

    const user = userResult.rows[0];
    user.levels = levelsResult.rows;

    res.json(user);
  } catch (err) {
    console.error('[GET /users/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/users ──────────────────────────────────────────
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

// ── POST /api/users — DESABILITADO ──────────────────────────
// Rota legada sem autenticação. Cadastro real usa /api/auth/register.
router.post('/', (req, res) => {
  res.status(410).json({
    error: 'Esta rota foi desativada. Use POST /api/auth/register para criar uma conta.'
  });
});

// ── PUT /api/users/:id — PROTEGIDO ─────────────────────────
// Usuário só pode editar o próprio perfil
router.put('/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (req.user.id !== id) return res.status(403).json({ error: 'Sem permissão' });

  const bio = (req.body.bio ?? '').trim();

  // Validação de tamanho
  if (bio.length > 500)
    return res.status(400).json({ error: 'bio deve ter no máximo 500 caracteres' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE users SET bio = $1 WHERE id = $2 RETURNING id, username, bio`,
      [bio || null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /users/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/users/:id/download-history — PROTEGIDO ────────
// Retorna os últimos 100 levels baixados pelo usuário (somente o próprio)
router.get('/:id/download-history', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (req.user.id !== id) return res.status(403).json({ error: 'Sem permissão' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT dh.level_id AS id, dh.created_at AS at,
              l.name, l.description, l.downloads, l.likes
       FROM download_history dh
       INNER JOIN levels l ON l.id = dh.level_id
       WHERE dh.user_id = $1
       ORDER BY dh.created_at DESC
       LIMIT 100`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /users/:id/download-history]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
