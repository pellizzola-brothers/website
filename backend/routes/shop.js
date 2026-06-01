// routes/shop.js
const express = require('express');
const router  = express.Router();
const { getPool }       = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ── Tabelas necessárias (rode uma vez no banco) ─────────────
// CREATE TABLE IF NOT EXISTS shop_inventory (
//   id         SERIAL PRIMARY KEY,
//   user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//   item_id    TEXT    NOT NULL,
//   purchased_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(user_id, item_id)
// );
//
// CREATE TABLE IF NOT EXISTS shop_equipped (
//   user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
//   equipped   JSONB   NOT NULL DEFAULT '{}'
// );
//
// ALTER TABLE users ADD COLUMN IF NOT EXISTS exp DOUBLE PRECISION NOT NULL DEFAULT 0;

// ── GET /api/shop/inventory ─────────────────────────────────
// Retorna inventário e itens equipados do usuário autenticado
router.get('/inventory', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const pool = await getPool();
    const [invResult, eqResult] = await Promise.all([
      pool.query(
        `SELECT item_id FROM shop_inventory WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT equipped FROM shop_equipped WHERE user_id = $1`,
        [userId]
      ),
    ]);

    res.json({
      inventory: invResult.rows.map(r => r.item_id),
      equipped:  eqResult.rows.length ? eqResult.rows[0].equipped : {},
    });
  } catch (err) {
    console.error('[GET /shop/inventory]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/shop/buy ──────────────────────────────────────
// Desconta XP do banco e registra o item no inventário
router.post('/buy', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { item_id } = req.body;

  if (!item_id || typeof item_id !== 'string')
    return res.status(400).json({ error: 'item_id inválido' });

  // Preços dos itens (fonte da verdade no backend — não confiar no frontend)
  const PRICES = {
    color_blue: 50,   color_green: 50,   color_purple: 100,  color_orange: 100,  color_gold: 200,
    bg_mint: 100,     bg_lavender: 100,  bg_sunset: 250,     bg_night: 500,
    frame_silver: 150, frame_gold: 400,  frame_emerald: 400, frame_purple: 500,
    frame_spin: 800,  frame_rainbow: 1500,
    badge_creator: 200, badge_veteran: 300, badge_top: 400, badge_champ: 600, badge_legend: 1200,
    title_explorer: 300, title_arch: 500, title_master: 800, title_legend: 1000, title_unique: 2000,
    card_gold: 400,   card_purple: 400,  card_emerald: 400,  card_legend: 1000,
  };

  // Avatares são grátis (price = 0), aceitamos qualquer avatar_N
  const isAvatar = /^avatar_\d+$/.test(item_id);
  const price    = isAvatar ? 0 : PRICES[item_id];

  if (!isAvatar && price === undefined)
    return res.status(404).json({ error: 'Item não encontrado' });

  try {
    const pool = await getPool();

    // Verifica se já possui o item
    const alreadyOwned = await pool.query(
      `SELECT 1 FROM shop_inventory WHERE user_id = $1 AND item_id = $2`,
      [userId, item_id]
    );
    if (alreadyOwned.rows.length > 0)
      return res.status(409).json({ error: 'Item já comprado' });

    // Desconta XP e registra inventário em uma transação
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Trava a linha do usuário para evitar race condition
      const userRow = await client.query(
        `SELECT exp FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      if (userRow.rows.length === 0) throw new Error('Usuário não encontrado');

      const currentExp = parseFloat(userRow.rows[0].exp) || 0;
      if (price > 0 && currentExp < price) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: 'XP insuficiente', xp: currentExp });
      }

      const newExp = currentExp - price;

      await client.query(
        `UPDATE users SET exp = $1 WHERE id = $2`,
        [newExp, userId]
      );

      await client.query(
        `INSERT INTO shop_inventory (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, item_id]
      );

      // Equipa automaticamente o item recém-comprado
      const type = resolveType(item_id);
      if (type) {
        await client.query(
          `INSERT INTO shop_equipped (user_id, equipped)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (user_id) DO UPDATE
             SET equipped = shop_equipped.equipped || $2::jsonb`,
          [userId, JSON.stringify({ [type]: item_id })]
        );
      }

      await client.query('COMMIT');

      const eqResult = await pool.query(
        `SELECT equipped FROM shop_equipped WHERE user_id = $1`,
        [userId]
      );
      res.json({ ok: true, xp: newExp, item_id, equipped: eqResult.rows[0]?.equipped || {} });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[POST /shop/buy]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/shop/equip ────────────────────────────────────
// Salva os itens equipados no banco (upsert por tipo)
router.post('/equip', authMiddleware, async (req, res) => {
  const userId  = req.user.id;
  const { item_id } = req.body;

  if (!item_id || typeof item_id !== 'string')
    return res.status(400).json({ error: 'item_id inválido' });

  const type = resolveType(item_id);
  if (!type)
    return res.status(400).json({ error: 'Tipo de item desconhecido' });

  try {
    const pool = await getPool();

    // Valida posse (avatares são sempre livres)
    const isAvatar = /^avatar_\d+$/.test(item_id);
    const isFree   = isAvatar;
    if (!isFree) {
      const owned = await pool.query(
        `SELECT 1 FROM shop_inventory WHERE user_id = $1 AND item_id = $2`,
        [userId, item_id]
      );
      if (owned.rows.length === 0)
        return res.status(403).json({ error: 'Item não está no inventário' });
    }

    await pool.query(
      `INSERT INTO shop_equipped (user_id, equipped)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET equipped = shop_equipped.equipped || $2::jsonb`,
      [userId, JSON.stringify({ [type]: item_id })]
    );

    // Retorna o mapa atualizado de equipados
    const result = await pool.query(
      `SELECT equipped FROM shop_equipped WHERE user_id = $1`,
      [userId]
    );
    res.json({ ok: true, equipped: result.rows[0]?.equipped || {} });
  } catch (err) {
    console.error('[POST /shop/equip]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /api/shop/unequip ──────────────────────────────────
router.post('/unequip', authMiddleware, async (req, res) => {
  const userId  = req.user.id;
  const { item_id } = req.body;

  if (!item_id || typeof item_id !== 'string')
    return res.status(400).json({ error: 'item_id inválido' });

  const type = resolveType(item_id);
  if (!type)
    return res.status(400).json({ error: 'Tipo de item desconhecido' });

  try {
    const pool = await getPool();
    await pool.query(
      `UPDATE shop_equipped SET equipped = equipped - $1 WHERE user_id = $2`,
      [type, userId]
    );
    const result = await pool.query(
      `SELECT equipped FROM shop_equipped WHERE user_id = $1`,
      [userId]
    );
    res.json({ ok: true, equipped: result.rows[0]?.equipped || {} });
  } catch (err) {
    console.error('[POST /shop/unequip]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── Helpers ─────────────────────────────────────────────────
function resolveType(item_id) {
  if (/^avatar_\d+$/.test(item_id))      return 'avatar';
  if (item_id.startsWith('color_'))      return 'color';
  if (item_id.startsWith('bg_'))         return 'bg';
  if (item_id.startsWith('frame_'))      return 'frame';
  if (item_id.startsWith('badge_'))      return 'badge';
  if (item_id.startsWith('title_'))      return 'title';
  if (item_id.startsWith('card_'))       return 'card_theme';
  return null;
}

module.exports = router;
