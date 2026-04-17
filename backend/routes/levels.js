// routes/levels.js
const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const { getPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// Rate limiter: máximo 20 downloads por IP a cada 15 minutos
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Muitas requisições de download. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── GET /api/levels/featured ────────────────────────────────
router.get('/featured', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.query(`
      SELECT l.id, l.name, l.description, l.downloads, l.likes,
             l.file_id,
             u.id AS author_id, u.username AS author_name
      FROM levels l
      INNER JOIN users u ON u.id = l.author
      ORDER BY l.downloads DESC, l.likes DESC
      LIMIT 1
    `);
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Nenhum level cadastrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /levels/featured]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/levels ─────────────────────────────────────────
// liked_by NÃO é retornado — dado de comportamento privado
router.get('/', async (req, res) => {
  const search = req.query.q || '';
  const author = req.query.author_id ? parseInt(req.query.author_id) : null;

  try {
    const pool = await getPool();
    let query, params;

    if (author) {
      query = `SELECT l.id, l.name, l.description, l.downloads, l.likes,
                      l.file_id,
                      u.id AS author_id, u.username AS author_name
               FROM levels l
               INNER JOIN users u ON u.id = l.author
               WHERE l.author = $1
               ORDER BY l.downloads DESC, l.likes DESC`;
      params = [author];
    } else {
      query = `SELECT l.id, l.name, l.description, l.downloads, l.likes,
                      l.file_id,
                      u.id AS author_id, u.username AS author_name
               FROM levels l
               INNER JOIN users u ON u.id = l.author
               WHERE l.name ILIKE $1 OR l.description ILIKE $1
               ORDER BY l.downloads DESC, l.likes DESC`;
      params = [`%${search}%`];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /levels]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/levels/:id ─────────────────────────────────────
// comments e similares buscados em paralelo com Promise.all
// liked_by NÃO é retornado
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    const levelResult = await pool.query(
      `SELECT l.id, l.name, l.description, l.downloads, l.likes,
              l.file_id,
              u.id AS author_id, u.username AS author_name, u.bio AS author_bio
       FROM levels l
       INNER JOIN users u ON u.id = l.author
       WHERE l.id = $1`,
      [id]
    );

    if (levelResult.rows.length === 0)
      return res.status(404).json({ error: 'Level não encontrado' });

    const level = levelResult.rows[0];

    // comments e similares em paralelo — era 3 round-trips em série
    const [commentsResult, similarResult] = await Promise.all([
      pool.query(
        `SELECT c.id, c.content, c.created_at,
                u.id AS user_id, u.username
         FROM comments c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.level_id = $1
         ORDER BY c.created_at DESC
         LIMIT 50`,
        [id]
      ).catch(() => ({ rows: [] })),

      pool.query(
        `SELECT l.id, l.name, l.description, l.downloads, l.likes,
                l.file_id, u.username AS author_name
         FROM levels l
         INNER JOIN users u ON u.id = l.author
         WHERE l.id <> $1
         ORDER BY CASE WHEN l.author = $2 THEN 0 ELSE 1 END, l.downloads DESC
         LIMIT 3`,
        [id, level.author_id]
      ),
    ]);

    level.similar  = similarResult.rows;
    level.comments = commentsResult.rows;
    res.json(level);
  } catch (err) {
    console.error('[GET /levels/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels — PROTEGIDO ────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { name, description, file_id } = req.body;
  const author = req.user.id;

  if (!name || !file_id)
    return res.status(400).json({ error: 'name e file_id são obrigatórios' });

  // Validação de tamanho
  if (name.length > 200)
    return res.status(400).json({ error: 'name deve ter no máximo 200 caracteres' });
  if (description && description.length > 1000)
    return res.status(400).json({ error: 'description deve ter no máximo 1000 caracteres' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `INSERT INTO levels (name, description, author, file_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, downloads, likes, file_id`,
      [name, description || null, author, file_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST /levels]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels/:id/download — rate limited ───────────
router.post('/:id/download', downloadLimiter, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  // user_id é opcional — enviado pelo frontend quando logado
  const userId = req.body.user_id ? parseInt(req.body.user_id) : null;

  try {
    const pool = await getPool();

    // Incrementa contador do level
    await pool.query(`UPDATE levels SET downloads = downloads + 1 WHERE id = $1`, [id]);

    if (userId && !isNaN(userId)) {
      // Incrementa downloaded_levels do usuário (ignora se já baixou antes via UNIQUE)
      const inserted = await pool.query(
        `INSERT INTO download_history (user_id, level_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, level_id) DO NOTHING
         RETURNING id`,
        [userId, id]
      );
      // Só incrementa o contador se foi o primeiro download deste level pelo user
      if (inserted.rowCount > 0) {
        await pool.query(
          `UPDATE users SET downloaded_levels = downloaded_levels + 1 WHERE id = $1`,
          [userId]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /levels/:id/download]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/levels/:id/liked ───────────────────────────────
router.get('/:id/liked', authMiddleware, async (req, res) => {
  const id     = parseInt(req.params.id);
  const userId = req.user.id;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    // Usa array do PostgreSQL para checar de forma atômica
    const result = await pool.query(
      `SELECT (liked_by_ids @> ARRAY[$1]::int[]) AS liked
       FROM levels WHERE id = $2`,
      [userId, id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Level não encontrado' });

    res.json({ liked: result.rows[0].liked });
  } catch (err) {
    console.error('[GET /levels/:id/liked]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels/:id/like — PROTEGIDO ──────────────────
// UPDATE atômico com array PostgreSQL — sem race condition
router.post('/:id/like', authMiddleware, async (req, res) => {
  const id     = parseInt(req.params.id);
  const userId = req.user.id;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();

    // Checa se já curtiu E atualiza atomicamente numa única query
    const result = await pool.query(
      `UPDATE levels
       SET likes        = likes + 1,
           liked_by_ids = array_append(liked_by_ids, $1)
       WHERE id = $2
         AND NOT (liked_by_ids @> ARRAY[$1]::int[])
       RETURNING likes`,
      [userId, id]
    );

    if (result.rowCount === 0) {
      // Ou o level não existe, ou já curtiu — diferencia:
      const check = await pool.query(`SELECT id FROM levels WHERE id = $1`, [id]);
      if (check.rows.length === 0)
        return res.status(404).json({ error: 'Level não encontrado' });
      return res.status(409).json({ error: 'Você já curtiu este level', already_liked: true });
    }

    // Incrementa liked_levels do usuário
    await pool.query(
      `UPDATE users SET liked_levels = liked_levels + 1 WHERE id = $1`,
      [userId]
    );

    res.json({ ok: true, likes: result.rows[0].likes });
  } catch (err) {
    console.error('[POST /levels/:id/like]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels/:id/unlike — PROTEGIDO ────────────────
// UPDATE atômico com array PostgreSQL — sem race condition
router.post('/:id/unlike', authMiddleware, async (req, res) => {
  const id     = parseInt(req.params.id);
  const userId = req.user.id;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();

    const result = await pool.query(
      `UPDATE levels
       SET likes        = GREATEST(0, likes - 1),
           liked_by_ids = array_remove(liked_by_ids, $1)
       WHERE id = $2
         AND (liked_by_ids @> ARRAY[$1]::int[])
       RETURNING likes`,
      [userId, id]
    );

    if (result.rowCount === 0) {
      const check = await pool.query(`SELECT id FROM levels WHERE id = $1`, [id]);
      if (check.rows.length === 0)
        return res.status(404).json({ error: 'Level não encontrado' });
      return res.status(409).json({ error: 'Você ainda não curtiu este level' });
    }

    // Decrementa liked_levels do usuário (mínimo 0)
    await pool.query(
      `UPDATE users SET liked_levels = GREATEST(0, liked_levels - 1) WHERE id = $1`,
      [userId]
    );

    res.json({ ok: true, likes: result.rows[0].likes });
  } catch (err) {
    console.error('[POST /levels/:id/unlike]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels/:id/comment — PROTEGIDO ───────────────
router.post('/:id/comment', authMiddleware, async (req, res) => {
  const levelId = parseInt(req.params.id);
  const userId  = req.user.id;
  const content = (req.body.content || '').trim();

  if (isNaN(levelId)) return res.status(400).json({ error: 'ID inválido' });
  if (!content || content.length > 500)
    return res.status(400).json({ error: 'Comentário deve ter entre 1 e 500 caracteres' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `INSERT INTO comments (level_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at`,
      [levelId, userId, content]
    );
    res.status(201).json({ ok: true, comment: { ...result.rows[0], username: req.user.username, user_id: userId } });
  } catch (err) {
    console.error('[POST /levels/:id/comment]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── DELETE /api/levels/:id/comment/:commentId — PROTEGIDO ──
router.delete('/:id/comment/:commentId', authMiddleware, async (req, res) => {
  const commentId = parseInt(req.params.commentId);
  const userId    = req.user.id;
  if (isNaN(commentId)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool  = await getPool();
    const check = await pool.query(`SELECT user_id FROM comments WHERE id = $1`, [commentId]);
    if (check.rows.length === 0)
      return res.status(404).json({ error: 'Comentário não encontrado' });
    if (check.rows[0].user_id !== userId)
      return res.status(403).json({ error: 'Sem permissão para deletar este comentário' });

    await pool.query(`DELETE FROM comments WHERE id = $1`, [commentId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /levels/:id/comment/:commentId]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── DELETE /api/levels/:id — PROTEGIDO ─────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  const id     = parseInt(req.params.id);
  const userId = req.user.id;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool  = await getPool();
    const check = await pool.query(`SELECT author FROM levels WHERE id = $1`, [id]);
    if (check.rows.length === 0)
      return res.status(404).json({ error: 'Level não encontrado' });
    if (check.rows[0].author !== userId)
      return res.status(403).json({ error: 'Você não tem permissão para deletar este level' });

    await pool.query(`DELETE FROM levels WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /levels/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/levels/:id/report — PROTEGIDO ────────────────
router.post('/:id/report', authMiddleware, async (req, res) => {
  const levelId = parseInt(req.params.id);
  const userId  = req.user.id;
  if (isNaN(levelId)) return res.status(400).json({ error: 'ID inválido' });

  const reason = (req.body.reason || '').trim();
  const detail = (req.body.detail || '').trim().slice(0, 300);

  if (!reason)
    return res.status(400).json({ error: 'Motivo da denúncia é obrigatório' });

  try {
    const pool = await getPool();

    // Checa se o level existe
    const check = await pool.query(`SELECT id FROM levels WHERE id = $1`, [levelId]);
    if (check.rows.length === 0)
      return res.status(404).json({ error: 'Level não encontrado' });

    // Insere — UNIQUE (user_id, level_id) evita denúncias duplicadas
    await pool.query(
      `INSERT INTO reports (level_id, user_id, reason, detail)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (level_id, user_id) DO NOTHING`,
      [levelId, userId, reason, detail || null]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /levels/:id/report]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
