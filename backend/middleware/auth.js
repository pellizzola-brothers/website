// middleware/auth.js — Verifica JWT em rotas protegidas
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET não definido no .env — defina antes de subir em produção.');
  // Em dev, usa fallback mas avisa. Em prod, force o crash:
  // process.exit(1);
}
const SECRET = JWT_SECRET || 'pellizzola_dev_only_nao_use_em_producao';

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação ausente' });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try { req.user = jwt.verify(authHeader.slice(7), SECRET); } catch (_) {}
  }
  next();
}

module.exports = { authMiddleware, optionalAuth, JWT_SECRET: SECRET };
