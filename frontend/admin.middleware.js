// middleware/admin.js — exige que o usuário autenticado seja admin.
// Sempre consulta o banco (não confia em nada guardado no JWT), para que
// uma promoção/revogação/ban tenha efeito imediato, sem esperar o token expirar.
const { getPool } = require('../db');

async function requireAdmin(req, res, next) {
  if (!req.user || !req.user.id)
    return res.status(401).json({ error: 'Token de autenticação ausente' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT role, banned FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Usuário não encontrado' });

    const { role, banned } = result.rows[0];

    if (banned)
      return res.status(403).json({ error: 'Sua conta está banida' });

    if (role !== 'admin')
      return res.status(403).json({ error: 'Acesso restrito a administradores' });

    next();
  } catch (err) {
    console.error('[requireAdmin]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

module.exports = { requireAdmin };
