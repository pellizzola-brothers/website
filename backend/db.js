// db.js — Pool de conexão singleton com SQL Server
const sql = require('mssql');
require('dotenv').config();

const config = {
  server:   process.env.DB_SERVER   || 'sqlexpress',
  database: process.env.DB_DATABASE || 'pauro',
  user:     process.env.DB_USER     || 'aluno',
  password: process.env.DB_PASSWORD || 'aluno',
  port:     parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt:                false, // true se usar Azure
    trustServerCertificate: true,  // aceita certificado autoassinado (dev)
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Pool único reutilizado em toda a aplicação
let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log('[DB] Conectado ao SQL Server — banco: pauro');
  }
  return pool;
}

module.exports = { getPool, sql };
