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

// Registra uma falha com incremento ATÔMICO (INSERT ... ON CONFLICT DO UPDATE): tentativas
// paralelas não se perdem numa corrida leitura→escrita. Ao bater um múltiplo de LOCK_EVERY
// aplica o bloqueio progressivo. Retorna a linha atualizada.
async function registerFailure(username) {
  const pool = await getPool();
  const r = await pool.query(
    `INSERT INTO login_attempts (username, fail_count, updated_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (username) DO UPDATE
       SET fail_count = login_attempts.fail_count + 1, updated_at = NOW()
     RETURNING fail_count, locked_until`,
    [username]
  );
  const failCount = r.rows[0].fail_count;
  let lockedUntil = r.rows[0].locked_until;

  if (failCount % LOCK_EVERY === 0) {
    lockedUntil = new Date(Date.now() + computeWaitSeconds(failCount / LOCK_EVERY) * 1000);
    await pool.query(`UPDATE login_attempts SET locked_until = $2 WHERE username = $1`, [username, lockedUntil]);
  }
  return { fail_count: failCount, locked_until: lockedUntil };
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
