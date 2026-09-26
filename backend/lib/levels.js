// lib/levels.js — armazenamento em disco e desativação (soft delete) de levels.
const fs   = require('fs');
const path = require('path');

// LEVELS_DIR permite apontar para outra pasta (ex.: testes automatizados)
const UPLOAD_DIR = process.env.LEVELS_DIR
  ? path.resolve(process.env.LEVELS_DIR)
  : path.join(__dirname, '../../levels');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// "Apagar" um level = marcar active=false (a linha fica no banco, só admins enxergam)
// e remover o arquivo de levels/. Retorna { name } ou null se não existir / já inativo.
async function deactivateLevel(pool, id) {
  const r = await pool.query(
    `UPDATE levels l SET active = false
     FROM files f
     WHERE l.id = $1 AND l.active AND f.id = l.file_id
     RETURNING l.name, f.hash`,
    [id]
  );
  if (r.rowCount === 0) return null;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(r.rows[0].hash)), () => {});
  return { name: r.rows[0].name };
}

module.exports = { UPLOAD_DIR, deactivateLevel };
