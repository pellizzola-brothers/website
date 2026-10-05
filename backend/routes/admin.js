// routes/admin.js — painel administrativo (tudo aqui exige role='admin')
const express = require('express');
const router  = express.Router();
const { getPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { requireAdmin }   = require('../middleware/admin');
const { getSettings }    = require('../lib/settings');
const { deactivateLevel } = require('../lib/levels');
const bl = require('../lib/blacklist');

router.use(authMiddleware, requireAdmin);

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// `text` é renderizado como HTML no painel — sempre passe nomes vindos de usuário por esc()
async function log(pool, req, icon, text) {
  await pool.query(
    `INSERT INTO admin_logs (admin_id, admin_name, icon, text) VALUES ($1, $2, $3, $4)`,
    [req.user.id, req.user.username, icon, text]
  ).catch(err => console.error('[admin_logs]', err));
}

// ── GET /api/admin/stats ─────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const pool = await getPool();
    const [users, levels, reports, files] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM users`),
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(downloads),0)::int AS downloads, COALESCE(SUM(likes),0)::int AS likes FROM levels WHERE active`),
      pool.query(`SELECT COUNT(*)::int AS n FROM reports WHERE status = 'open'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM levels WHERE file_id IS NOT NULL AND active`),
    ]);
    res.json({
      users:          users.rows[0].n,
      levels:         levels.rows[0].n,
      downloads:      levels.rows[0].downloads,
      likes:          levels.rows[0].likes,
      open_reports:   reports.rows[0].n,
      levels_w_file:  files.rows[0].n,
    });
  } catch (err) {
    console.error('[GET /admin/stats]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/admin/charts — downloads e curtidas dos últimos 7 dias ──
router.get('/charts', async (req, res) => {
  try {
    const pool = await getPool();
    const [dl, lk] = await Promise.all([
      pool.query(`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COUNT(dh.id)::int AS n
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS d(day)
        LEFT JOIN download_history dh ON dh.created_at::date = d.day
        GROUP BY d.day ORDER BY d.day
      `),
      pool.query(`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COUNT(lh.id)::int AS n
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS d(day)
        LEFT JOIN like_history lh ON lh.created_at::date = d.day
        GROUP BY d.day ORDER BY d.day
      `),
    ]);
    res.json({ downloads: dl.rows, likes: lk.rows });
  } catch (err) {
    console.error('[GET /admin/charts]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/admin/activity — atividade recente real ─────────
router.get('/activity', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.query(`
      (SELECT 'level' AS kind, l.created_at AS at, u.username AS who, l.name AS extra
       FROM levels l INNER JOIN users u ON u.id = l.author
       ORDER BY l.created_at DESC LIMIT 5)
      UNION ALL
      (SELECT 'comment' AS kind, c.created_at AS at, u.username AS who, lv.name AS extra
       FROM comments c
       INNER JOIN users u ON u.id = c.user_id
       INNER JOIN levels lv ON lv.id = c.level_id
       ORDER BY c.created_at DESC LIMIT 5)
      UNION ALL
      (SELECT 'report' AS kind, r.created_at AS at, u.username AS who, lv.name AS extra
       FROM reports r
       INNER JOIN users u ON u.id = r.user_id
       INNER JOIN levels lv ON lv.id = r.level_id
       ORDER BY r.created_at DESC LIMIT 5)
      ORDER BY at DESC LIMIT 8
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /admin/activity]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.query(`
      SELECT u.id, u.username, u.bio, u.role, u.banned, host(u.last_ip) AS last_ip,
             u.downloaded_levels, u.liked_levels,
             COUNT(l.id)::int AS total_levels
      FROM users u
      LEFT JOIN levels l ON l.author = u.id AND l.active
      GROUP BY u.id
      ORDER BY u.id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /admin/users]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/admin/users/:id/ban ─────────────────────────────
router.post('/users/:id/ban', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode banir a si mesmo' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE users SET banned = true WHERE id = $1 RETURNING username`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    await log(pool, req, '🚫', `Usuário <strong>${esc(result.rows[0].username)}</strong> foi banido.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /admin/users/:id/ban]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/admin/users/:id/unban ───────────────────────────
router.post('/users/:id/unban', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE users SET banned = false WHERE id = $1 RETURNING username`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    await log(pool, req, '✅', `Usuário <strong>${esc(result.rows[0].username)}</strong> teve o banimento removido.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /admin/users/:id/unban]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/admin/users/:id/promote ─────────────────────────
router.post('/users/:id/promote', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE users SET role = 'admin' WHERE id = $1 RETURNING username`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    await log(pool, req, '⭐', `Usuário <strong>${esc(result.rows[0].username)}</strong> promovido a Admin.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /admin/users/:id/promote]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/admin/users/:id/demote ──────────────────────────
router.post('/users/:id/demote', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode revogar seu próprio acesso de admin' });

  try {
    const pool = await getPool();

    const adminCount = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`);
    if (adminCount.rows[0].n <= 1)
      return res.status(400).json({ error: 'Não é possível remover o último administrador' });

    const result = await pool.query(
      `UPDATE users SET role = 'user' WHERE id = $1 RETURNING username`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    await log(pool, req, '👤', `Privilégios de admin de <strong>${esc(result.rows[0].username)}</strong> revogados.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /admin/users/:id/demote]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/admin/levels ─────────────────────────────────────
router.get('/levels', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.query(`
      SELECT l.id, l.name, l.downloads, l.likes, l.file_id, l.active,
             u.username AS author_name
      FROM levels l
      INNER JOIN users u ON u.id = l.author
      ORDER BY l.id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /admin/levels]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── DELETE /api/admin/levels/:id — admin desativa qualquer fase (soft delete) ──
router.delete('/levels/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    const level = await deactivateLevel(pool, id);
    if (!level) return res.status(404).json({ error: 'Fase não encontrada ou já desativada' });
    await log(pool, req, '🗑', `Fase <strong>${esc(level.name)}</strong> desativada pelo admin.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /admin/levels/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/admin/reports?status=open|closed ─────────────────
router.get('/reports', async (req, res) => {
  const status = req.query.status === 'closed' ? 'closed' : 'open';
  try {
    const pool = await getPool();
    const result = await pool.query(`
      SELECT r.id, r.level_id, r.reason, r.detail, r.status, r.created_at,
             lv.name AS level_name, u.username AS reporter
      FROM reports r
      INNER JOIN levels lv ON lv.id = r.level_id
      INNER JOIN users u   ON u.id = r.user_id
      WHERE r.status = $1
      ORDER BY r.created_at DESC
    `, [status]);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /admin/reports]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/admin/reports/:id/resolve ────────────────────────
router.post('/reports/:id/resolve', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE reports SET status = 'closed' WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Denúncia não encontrada' });
    await log(pool, req, '✅', `Denúncia #${id} marcada como resolvida.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /admin/reports/:id/resolve]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── DELETE /api/admin/reports/:id/level — deleta a fase denunciada ──
router.delete('/reports/:id/level', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    const report = await pool.query(
      `SELECT r.level_id, lv.name FROM reports r INNER JOIN levels lv ON lv.id = r.level_id WHERE r.id = $1`,
      [id]
    );
    if (report.rows.length === 0) return res.status(404).json({ error: 'Denúncia não encontrada' });

    const { level_id, name } = report.rows[0];
    await deactivateLevel(pool, level_id);
    await pool.query(`UPDATE reports SET status = 'closed' WHERE id = $1`, [id]);

    await log(pool, req, '🗑', `Fase <strong>${esc(name)}</strong> desativada via denúncia #${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /admin/reports/:id/level]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/admin/logs ─────────────────────────────────────────
router.get('/logs', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT id, icon, text, admin_name, created_at
       FROM admin_logs ORDER BY created_at DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /admin/logs]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── DELETE /api/admin/logs — limpa todos os logs ────────────────
router.delete('/logs', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.query(`DELETE FROM admin_logs`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /admin/logs]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/admin/settings ─────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    console.error('[GET /admin/settings]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── PUT /api/admin/settings — { key: value, ... } ───────────────
const VALID_KEYS = ['maintenance_mode', 'allow_registration', 'allow_upload'];
router.put('/settings', async (req, res) => {
  const updates = Object.entries(req.body || {}).filter(([k]) => VALID_KEYS.includes(k));
  if (updates.length === 0)
    return res.status(400).json({ error: 'Nenhuma configuração válida enviada' });

  try {
    const pool = await getPool();
    for (const [key, value] of updates) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, !!value]
      );
    }
    await log(pool, req, '⚙️', `Configurações atualizadas: ${updates.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    res.json(await getSettings());
  } catch (err) {
    console.error('[PUT /admin/settings]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});


// ── Blacklist de IPs ──────────────────────────────────────────
router.get('/blacklist', async (req, res) => {
  const pool = await getPool();
  await pool.query(`DELETE FROM blacklist WHERE expires_at <= NOW()`);
  const r = await pool.query(`SELECT CASE WHEN masklen(ip) = max_masklen(ip) THEN host(ip) ELSE network(ip)::text END AS ip, expires_at FROM blacklist ORDER BY expires_at NULLS FIRST, ip`);
  res.json(r.rows);
});

router.post('/blacklist', async (req, res) => {
  const ip = bl.parseTarget(req.body.ip), { minutes } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP ou faixa CIDR inválido (ex: 203.0.113.7 ou 192.0.0.0/8)' });
  const expires = bl.expiryFrom(minutes);
  if (expires === undefined) return res.status(400).json({ error: 'Duração inválida' });
  await bl.addIp(ip, expires);
  const pool = await getPool();
  await log(pool, req, '⛔', `IP <strong>${esc(ip)}</strong> foi adicionado à blacklist (${expires ? 'até ' + expires.toISOString() : 'permanente'}).`);
  res.status(201).json({ ok: true });
});

router.delete('/blacklist/:ip', async (req, res) => {
  const ip = bl.parseTarget(req.params.ip);
  if (!ip) return res.status(400).json({ error: 'IP inválido' });
  const pool = await getPool();
  const r = await pool.query(`DELETE FROM blacklist WHERE ip = network($1::inet)::inet`, [ip]);
  if (!r.rowCount) return res.status(404).json({ error: 'IP não está na blacklist' });
  await bl.reload();
  await log(pool, req, '✅', `IP <strong>${esc(ip)}</strong> foi removido da blacklist.`);
  res.json({ ok: true });
});

// IP-ban: bloqueia o último IP conhecido do usuário (login/cadastro); não bane a conta.
router.post('/users/:id/ip-ban', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const expires = bl.expiryFrom(req.body.minutes);
  if (expires === undefined) return res.status(400).json({ error: 'Duração inválida' });
  const pool = await getPool();
  const r = await pool.query(`SELECT username, host(last_ip) AS ip FROM users WHERE id = $1`, [id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (!r.rows[0].ip) return res.status(400).json({ error: 'Nenhum IP conhecido para este usuário (ele ainda não fez login)' });
  await bl.addIp(r.rows[0].ip, expires);
  await log(pool, req, '⛔', `IP <strong>${esc(r.rows[0].ip)}</strong> de <strong>${esc(r.rows[0].username)}</strong> foi banido (${expires ? 'até ' + expires.toISOString() : 'permanente'}).`);
  res.json({ ok: true, ip: r.rows[0].ip });
});

module.exports = router;
