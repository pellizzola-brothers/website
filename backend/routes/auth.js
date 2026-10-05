const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const { getPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { getSetting } = require('../lib/settings');
const { generateCaptcha, verifyCaptcha } = require('../lib/captcha');
const bruteforce = require('../lib/bruteforce');
const { clientIp } = require('../lib/blacklist');

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRES   = '7d';

function makeToken(user, expiresIn, extra) {
  return jwt.sign(
    { id: user.id, username: user.username, ...extra },
    process.env.JWT_SECRET,
    { expiresIn: expiresIn || JWT_EXPIRES }
  );
}

// Regras de senha compartilhadas por cadastro, recuperação e troca de senha.
// (Espelham as checagens de login.html / perfil_do_usuario.html.)
function passwordError(password, username) {
  if (typeof password !== 'string' || password.length <= 7)
    return 'A senha deve ter mais de 7 caracteres';
  if (!/[A-Z]/.test(password))
    return 'A senha deve ter pelo menos uma letra maiúscula';
  if (!/[!@#$%^&*()+\-=[\]{};:'",.<>/?|]/.test(password))
    return 'A senha deve ter pelo menos um caractere especial';
  if (username && password.toLowerCase().includes(username.toLowerCase()))
    return 'A senha não pode conter o nome de usuário';
  return null;
}

// ── GET /api/auth/captcha — usado no login (a partir do 3º erro) e no cadastro (sempre) ──
router.get('/captcha', (req, res) => {
  res.json(generateCaptcha());
});

// ── POST /api/auth/register ──────────────────────────────────
router.post('/register', async (req, res) => {
  if (!(await getSetting('allow_registration')))
    return res.status(403).json({ error: 'Cadastro de novos usuários está desativado no momento' });

  const { username, bio, password, captcha_token, captcha_answer } = req.body;

  // Cadastro sempre exige 1 captcha resolvido, antes de qualquer outra validação.
  if (!verifyCaptcha(captcha_token, captcha_answer))
    return res.status(400).json({ error: 'Resolva o captcha corretamente.', requires_captcha: true });

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  if (/\s/.test(username))
    return res.status(400).json({ error: 'Nome de usuário não pode conter espaços' });
  if (username.length < 3)
    return res.status(400).json({ error: 'Nome de usuário muito curto (mínimo 3 caracteres)' });
  const pwErr = passwordError(password, username);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const pool = await getPool();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, bio, password_hash, last_ip)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, bio`,
      [username.toLowerCase(), bio ? bio.trim() : null, hash, clientIp(req)]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: makeToken(user) });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Nome de usuário já está em uso' });
    console.error('[POST /auth/register]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────
// Defesa contra força bruta: a partir do 3º erro exige captcha; a cada
// múltiplo de 3 erros, bloqueia por um tempo crescente (até 8h no 60º erro).
router.post('/login', async (req, res) => {
  const { username, password, captcha_token, captcha_answer } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });

  const uname = username.toLowerCase();

  try {
    const attempt = await bruteforce.getAttempt(uname);

    if (bruteforce.isLocked(attempt)) {
      return res.status(429).json({
        error: 'Muitas tentativas erradas. Tente novamente mais tarde.',
        locked: true,
        requires_captcha: true,
        retry_after: bruteforce.retryAfterSeconds(attempt),
      });
    }

    if (bruteforce.requiresCaptcha(attempt) && !verifyCaptcha(captcha_token, captcha_answer)) {
      return res.status(400).json({
        error: 'Resolva o captcha corretamente.',
        requires_captcha: true,
      });
    }

    const pool   = await getPool();
    const result = await pool.query(
      `SELECT id, username, password_hash, role, banned FROM users WHERE username = $1`,
      [uname]
    );

    const user = result.rows[0];
    const ok   = user && await bcrypt.compare(password, user.password_hash || '');

    if (!ok) {
      const updated = await bruteforce.registerFailure(uname);
      return res.status(401).json({
        error: 'Usuário ou senha incorretos',
        requires_captcha: bruteforce.requiresCaptcha(updated),
        locked: bruteforce.isLocked(updated),
        retry_after: bruteforce.isLocked(updated) ? bruteforce.retryAfterSeconds(updated) : undefined,
      });
    }
    if (user.banned)
      return res.status(403).json({ error: 'Esta conta está banida' });

    await bruteforce.resetAttempts(uname);
    await pool.query(`UPDATE users SET last_ip = $1 WHERE id = $2`, [clientIp(req), user.id]);
    res.json({ user: { id: user.id, username: user.username, role: user.role }, token: makeToken(user) });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/request ─────────────────────────
router.post('/recovery/request', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  if (!username)
    return res.status(400).json({ error: 'Informe o nome de usuário' });

  try {
    const pool   = await getPool();
    const result = await pool.query(
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0)
      return res.json({ ok: true, message: 'Se o usuário existir, o código foi gerado.' });

    const code    = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    const hashed  = await bcrypt.hash(code, 10);

    await pool.query(
      `UPDATE users SET recovery_code = $1, recovery_expires = $2 WHERE id = $3`,
      [hashed, expires, result.rows[0].id]
    );

    const response = { ok: true, message: 'Se o usuário existir, o código foi gerado.' };
    if (process.env.NODE_ENV !== 'production') response.code = code;
    res.json(response);
  } catch (err) {
    console.error('[POST /auth/recovery/request]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/verify ──────────────────────────
router.post('/recovery/verify', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const code     = (req.body.code || '').trim();
  if (!username || !code)
    return res.status(400).json({ error: 'Usuário e código são obrigatórios' });

  try {
    const pool   = await getPool();
    const result = await pool.query(
      `SELECT id, username, recovery_code, recovery_expires FROM users WHERE username = $1`,
      [username]
    );

    const invalid = () => res.status(400).json({ error: 'Código inválido ou expirado' });

    if (result.rows.length === 0) return invalid();
    const user = result.rows[0];
    if (!user.recovery_code || !user.recovery_expires) return invalid();
    if (new Date() > new Date(user.recovery_expires)) return invalid();

    const valid = await bcrypt.compare(code, user.recovery_code);
    if (!valid) return invalid();

    await pool.query(
      `UPDATE users SET recovery_code = NULL, recovery_expires = NULL WHERE id = $1`,
      [user.id]
    );
    res.json({ token: makeToken({ id: user.id, username: user.username }, '15m', { recovery: true }) });
  } catch (err) {
    console.error('[POST /auth/recovery/verify]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/recovery/reset ───────────────────────────
router.post('/recovery/reset', authMiddleware, async (req, res) => {
  // Só o token emitido por /recovery/verify redefine a senha — um token de login comum não basta
  if (!req.user.recovery)
    return res.status(403).json({ error: 'Token de recuperação necessário' });

  const { password } = req.body;
  const userId = req.user.id;

  const pwErr = passwordError(password, req.user.username);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const pool = await getPool();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /auth/recovery/reset]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/auth/change-password — usuário logado troca a senha informando a atual ──
router.post('/change-password', authMiddleware, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (typeof old_password !== 'string' || !old_password)
    return res.status(400).json({ error: 'Informe a senha atual' });
  const pwErr = passwordError(new_password, req.user.username);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const pool   = await getPool();
  const result = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  const hash   = result.rows[0] && result.rows[0].password_hash;
  if (!hash || !(await bcrypt.compare(old_password, hash)))
    return res.status(403).json({ error: 'Senha atual incorreta' });

  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`,
    [await bcrypt.hash(new_password, BCRYPT_ROUNDS), req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
