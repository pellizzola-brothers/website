// routes/upload.js — Upload + criação de level em uma só chamada (PROTEGIDO por JWT)
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { getPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '../../levels');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const ALLOWED_EXTENSIONS = ['.json', '.lvl', '.dat', '.xml', '.bin'];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      // multer v2: rejeita sem lançar erro no middleware
      cb(null, false);
    }
  }
});

// ── POST /api/upload/level — PROTEGIDO ──────────────────────
router.post('/level', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'Nenhum arquivo enviado ou tipo não permitido (.json, .lvl, .dat, .xml, .bin)'
    });
  }

  const { name, description } = req.body;
  if (!name || name.trim().length < 3)
    return res.status(400).json({ error: 'Nome do level obrigatório (mínimo 3 caracteres)' });

  const userId  = req.user.id;
  const hash    = req.file.filename;

  try {
    const pool = await getPool();

    const fileResult = await pool.query(
      `INSERT INTO files (user_id, hash) VALUES ($1, $2) RETURNING id`,
      [userId, hash]
    );
    const fileId = fileResult.rows[0].id;

    const levelResult = await pool.query(
      `INSERT INTO levels (name, description, author, file_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, downloads, likes`,
      [name.trim(), description ? description.trim() : null, userId, fileId]
    );
    const level = levelResult.rows[0];

    res.status(201).json({ ok: true, level, file_id: fileId });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('[POST /upload/level]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/upload/level/:filename — público ───────────────
router.get('/level/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filepath))
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  res.download(filepath);
});

module.exports = router;
