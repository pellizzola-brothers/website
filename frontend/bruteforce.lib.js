// lib/bruteforce.js — controle de tentativas de login (por username).
//
// Regra: a partir do 3º erro, captcha passa a ser exigido em toda tentativa
// seguinte. A cada múltiplo de 3 erros (3, 6, 9, ... 60), a conta é bloqueada
// por um tempo que cresce a cada vez, até travar em 8h no 60º erro.
const { getPool } = require('../db');

const CAPTCHA_THRESHOLD = 3;   // a partir daqui, captcha obrigatório
const LOCK_EVERY        = 3;   // a cada N erros, bloqueia de novo
const BASE_WAIT_SECONDS = 30;  // espera no 1º bloqueio (3 erros)
const MAX_WAIT_SECONDS  = 8 * 60 * 60; // 8h
const MAX_STEPS         = 20;  // passo 20 == 60 erros == já no teto de 8h

function computeWaitSeconds(step) {
  if (step >= MAX_STEPS) return MAX_WAIT_SECONDS;
  const ratio = MAX_WAIT_SECONDS / BASE_WAIT_SECONDS;
  return Math.round(BASE_WAIT_SECONDS * Math.pow(ratio, (step - 1) / (MAX_STEPS - 1)));
}

async function getAttempt(username) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT fail_count, locked_until FROM login_attempts WHERE username = $1`,
    [username]
  );
  return result.rows[0] || { fail_count: 0, locked_until: null };
}

function isLocked(attempt) {
  return !!attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now();
}

function retryAfterSeconds(attempt) {
  return Math.max(1, Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 1000));
}

function requiresCaptcha(attempt) {
  return attempt.fail_count >= CAPTCHA_THRESHOLD;
}

// Registra uma falha, incrementa o contador e aplica bloqueio progressivo
// quando o contador bate um múltiplo de LOCK_EVERY. Retorna a linha atualizada.
async function registerFailure(username) {
  const pool = await getPool();
  const current  = await getAttempt(username);
  const newCount = current.fail_count + 1;

  let lockedUntil = current.locked_until;
  if (newCount % LOCK_EVERY === 0) {
    const step = newCount / LOCK_EVERY;
    const wait = computeWaitSeconds(step);
    lockedUntil = new Date(Date.now() + wait * 1000);
  }

  await pool.query(
    `INSERT INTO login_attempts (username, fail_count, locked_until, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (username) DO UPDATE
       SET fail_count = $2, locked_until = $3, updated_at = NOW()`,
    [username, newCount, lockedUntil]
  );

  return { fail_count: newCount, locked_until: lockedUntil };
}

async function resetAttempts(username) {
  const pool = await getPool();
  await pool.query(`DELETE FROM login_attempts WHERE username = $1`, [username]).catch(() => {});
}

module.exports = {
  getAttempt, isLocked, retryAfterSeconds, requiresCaptcha,
  registerFailure, resetAttempts, computeWaitSeconds,
  CAPTCHA_THRESHOLD,
};
