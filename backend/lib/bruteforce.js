// lib/bruteforce.js — controle de tentativas de login (por IP, em memória).
//
// Regra: a partir do 3º erro, captcha passa a ser exigido. A cada 3 erros o IP
// fica em timeout: 1º = 1 min, 2º = 15 min, 3º = 24h. Os contadores zeram 24h
// após o 1º erro da janela. Login bem-sucedido NÃO zera (senão bastaria logar
// na própria conta para recomeçar).
// ponytail: em memória — reiniciar o servidor zera tudo, e com mais de uma instância cada uma conta separado. Mover para o banco se isso importar.
const WINDOW_MS     = 24 * 60 * 60 * 1000;
const WAITS_SECONDS = [60, 15 * 60, 24 * 60 * 60]; // por timeout
const CAPTCHA_THRESHOLD = 3;
const LOCK_EVERY        = 3;

const attempts = new Map(); // ip -> { fail_count, locked_until (ms), since (ms) }

function getAttempt(ip) {
  const a = attempts.get(ip);
  if (a && a.locked_until <= Date.now() && Date.now() - a.since > WINDOW_MS) attempts.delete(ip);
  return attempts.get(ip) || { fail_count: 0, locked_until: 0 };
}

const isLocked = a => a.locked_until > Date.now();
const retryAfterSeconds = a => Math.max(1, Math.ceil((a.locked_until - Date.now()) / 1000));
const requiresCaptcha = a => a.fail_count >= CAPTCHA_THRESHOLD;

function registerFailure(ip) {
  const a = getAttempt(ip);
  const next = { fail_count: a.fail_count + 1, locked_until: a.locked_until, since: a.since || Date.now() };
  if (next.fail_count % LOCK_EVERY === 0) {
    const step = Math.min(next.fail_count / LOCK_EVERY, WAITS_SECONDS.length);
    next.locked_until = Date.now() + WAITS_SECONDS[step - 1] * 1000;
  }
  attempts.set(ip, next);
  return next;
}

// Evita crescimento infinito do Map.
setInterval(() => {
  for (const [ip, a] of attempts) if (a.locked_until <= Date.now() && Date.now() - a.since > WINDOW_MS) attempts.delete(ip);
}, 60 * 60 * 1000).unref();

module.exports = { getAttempt, isLocked, retryAfterSeconds, requiresCaptcha, registerFailure };
