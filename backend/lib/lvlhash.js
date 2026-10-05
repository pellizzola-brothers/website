// lib/lvlhash.js — valida um .lvl (estrutura + information.level_hash).
// Receita do hash: ver "The level_hash recipe" no CLAUDE.md.
const crypto = require('crypto');
const { unzipSync, strFromU8, strToU8 } = require('fflate');

const W = 540;                       // colunas por linha de block_data
const MAX_ENTRY = 20 * 1024 * 1024;  // limite por arquivo descompactado (zip bomb)
const BG = ['foo', 'bar', 'baz'];
const isStr = v => typeof v === 'string';

function hashFiles(files) {
  const h = crypto.createHash('sha256');
  for (const k of Object.keys(files).sort()) {
    if (k.endsWith('/')) continue;
    let data = files[k];
    if (k === 'level.json') {
      const j = JSON.parse(strFromU8(data));
      delete j.level.information.level_hash;
      data = strToU8(JSON.stringify(j));
    }
    h.update(k + '\0' + data.length + '\0');
    h.update(data);
  }
  return h.digest('hex');
}

// Retorna a mensagem de erro, ou null se o .lvl é válido.
function checkLvl(buf) {
  let files;
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return 'Arquivo .lvl inválido: não é um arquivo ZIP';
  try {
    files = unzipSync(buf, { filter: f => f.originalSize <= MAX_ENTRY });
  } catch (_) { return 'Arquivo .lvl inválido: ZIP corrompido'; }

  for (const k of Object.keys(files))
    if (!k.endsWith('/') && k !== 'level.json' && !/^scripts\/.+\.lua$/.test(k) && !/^midi\/.+\.mid$/i.test(k))
      return `Arquivo .lvl inválido: entrada inesperada "${k}"`;
  if (!files['level.json']) return 'Arquivo .lvl inválido: level.json ausente (ou grande demais)';

  let l;
  try { l = JSON.parse(strFromU8(files['level.json'])).level; }
  catch (_) { return 'Arquivo .lvl inválido: level.json não é JSON válido'; }

  const bad = what => `Arquivo .lvl inválido: ${what}`;
  if (!l || typeof l !== 'object') return bad('level.json sem objeto "level"');
  const i = l.information;
  if (!i || typeof i !== 'object' || !['name', 'description', 'author'].every(k => isStr(i[k])))
    return bad('information precisa de name, description e author (texto)');
  if (!Array.isArray(l.block_data) || !l.block_data.length) return bad('block_data vazio');
  if (!l.block_data.every(r => Array.isArray(r) && r.length === W && r.every(c => isStr(c) && /^\d{3}$/.test(c))))
    return bad(`cada linha de block_data deve ter exatamente ${W} ids de 3 dígitos`);
  if (!Array.isArray(l.entity_definitions) || !l.entity_definitions.every(d => d && isStr(d.id) && isStr(d.script)))
    return bad('entity_definitions inválido');
  const defs = new Set(l.entity_definitions.map(d => d.id));
  if (!Array.isArray(l.entities) || !l.entities.every(e => e && defs.has(e.def)
      && Array.isArray(e.pos) && e.pos.length === 2 && e.pos.every(n => typeof n === 'number' && isFinite(n))))
    return bad('entities inválido');
  if (!Array.isArray(l.backgrounds) || !l.backgrounds.every(b => BG.includes(b))) return bad('backgrounds inválido');

  if (!isStr(i.level_hash) || !/^[0-9a-f]{64}$/.test(i.level_hash))
    return 'Level sem level_hash válido: salve-o novamente no PB Studio';
  if (hashFiles(files) !== i.level_hash)
    return 'level_hash não confere: o arquivo foi modificado depois de salvo no PB Studio';
  return null;
}

module.exports = { checkLvl, hashFiles };
