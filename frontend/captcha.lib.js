// lib/captcha.js — CAPTCHA clássico de "texto distorcido", renderizado como SVG
// no servidor (sem dependência nativa tipo node-canvas, sem serviço externo).
//
// Importante: o texto correto NUNCA vai pro cliente em claro. Ele é cifrado
// (AES-256-GCM) dentro do token — diferente de um JWT comum, que só assina
// (qualquer um decodifica o payload). Aqui o payload é ilegível sem a chave
// do servidor, então mesmo abrindo o DevTools não dá pra ler a resposta.
const crypto = require('crypto');

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I/L (ambíguos)
const LEN     = 5;
const TTL_MS  = 5 * 60 * 1000;

function encKey() {
  return crypto.createHash('sha256').update(String(process.env.JWT_SECRET)).digest();
}

function randomText() {
  let out = '';
  for (let i = 0; i < LEN; i++) out += CHARSET[crypto.randomInt(CHARSET.length)];
  return out;
}

function buildSvg(text) {
  const W = 160, H = 56;
  const bg     = '#ece7da';
  const colors = ['#2c3e50', '#8e2f2f', '#1f5c3f', '#3a3a7a'];

  let noise = '';
  for (let i = 0; i < 6; i++) {
    const x1 = crypto.randomInt(W), y1 = crypto.randomInt(H);
    const x2 = crypto.randomInt(W), y2 = crypto.randomInt(H);
    noise += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colors[i % colors.length]}" stroke-width="1" opacity="0.25"/>`;
  }
  for (let i = 0; i < 18; i++) {
    const cx = crypto.randomInt(W), cy = crypto.randomInt(H);
    noise += `<circle cx="${cx}" cy="${cy}" r="1" fill="${colors[i % colors.length]}" opacity="0.3"/>`;
  }

  const step = W / (text.length + 1);
  let chars = '';
  for (let i = 0; i < text.length; i++) {
    const x    = Math.round(step * (i + 0.8));
    const y    = Math.round(H / 2 + (crypto.randomInt(11) - 5));
    const rot  = crypto.randomInt(41) - 20; // -20..20 graus
    const size = 24 + crypto.randomInt(6);
    const col  = colors[crypto.randomInt(colors.length)];
    chars += `<text x="${x}" y="${y}" font-family="Georgia, serif" font-weight="700" font-size="${size}"
      fill="${col}" text-anchor="middle" dominant-baseline="middle"
      transform="rotate(${rot} ${x} ${y})">${text[i]}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    ${noise}
    ${chars}
  </svg>`;

  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function generateCaptcha() {
  const text = randomText();
  const image = buildSvg(text);

  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const payload = JSON.stringify({ ans: text, exp: Date.now() + TTL_MS });
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const token = [iv, tag, encrypted].map(b => b.toString('base64url')).join('.');
  return { image, token };
}

function verifyCaptcha(token, answer) {
  if (!token || answer === undefined || answer === null || String(answer).trim() === '') return false;
  try {
    const [ivB64, tagB64, dataB64] = String(token).split('.');
    const iv  = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');

    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const { ans, exp } = JSON.parse(decrypted.toString('utf8'));

    if (Date.now() > exp) return false;
    return String(answer).trim().toUpperCase() === ans;
  } catch (_) {
    return false; // token malformado, adulterado ou expirado
  }
}

module.exports = { generateCaptcha, verifyCaptcha };
