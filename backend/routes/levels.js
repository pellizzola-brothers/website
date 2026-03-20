// routes/levels.js — liked_by como lista de IDs na própria tabela levels
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');

// Helpers para manipular a coluna liked_by ('1,3,7' <-> [1,3,7])
function parseLikedBy(str) {
  if (!str || str.trim() === '') return [];
  return str.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
}

function serializeLikedBy(arr) {
  return arr.join(',');
}

// ── GET /api/levels ─────────────────────────────────────────
router.get('/', async (req, res) => {
  const search = req.query.q || '';
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('search', sql.VarChar(200), `%${search}%`)
      .query(`
        SELECT l.id, l.name, l.description, l.downloads, l.likes,
               l.liked_by, l.file_id,
               u.id   AS author_id,
               u.username AS author_name
        FROM dbo.levels l
        INNER JOIN dbo.users u ON u.id = l.author
        WHERE l.name LIKE @search
           OR l.description LIKE @search
        ORDER BY l.downloads DESC, l.likes DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('[GET /levels]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/levels/featured ────────────────────────────────
router.get('/featured', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 1
             l.id, l.name, l.description, l.downloads, l.likes,
             l.liked_by, l.file_id,
             u.id AS author_id, u.username AS author_name
      FROM dbo.levels l
      INNER JOIN dbo.users u ON u.id = l.author
      ORDER BY l.downloads DESC, l.likes DESC
    `);
    if (result.recordset.length === 0)
      return res.status(404).json({ error: 'Nenhum nível cadastrado' });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('[GET /levels/featured]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/levels/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();

    const levelResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT l.id, l.name, l.description, l.downloads, l.likes,
               l.liked_by, l.file_id,
               u.id   AS author_id,
               u.username AS author_name,
               u.bio  AS author_bio
        FROM dbo.levels l
        INNER JOIN dbo.users u ON u.id = l.author
        WHERE l.id = @id
      `);

    if (levelResult.recordset.length === 0)
      return res.status(404).json({ error: 'Nível não encontrado' });

    const level = levelResult.recordset[0];

    const similarResult = await pool.request()
      .input('id',     sql.Int, id)
      .input('author', sql.Int, level.author_id)
      .query(`
        SELECT TOP 3
               l.id, l.name, l.description, l.downloads, l.likes,
               l.liked_by, l.file_id,
               u.username AS author_name
        FROM dbo.levels l
        INNER JOIN dbo.users u ON u.id = l.author
        WHERE l.id <> @id
        ORDER BY
          CASE WHEN l.author = @author THEN 0 ELSE 1 END,
          l.downloads DESC
      `);

    level.similar = similarResult.recordset;
    res.json(level);

  } catch (err) {
    console.error('[GET /levels/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels ────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, description, author, file_id } = req.body;
  if (!name || !author || !file_id)
    return res.status(400).json({ error: 'name, author e file_id são obrigatórios' });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('name',        sql.VarChar(200),  name)
      .input('description', sql.VarChar(1000), description || null)
      .input('author',      sql.Int,           author)
      .input('file_id',     sql.Int,           file_id)
      .query(`
        INSERT INTO dbo.levels (name, description, author, file_id)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.description,
               INSERTED.downloads, INSERTED.likes, INSERTED.liked_by, INSERTED.file_id
        VALUES (@name, @description, @author, @file_id)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error('[POST /levels]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels/:id/download ──────────────────────────
router.post('/:id/download', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .query(`UPDATE dbo.levels SET downloads = downloads + 1 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /levels/:id/download]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels/:id/like ───────────────────────────────
// Curtir — verifica liked_by, adiciona user_id se ainda não estiver
// Body: { user_id: number }
router.post('/:id/like', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const userId = parseInt(req.body.user_id);
  if (isNaN(userId))
    return res.status(400).json({ error: 'user_id é obrigatório para curtir' });

  try {
    const pool = await getPool();

    // Lê o liked_by atual
    const current = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT liked_by FROM dbo.levels WHERE id = @id`);

    if (current.recordset.length === 0)
      return res.status(404).json({ error: 'Nível não encontrado' });

    const likedBy = parseLikedBy(current.recordset[0].liked_by);

    // Verifica se o usuário já curtiu
    if (likedBy.includes(userId))
      return res.status(409).json({ error: 'Você já curtiu este nível', already_liked: true });

    // Adiciona o userId e salva
    likedBy.push(userId);
    const newLikedBy = serializeLikedBy(likedBy);

    await pool.request()
      .input('id',       sql.Int,         id)
      .input('liked_by', sql.VarChar(sql.MAX), newLikedBy)
      .query(`
        UPDATE dbo.levels
        SET likes    = likes + 1,
            liked_by = @liked_by
        WHERE id = @id
      `);

    res.json({ ok: true, liked_by: likedBy });
  } catch (err) {
    console.error('[POST /levels/:id/like]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/levels/:id/liked ───────────────────────────────
// Verifica se um usuário já curtiu — GET /api/levels/5/liked?user_id=3
router.get('/:id/liked', async (req, res) => {
  const id     = parseInt(req.params.id);
  const userId = parseInt(req.query.user_id);
  if (isNaN(id) || isNaN(userId))
    return res.status(400).json({ error: 'id e user_id são obrigatórios' });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT liked_by FROM dbo.levels WHERE id = @id`);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: 'Nível não encontrado' });

    const likedBy = parseLikedBy(result.recordset[0].liked_by);
    res.json({ liked: likedBy.includes(userId), liked_by: likedBy });
  } catch (err) {
    console.error('[GET /levels/:id/liked]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
