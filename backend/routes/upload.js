// routes/upload.js — Upload de arquivos de nível
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { getPool } = require('../db');

// ── Garante que a pasta levels existe ───────────────────────
const LEVELS_DIR = path.join(__dirname, '../../levels');
if (!fs.existsSync(LEVELS_DIR)) {
  fs.mkdirSync(LEVELS_DIR, { recursive: true });
}

// ── Configuração do Multer ───────────────────────────────────
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, LEVELS_DIR);
  },
  filename: function (_req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB máximo
});

// ── POST /api/upload/level ──────────────────────────────────
// Body (multipart/form-data):
//   file        — arquivo do nível  (campo "file")
//   name        — nome do nível
//   description — descrição (opcional)
//   author_id   — ID do usuário logado
router.post('/level', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado (campo "file")' });
  }

  const { name, description, author_id } = req.body;

  if (!name || !author_id) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'name e author_id são obrigatórios' });
  }

  const authorId = parseInt(author_id);
  if (isNaN(authorId)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'author_id inválido' });
  }

  try {
    const pool = await getPool();

    // Salva registro na tabela files
    const fileResult = await pool.query(
      `INSERT INTO files (user_id, hash)
       VALUES ($1, $2)
       RETURNING id`,
      [authorId, req.file.filename]
    );

    const fileId = fileResult.rows[0].id;

    // Cria o nível vinculado ao arquivo
    const levelResult = await pool.query(
      `INSERT INTO levels (name, description, author, file_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, downloads, likes`,
      [name, description || null, authorId, fileId]
    );

    res.status(201).json({
      ok: true,
      level: levelResult.rows[0],
      file: {
        id:       fileId,
        filename: req.file.filename,
        size:     req.file.size,
      }
    });

  } catch (err) {
    fs.unlink(req.file.path, () => {});
    console.error('[POST /upload/level]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /api/upload/level/:filename ────────────────────────
// Download do arquivo bruto do nível
router.get('/level/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // evita path traversal
  const filePath = path.join(LEVELS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado no servidor' });
  }

  res.download(filePath);
});

module.exports = router;
