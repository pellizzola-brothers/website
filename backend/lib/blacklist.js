// lib/blacklist.js — bloqueio de IPs (tabela `blacklist`, expires_at NULL = permanente)
const jwt = require('jsonwebtoken');
const net = require('net');
const { getPool } = require('../db');

const TTL = 30 * 1000;
let list = new net.BlockList(), loadedAt = 0, loading = null;

// IPv4 em socket dual-stack chega como ::ffff:1.2.3.4
const clientIp = req => (req.ip || '').replace(/^::ffff:/, '') || null;

// Em memória: consultar o banco a cada requisição seria um vetor de DoS por si só.
// Admin que adiciona/remove chama reload() e vale na hora; expiração por tempo tem até TTL de atraso.
function reload() {
  loading = loading || getPool()
    .then(pool => pool.query(`SELECT host(ip) AS ip, masklen(ip) AS len FROM blacklist WHERE expires_at IS NULL OR expires_at > NOW()`))
    .then(r => {
      const l = new net.BlockList();
      for (const x of r.rows) l.addSubnet(x.ip, x.len, net.isIPv4(x.ip) ? 'ipv4' : 'ipv6');
      list = l; loadedAt = Date.now();
    })
    .catch(err => { loadedAt = Date.now(); console.error('[blacklist] falha ao carregar, mantendo lista anterior:', err.message); })
    .finally(() => { loading = null; });
  return loading;
}

async function isAdminRequest(req) {
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Bearer ')) return false;
  try {
    const { id } = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    const pool = await getPool();
    const r = await pool.query(`SELECT role FROM users WHERE id = $1 AND NOT banned`, [id]);
    return r.rows[0]?.role === 'admin';
  } catch (_) { return false; }
}

// Páginas HTML → redirect; API → 403 JSON. Assets (js/css/...) passam: são públicos e baratos.
// admin.html passa para que um admin bloqueado ainda consiga abrir o painel (a API dele passa pelo token).
async function guard(req, res, next) {
  if (Date.now() - loadedAt > TTL) await reload();
  const ip = clientIp(req), fam = net.isIP(ip);
  if (!fam || !list.check(ip, fam === 4 ? 'ipv4' : 'ipv6')) return next();

  if (req.path.startsWith('/api/')) {
    if (await isAdminRequest(req)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (/\.(?!html$)\w+$/.test(req.path) || req.path === '/forbidden.html' || req.path === '/admin.html') return next();
  res.redirect('/forbidden.html');
}

// Aceita IP ("1.2.3.4") ou faixa CIDR ("192.0.0.0/8"); devolve a string validada ou null.
// /0 é recusado: bloquearia o mundo inteiro.
function parseTarget(str) {
  if (typeof str !== 'string') return null;
  const [addr, len, extra] = str.trim().split('/');
  const fam = net.isIP(addr);
  if (!fam || extra !== undefined) return null;
  if (len === undefined) return addr;
  const n = Number(len);
  return /^\d+$/.test(len) && n >= 1 && n <= (fam === 4 ? 32 : 128) ? `${addr}/${n}` : null;
}

// minutes: inteiro > 0, ou null/undefined = permanente. Retorna a data de expiração (ou null) ou undefined se inválido.
function expiryFrom(minutes) {
  if (minutes == null) return null;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 5256000) return undefined; // até 10 anos
  return new Date(Date.now() + minutes * 60000);
}

async function addIp(ip, expires) {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO blacklist (ip, expires_at) VALUES (network($1::inet)::inet, $2)
     ON CONFLICT (ip) DO UPDATE SET expires_at = EXCLUDED.expires_at`, [ip, expires]);
  await reload();
}

module.exports = { guard, reload, clientIp, expiryFrom, addIp, parseTarget };
