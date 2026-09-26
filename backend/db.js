// db.js — Pool de conexão singleton com PostgreSQL
require('dotenv').config();

// Neon (DATABASE_URL) usa o driver serverless via WebSocket, que NÃO fala com um
// Postgres local puro — nesse caso (DB_*) cai para o pg padrão.
let pool;
if (process.env.DATABASE_URL) {
  const { Pool, neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = require('ws');
  // SSL obrigatório para Neon / Railway / Supabase em produção
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
} else {
  const { Pool } = require('pg');
  pool = new Pool({
      host:     process.env.DB_SERVER   || 'localhost',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'pauro',
      port:     parseInt(process.env.DB_PORT || '5432'),
  });
}

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message);
});

// Testa conectividade na inicialização.
// O pg Pool já gerencia reconexão automaticamente — sem flag _connected frágil.
pool.query('SELECT 1')
  .then(() => console.log('[DB] Conectado ao PostgreSQL'))
  .catch(err => console.error('[DB] Falha na conexão inicial:', err.message));

// getPool() mantido por compatibilidade com o resto do código
async function getPool() {
  return pool;
}

module.exports = { getPool, pool };
