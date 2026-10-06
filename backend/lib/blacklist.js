// lib/blacklist.js — bloqueio de IPs (tabela `blacklist`, expires_at NULL = permanente)
const jwt = require('jsonwebtoken');
const net = require('net');
const os  = require('os');
const { getPool } = require('../db');

const TTL = 30 * 1000;
let list = new net.BlockList(), exempt = new net.BlockList(), loadedAt = 0, loading = null;

// IPv4 em socket dual-stack chega como ::ffff:1.2.3.4
const clientIp = req => (req.ip || '').replace(/^::ffff:/, '') || null;

// Em memória: consultar o banco a cada requisição seria um vetor de DoS por si só.
// Admin que adiciona/remove chama reload() e vale na hora; expiração por tempo tem até TTL de atraso.
const famOf = ip => ({ 4: 'ipv4', 6: 'ipv6' }[net.isIP(ip)]);

// Isentos mesmo dentro de uma faixa bloqueada: IPs do servidor e último IP de cada admin.
// ponytail: IP público da Railway não aparece nas interfaces de rede; só os IPs locais do container/máquina.
const SERVER_IPS = Object.values(os.networkInterfaces()).flat().map(i => i.address);

function reload() {
  loading = loading || getPool()
    .then(pool => Promise.all([
      pool.query(`SELECT host(ip) AS ip, masklen(ip) AS len FROM blacklist WHERE expires_at IS NULL OR expires_at > NOW()`),
      pool.query(`SELECT host(last_ip) AS ip FROM users WHERE role = 'admin' AND last_ip IS NOT NULL`),
    ]))
    .then(([bl, admins]) => {
      const l = new net.BlockList(), e = new net.BlockList();
      for (const x of bl.rows) l.addSubnet(x.ip, x.len, famOf(x.ip));
      for (const ip of [...SERVER_IPS, ...admins.rows.map(x => x.ip)]) if (famOf(ip)) e.addAddress(ip, famOf(ip));
      list = l; exempt = e; loadedAt = Date.now();
    })
    .catch(err => { loadedAt = Date.now(); console.error('[blacklist] falha ao carregar, mantendo lista anterior:', err.message); })
    .finally(() => { loading = null; });
  return loading;
}

// Um IP único (sem faixa) de admin, do servidor ou de quem está fazendo o pedido não pode ser bloqueado.
// Faixas que contêm esses IPs são aceitas: guard() isenta os IPs individualmente.
async function isProtected(target, reqIp) {
  const [addr, len] = target.split('/');
  const fam = famOf(addr);
  if (len !== undefined && Number(len) !== (fam === 'ipv4' ? 32 : 128)) return false;
  await reload();
  const me = new net.BlockList();
  if (famOf(reqIp)) me.addAddress(reqIp, famOf(reqIp));
  return exempt.check(addr, fam) || (famOf(reqIp) === fam && me.check(addr, fam));
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
  const ip = clientIp(req), fam = famOf(ip);
  if (!fam || !list.check(ip, fam) || exempt.check(ip, fam)) return next();

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

module.exports = { guard, reload, clientIp, expiryFrom, addIp, parseTarget, isProtected };
