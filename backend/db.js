// db.js — Pool de conexão singleton com PostgreSQL
const { Pool } = require('pg');
require('dotenv').config();

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host:     process.env.DB_SERVER   || 'localhost',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'pauro',
      port:     parseInt(process.env.DB_PORT || '5432'),
    });

// Pool único reutilizado em toda a aplicação
async function getPool() {
  if (!pool._connected) {
    // Validate connectivity on first call
    await pool.query('SELECT 1');
    pool._connected = true;
    console.log('[DB] Conectado ao PostgreSQL — banco: ' + (process.env.DB_DATABASE || 'pauro'));
  }
  return pool;
}

module.exports = { getPool, pool };

