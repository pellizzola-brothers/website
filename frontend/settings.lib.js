// lib/settings.js — leitura das flags globais da plataforma (tabela `settings`)
const { getPool } = require('../db');

const DEFAULTS = {
  maintenance_mode:   false,
  allow_registration: true,
  allow_upload:       true,
};

// Sem cache: são poucas linhas e mudam raramente, mas precisam refletir
// a mudança do admin imediatamente (ex: religar cadastro na hora).
async function getSettings() {
  try {
    const pool   = await getPool();
    const result = await pool.query(`SELECT key, value FROM settings`);
    const out = { ...DEFAULTS };
    for (const row of result.rows) out[row.key] = row.value;
    return out;
  } catch (err) {
    // Tabela pode não existir ainda (banco não migrado) — não derruba o site.
    console.error('[settings] falha ao ler tabela settings, usando padrões:', err.message);
    return { ...DEFAULTS };
  }
}

async function getSetting(key) {
  const all = await getSettings();
  return all[key];
}

module.exports = { getSettings, getSetting, DEFAULTS };
