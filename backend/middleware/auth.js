const jwt = require('jsonwebtoken');
const { getPool } = require('../db');

async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token)
    return res.status(401).json({ error: 'Token de autenticação ausente' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  // Checa banimento a cada requisição autenticada — um ban feito pelo
  // admin tem efeito imediato, sem esperar o token de 7 dias expirar.
  try {
    const pool   = await getPool();
    const result = await pool.query(`SELECT banned FROM users WHERE id = $1`, [payload.id]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Usuário não encontrado' });
    if (result.rows[0].banned)
      return res.status(403).json({ error: 'Sua conta está banida' });

    req.user = payload;
    next();
  } catch (err) {
    console.error('[authMiddleware]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Como authMiddleware, mas visitante sem token segue em frente (req.user indefinido).
// Token presente porém inválido continua sendo rejeitado.
function optionalAuth(req, res, next) {
  if (!req.headers['authorization']) return next();
  return authMiddleware(req, res, next);
}

module.exports = { authMiddleware, optionalAuth };
