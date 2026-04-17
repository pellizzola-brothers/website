// routes/files.js — Metadados de arquivos
const express = require('express');
const router  = express.Router();
const { getPool } = require('../db');

// ── GET /api/files/:id ──────────────────────────────────────
// Retorna hash e user_id de um arquivo pelo seu id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT id, user_id, hash, created_at FROM files WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Arquivo não encontrado' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /files/:id]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
