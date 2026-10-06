// tests/e2e.js — testes ponta a ponta com Selenium (Chrome headless).
//
// Sobe o backend local (porta 3000, pois frontend/config.js aponta para ela) usando o
// DATABASE_URL de backend/.env, dirige o site num navegador headless e, a cada passo,
// grava o HTML da página em tests/output/<passo>.html e imprime o texto visível dela.
// Usuários de teste têm prefixo "e2e_" e são apagados do banco no final.
// Uploads vão para uma pasta temporária (LEVELS_DIR), nunca para ./levels.
//
// Uso: cd tests && npm install && npm test        (HEADFUL=1 para ver o navegador)
const { Builder, By, until } = require('selenium-webdriver');
const chrome  = require('selenium-webdriver/chrome');
const { spawn } = require('child_process');
const { createRequire } = require('module');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT    = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const OUT     = path.join(__dirname, 'output');
const BASE    = 'http://localhost:3000';
const bReq    = createRequire(path.join(BACKEND, 'package.json'));
bReq('dotenv').config({ path: path.join(BACKEND, '.env') });

const PASS  = 'Senha@Forte1';
const RUN   = Date.now().toString(36);
const U1    = 'e2e_a' + RUN, U2 = 'e2e_b' + RUN, ADM = 'e2e_adm' + RUN;
const LEVELS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-levels-'));

let server, driver, pool;
const results = [];
let stepNo = 0;

/* ── helpers ─────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $  = sel => driver.findElement(By.css(sel));
const $$ = sel => driver.findElements(By.css(sel));
const text = async sel => (await $(sel)).getText();
const waitFor = (sel, ms = 8000) => driver.wait(until.elementLocated(By.css(sel)), ms);
const waitVisible = async (sel, ms = 8000) => driver.wait(until.elementIsVisible(await waitFor(sel, ms)), ms);
const waitUrl = (re, ms = 8000) => driver.wait(async () => re.test(await driver.getCurrentUrl()), ms);
const setSession = (user, token) => driver.executeScript(
  'localStorage.setItem("pb_user", arguments[0]); localStorage.setItem("pb_token", arguments[1]);', JSON.stringify(user), token);
const clearStorage = () => driver.executeScript('localStorage.clear(); sessionStorage.clear();');

async function snap(name) {
  const html = await driver.getPageSource();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${String(++stepNo).padStart(2, '0')}-${name}.html`), html);
  const body = (await driver.findElement(By.css('body')).getText()).replace(/\s+/g, ' ').slice(0, 260);
  console.log(`      [html] ${name} — ${await driver.getCurrentUrl()} — "${body}"`);
  return html;
}
function assert(cond, msg) { if (!cond) throw new Error('assertion failed: ' + msg); }
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log(`  ✔ ${name}`); }
  catch (e) {
    results.push([name, false, e]); console.log(`  ✘ ${name}\n      ${e.message}`);
    try {
      await snap('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40));
      const body = await driver.executeScript(`const b = document.body.cloneNode(true); b.querySelectorAll('script,style,svg').forEach(n => n.remove()); return b.innerHTML.replace(/\\s+/g, ' ')`);
      console.log('      ---- <body> HTML (scripts/styles removidos, 2500 chars) ----\n      ' + body.slice(0, 2500));
    } catch (_) {}
  }
}

// O token do captcha é AES-GCM com chave derivada do JWT_SECRET (ver backend/lib/captcha.js).
// O teste roda com o mesmo segredo, então consegue "ler" a imagem resolvendo o token.
function solveCaptcha(token) {
  const [iv, tag, data] = token.split('.').map(p => Buffer.from(p, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(String(process.env.JWT_SECRET)).digest(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString()).ans;
}
async function solveCaptchaModal() {
  await waitVisible('#captcha-img[src^="data:image"]');
  await driver.wait(async () => (await driver.executeScript('return captchaToken')) != null, 5000);
  const ans = solveCaptcha(await driver.executeScript('return captchaToken'));
  await (await $('#captcha-ans-input')).sendKeys(ans);
  await (await $('#modal-captcha .btn-green')).click();
}
async function api(method, p, { token, body } = {}) {
  const r = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function uiLogin(user, pass = PASS) {
  await clearStorage();
  await driver.get(BASE + '/login.html');
  await (await $('#login-user')).sendKeys(user);
  await (await $('#login-pass')).sendKeys(pass);
  await (await $('#panel-login .btn-green')).click();
}
// .lvl válido e assinado, como o PB Studio grava (receita em backend/lib/lvlhash.js)
function buildLvl({ hash = true, tamper = false } = {}) {
  const { zipSync, strToU8 } = bReq('fflate');
  const { hashFiles } = bReq('./lib/lvlhash.js');
  const j = { level: { information: { name: 'e2e', description: '', author: '' },
    block_data: [new Array(540).fill('000')], entity_definitions: [], entities: [], backgrounds: ['foo'] } };
  const files = { 'level.json': strToU8(JSON.stringify(j)) };
  if (hash) j.level.information.level_hash = hashFiles(files);
  if (tamper) j.level.block_data[0][0] = '001';
  return Buffer.from(zipSync({ 'level.json': strToU8(JSON.stringify(j)) }));
}
async function makeLevelFile(name, content = buildLvl()) {
  const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, content); return f;
}
async function uiUpload(user, levelName, file) {
  await driver.get(BASE + '/upload.html');
  await (await $('#nome')).sendKeys(levelName);
  await (await $('#desc')).sendKeys('descricao e2e');
  await (await $('#arquivo')).sendKeys(file);
  await (await $('#btn-enviar')).click();
}
const levelsRow = async name => (await pool.query(`SELECT l.id, l.active, f.hash FROM levels l JOIN files f ON f.id = l.file_id WHERE l.name = $1`, [name])).rows[0];

/* ── setup / teardown ────────────────────────────────────── */
async function startServer() {
  server = spawn('node', ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: '3000', LEVELS_DIR, NODE_ENV: 'development', RATE_LIMIT_MAX: '100000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => { const s = d.toString(); if (!/deprecat/i.test(s)) process.stdout.write('      [server] ' + s); });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (_) {} await sleep(250); }
  throw new Error('servidor não subiu na porta 3000 (já tem algo rodando lá?)');
}
async function cleanup() {
  try {
    if (pool) {
      await pool.query(`DELETE FROM admin_logs WHERE admin_name LIKE 'e2e\\_%'`);
      await pool.query(`DELETE FROM users WHERE username LIKE 'e2e\\_%'`); // cascata: files, levels, comments, reports...
      await pool.end();
    }
  } catch (e) { console.log('cleanup DB falhou:', e.message); }
  try { if (driver) await driver.quit(); } catch (_) {}
  try { if (server) server.kill(); } catch (_) {}
  fs.rmSync(LEVELS_DIR, { recursive: true, force: true });
}

/* ── cenários ────────────────────────────────────────────── */
async function main() {
  const { Pool, neonConfig } = bReq('@neondatabase/serverless'); neonConfig.webSocketConstructor = bReq('ws');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await startServer();
  const opts = new chrome.Options();
  if (!process.env.HEADFUL) opts.addArguments('--headless=new');
  opts.addArguments('--no-sandbox', '--window-size=1280,900', '--disable-gpu');
  driver = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();
  await driver.manage().setTimeouts({ implicit: 0, pageLoad: 20000, script: 10000 });

  console.log('\n── Navegação anônima ──');
  await test('home carrega e navbar mostra "Entrar"', async () => {
    await driver.get(BASE + '/index.html'); await snap('home-anonimo');
    assert(/entrar/i.test(await text('#nav-auth')), 'nav-auth deveria dizer Entrar');
  });
  await test('não há link para Cafézinho nem easter egg de 9 cliques', async () => {
    await driver.get(BASE + '/levels.html');
    assert((await $$('a[href="little_coffee.html"]')).length === 0, 'link do Cafézinho ainda existe');
    for (let i = 0; i < 9; i++) await (await $('.nav-brand')).click(), await driver.get(BASE + '/levels.html');
    assert(/levels\.html/.test(await driver.getCurrentUrl()), 'clicar 9x não deveria navegar para créditos');
    assert((await fetch(BASE + '/little_coffee.html')).status === 404, 'little_coffee.html deveria dar 404');
  });
  await test('rota inexistente serve 404.html', async () => {
    const r = await fetch(BASE + '/nao-existe'); assert(r.status === 404, 'status ' + r.status);
  });
  await test('upload.html sem login mostra aviso e esconde formulário', async () => {
    await driver.get(BASE + '/upload.html'); await snap('upload-anonimo');
    assert(await (await $('#aviso-login')).isDisplayed(), 'aviso-login oculto');
    assert(!(await (await $('#form-upload')).isDisplayed()), 'formulário visível');
  });
  await test('admin.html sem login redireciona para login', async () => {
    await clearStorage(); await driver.get(BASE + '/admin.html'); await waitUrl(/login\.html\?next=admin\.html/);
  });

  console.log('\n── Cadastro / login ──');
  await test('cadastro pela UI com captcha → perfil e navbar com o nome', async () => {
    await clearStorage(); await driver.get(BASE + '/login.html');
    await (await $('.tab:nth-child(2)')).click();
    await (await $('#reg-user')).sendKeys(U1); await (await $('#reg-bio')).sendKeys('bio e2e');
    await (await $('#reg-pass')).sendKeys(PASS); await (await $('#reg-pass2')).sendKeys(PASS);
    await (await $('#panel-register .btn-green')).click();
    await solveCaptchaModal();
    await waitUrl(/perfil_do_usuario\.html\?id=\d+/); await waitFor('.user-name'); await snap('perfil-apos-cadastro');
    assert((await text('.user-name')).toLowerCase() === U1, 'nome no perfil');
    assert((await text('#nav-auth')).toLowerCase() === U1, 'navbar deveria mostrar o usuário, mostrou: ' + await text('#nav-auth'));
  });
  await test('navbar mostra o usuário em TODAS as páginas (bug original)', async () => {
    for (const p of ['index', 'levels', 'usuarios', 'sobre', 'download', 'upload', 'creditos', '404']) {
      await driver.get(`${BASE}/${p}.html`);
      await driver.wait(async () => (await text('#nav-auth')).toLowerCase() === U1, 4000).catch(() => {});
      assert((await text('#nav-auth')).toLowerCase() === U1, `${p}.html mostra "${await text('#nav-auth')}"`);
    }
    await snap('navbar-logado');
  });
  await test('token expirado → navbar volta a "Entrar" e sessão é limpa', async () => {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    await setSession({ id: 1, username: 'x' }, `a.${b64({ exp: 1 })}.c`);
    await driver.get(BASE + '/levels.html');
    assert(/entrar/i.test(await text('#nav-auth')), 'deveria mostrar Entrar');
    assert(await driver.executeScript('return localStorage.getItem("pb_user")') === null, 'sessão não foi limpa');
  });
  await test('cadastro duplicado, senha fraca e sem captcha são rejeitados pela API', async () => {
    const cap = (await api('GET', '/auth/captcha')).data;
    const ok = () => ({ captcha_token: cap.token, captcha_answer: solveCaptcha(cap.token) });
    assert((await api('POST', '/auth/register', { body: { username: 'e2e_x' + RUN, password: 'senha@forte1', ...ok() } })).status === 400, 'sem maiúscula');
    assert((await api('POST', '/auth/register', { body: { username: 'e2e_x' + RUN, password: 'Senha@Forte1' } })).status === 400, 'sem captcha');
    assert((await api('POST', '/auth/register', { body: { username: U1, password: PASS, ...ok() } })).status === 409, 'duplicado');
    assert((await api('POST', '/auth/register', { body: { username: 12345, password: PASS, ...ok() } })).status === 400, 'tipo inválido');
    assert((await api('POST', '/auth/login', { body: { username: 12345, password: PASS } })).status === 400, 'login com tipo inválido');
    assert((await fetch(BASE + '/api/health')).ok, 'servidor caiu');
  });
  await test('login com senha errada mostra erro; certa entra', async () => {
    await uiLogin(U1, 'Errada@123'); await driver.wait(async () => (await text('#login-msg')).length > 0, 5000); await snap('login-erro');
    assert(/incorretos/i.test(await text('#login-msg')), 'mensagem de erro');
    await clearStorage(); await uiLogin(U1); await waitUrl(/perfil_do_usuario/);
  });
  await test('3 erros de senha exigem captcha (força bruta)', async () => {
    const bf = 'e2e_bf' + RUN;
    const cap = (await api('GET', '/auth/captcha')).data;
    await api('POST', '/auth/register', { body: { username: bf, password: PASS, captcha_token: cap.token, captcha_answer: solveCaptcha(cap.token) } });
    await uiLogin(bf, 'Errada@1');
    for (let i = 0; i < 2; i++) { await (await $('#panel-login .btn-green')).click(); await sleep(2500); }
    // 3º erro = bloqueio de 30s (botão vira contagem regressiva); captcha passa a valer depois do bloqueio
    await driver.wait(async () => /aguarde/i.test(await text('#panel-login .btn-green')), 6000); await snap('login-bloqueado');
    const r = await api('POST', '/auth/login', { body: { username: bf, password: PASS } });
    assert(r.status === 429 && r.data.locked && r.data.requires_captcha, 'API: 429 locked + requires_captcha, veio ' + r.status);
  });
  await test('?next= respeita só páginas locais (sem open redirect)', async () => {
    await clearStorage(); await driver.get(BASE + '/login.html?next=https://evil.com');
    await (await $('#login-user')).sendKeys(U1); await (await $('#login-pass')).sendKeys(PASS);
    await (await $('#panel-login .btn-green')).click(); await waitUrl(/perfil_do_usuario/);
    await uiLogin(U1); // sessão nova
  });

  console.log('\n── Upload e interação com levels ──');
  const LV = 'E2E Level ' + RUN;
  let levelId;
  await test('upload de level pela UI cria o level e grava o arquivo em LEVELS_DIR', async () => {
    await waitUrl(/perfil_do_usuario/);
    await uiUpload(U1, LV, await makeLevelFile('e2e-' + RUN + '.lvl'));
    await waitUrl(/perfil_do_jogo\.html\?id=\d+/, 12000); await waitFor('.level-hero-name'); await driver.wait(async () => (await text('.level-hero-name')).length > 0, 5000); await snap('level-criado');
    levelId = parseInt((await driver.getCurrentUrl()).match(/id=(\d+)/)[1]);
    assert((await text('.level-hero-name')).toLowerCase() === LV.toLowerCase(), 'nome do level: ' + await text('.level-hero-name'));
    const row = await levelsRow(LV);
    assert(row && row.active === true, 'linha no banco ativa');
    assert(fs.existsSync(path.join(LEVELS_DIR, row.hash)), 'arquivo em LEVELS_DIR');
  });
  await test('upload com extensão proibida é barrado (cliente e servidor)', async () => {
    await driver.get(BASE + '/upload.html');
    await (await $('#nome')).sendKeys('Level exe ' + RUN); await (await $('#arquivo')).sendKeys(await makeLevelFile('virus.exe', 'MZ'));
    await (await $('#btn-enviar')).click(); await waitVisible('#msg'); await snap('upload-ext-proibida');
    assert(/não permitido/i.test(await text('#msg')), 'mensagem de tipo inválido');
    const r = await fetch(BASE + '/api/upload/level', { method: 'POST', headers: { Authorization: 'Bearer ' + await driver.executeScript('return localStorage.getItem("pb_token")') }, body: (() => { const f = new FormData(); f.append('name', 'Servidor ' + RUN); f.append('file', new Blob(['MZ']), 'x.exe'); return f; })() });
    assert(r.status === 400, 'servidor deveria recusar .exe, status ' + r.status);
  });
  await test('upload de .lvl sem hash, com hash adulterado ou que não é ZIP é recusado e não deixa arquivo', async () => {
    const before = fs.readdirSync(LEVELS_DIR).length;
    const token = await driver.executeScript('return localStorage.getItem("pb_token")');
    for (const [buf, re] of [[buildLvl({ hash: false }), /level_hash/], [buildLvl({ tamper: true }), /não confere/], [Buffer.from('nao sou zip'), /ZIP/]]) {
      const f = new FormData(); f.append('name', 'Invalido ' + RUN); f.append('file', new Blob([buf]), 'z.lvl');
      const r = await fetch(BASE + '/api/upload/level', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: f });
      assert(r.status === 400 && re.test((await r.json()).error), 'esperava 400 /' + re + '/, status ' + r.status);
    }
    await sleep(300);
    assert(fs.readdirSync(LEVELS_DIR).length === before, 'arquivo órfão em LEVELS_DIR');
  });
  await test('upload sem nome válido não deixa arquivo órfão', async () => {
    const before = fs.readdirSync(LEVELS_DIR).length;
    const token = await driver.executeScript('return localStorage.getItem("pb_token")');
    const f = new FormData(); f.append('name', 'ab'); f.append('file', new Blob([buildLvl()]), 'y.lvl');
    const r = await fetch(BASE + '/api/upload/level', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: f });
    await sleep(300);
    assert(r.status === 400 && fs.readdirSync(LEVELS_DIR).length === before, 'status ' + r.status + ' / arquivos ' + fs.readdirSync(LEVELS_DIR).length);
  });
  await test('level aparece em /levels.html, na busca e no perfil do criador', async () => {
    await driver.get(BASE + '/levels.html'); await driver.wait(async () => (await driver.getPageSource()).includes(LV), 8000); await snap('lista-levels');
    await driver.get(BASE + '/levels.html?q=' + encodeURIComponent(RUN)); await driver.wait(async () => (await driver.getPageSource()).includes(LV), 8000);
    const me = JSON.parse(await driver.executeScript('return localStorage.getItem("pb_user")'));
    await driver.get(BASE + '/perfil_do_usuario.html?id=' + me.id); await driver.wait(async () => (await driver.getPageSource()).includes(LV), 8000);
  });
  await test('curtir/descurtir persiste no servidor', async () => {
    await driver.get(`${BASE}/perfil_do_jogo.html?id=${levelId}`); await waitFor('#like-btn');
    await (await $('#like-btn')).click();
    await driver.wait(async () => (await text('#like-btn')).toLowerCase().includes('curtido'), 5000); await snap('level-curtido');
    assert((await text('#like-count')) === '1', 'contador = 1');
    await driver.navigate().refresh(); await waitFor('#like-btn');
    await driver.wait(async () => (await text('#like-btn')).toLowerCase().includes('curtido'), 5000);
    await (await $('#like-btn')).click();
    await driver.wait(async () => (await text('#like-count')) === '0', 5000);
  });
  await test('curtida não vaza para outra conta no mesmo navegador', async () => {
    await (await $('#like-btn')).click(); await driver.wait(async () => (await text('#like-count')) === '1', 5000);
    const cap = (await api('GET', '/auth/captcha')).data;
    const reg = await api('POST', '/auth/register', { body: { username: U2, password: PASS, captcha_token: cap.token, captcha_answer: solveCaptcha(cap.token) } });
    await setSession(reg.data.user, reg.data.token);
    await driver.get(`${BASE}/perfil_do_jogo.html?id=${levelId}`); await waitFor('#like-btn');
    await sleep(800);
    assert((await text('#like-btn')).toLowerCase().includes('curtir') && !(await text('#like-btn')).toLowerCase().includes('curtido'), 'usuário 2 não curtiu: ' + await text('#like-btn'));
  });
  await test('comentar e apagar o próprio comentário', async () => {
    await waitFor('#comment-input');
    await (await $('#comment-input')).sendKeys('comentário <b>e2e</b>'); await (await $('#comment-submit')).click();
    await driver.wait(async () => (await driver.getPageSource()).includes('comentário &lt;b&gt;e2e&lt;/b&gt;'), 5000); await snap('comentario');
    await (await $('.comment-delete')).click(); await driver.switchTo().alert().accept();
    await driver.wait(async () => (await $$('.comment-item')).length === 0, 5000);
  });
  await test('denunciar level', async () => {
    await (await $('.btn-report')).click(); await waitVisible('#modal-report:not(.hidden)');
    await (await $('input[name="report-reason"][value="Outro"]')).click();
    await driver.executeScript('submitReport()'); await waitVisible('#report-msg');
    assert((await pool.query(`SELECT 1 FROM reports WHERE level_id=$1`, [levelId])).rowCount === 1, 'denúncia gravada');
  });
  await test('outro usuário não pode apagar o level (403)', async () => {
    const token = await driver.executeScript('return localStorage.getItem("pb_token")');
    assert((await api('DELETE', '/levels/' + levelId, { token })).status === 403, 'status');
  });
  await test('download registra por token (body user_id é ignorado)', async () => {
    const me = JSON.parse(await driver.executeScript('return localStorage.getItem("pb_user")'));
    const before = (await pool.query('SELECT downloaded_levels FROM users WHERE username=$1', [U1])).rows[0].downloaded_levels;
    await api('POST', `/levels/${levelId}/download`, { body: { user_id: (await pool.query('SELECT id FROM users WHERE username=$1', [U1])).rows[0].id } });
    assert((await pool.query('SELECT downloaded_levels FROM users WHERE username=$1', [U1])).rows[0].downloaded_levels === before, 'anônimo forjou histórico');
    const t = await driver.executeScript('return localStorage.getItem("pb_token")');
    await api('POST', `/levels/${levelId}/download`, { token: t });
    assert((await pool.query('SELECT downloaded_levels FROM users WHERE username=$1', [U2])).rows[0].downloaded_levels === 1, 'histórico do dono do token');
    assert((await api('POST', '/levels/999999/download')).status === 404, 'level inexistente = 404');
  });
  await test('XSS: nome de level malicioso é escapado em index, levels e perfil', async () => {
    const evil = `<img src=x onerror="window.__xss=1"> ${RUN}`;
    const tok = (await api('POST', '/auth/login', { body: { username: U1, password: PASS } })).data.token;
    const f = new FormData(); f.append('name', evil); f.append('file', new Blob([buildLvl()]), 'xss.lvl');
    assert((await fetch(BASE + '/api/upload/level', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: f })).status === 201, 'upload xss');
    await driver.executeScript('sessionStorage.clear()');
    for (const p of ['index.html', 'levels.html', 'usuarios.html']) {
      await driver.get(`${BASE}/${p}`); await sleep(1500);
      assert(await driver.executeScript('return window.__xss') == null, 'XSS executou em ' + p);
    }
    await driver.get(BASE + '/levels.html'); await driver.wait(async () => (await driver.getPageSource()).includes('&lt;img'), 6000); await snap('xss-escapado');
  });

  console.log('\n── Apagar level = desativar (soft delete) ──');
  await test('criador apaga pela UI: arquivo sai do disco, linha fica inativa no banco', async () => {
    const tok = (await api('POST', '/auth/login', { body: { username: U1, password: PASS } })).data;
    await setSession(tok.user, tok.token);
    await driver.get(BASE + '/perfil_do_usuario.html?id=' + tok.user.id);
    await driver.wait(async () => (await driver.getPageSource()).includes(LV), 8000);
    const before = await levelsRow(LV); assert(fs.existsSync(path.join(LEVELS_DIR, before.hash)), 'arquivo existia');
    await (await $(`#level-card-${levelId} .btn-delete-level`)).click();
    await waitVisible('#modal-delete:not(.hidden)'); await (await $('#confirm-delete-btn')).click();
    await driver.wait(async () => (await $$(`#level-card-${levelId}`)).length === 0, 6000); await snap('level-apagado');
    const after = await levelsRow(LV);
    assert(after && after.active === false, 'linha deve continuar no banco com active=false');
    assert(!fs.existsSync(path.join(LEVELS_DIR, after.hash)), 'arquivo deveria ter sido removido de LEVELS_DIR');
  });
  await test('level desativado some para anônimo, dono e outros usuários', async () => {
    const t1 = (await api('POST', '/auth/login', { body: { username: U1, password: PASS } })).data.token;
    for (const token of [undefined, t1]) {
      assert((await api('GET', '/levels/' + levelId, { token })).status === 404, 'GET /levels/:id');
      assert((await api('POST', `/levels/${levelId}/like`, { token: t1 })).status === 404, 'like');
      assert((await api('POST', `/levels/${levelId}/comment`, { token: t1, body: { content: 'x' } })).status === 404, 'comment');
      assert((await api('POST', `/levels/${levelId}/download`, { token })).status === 404, 'download');
      assert((await api('DELETE', '/levels/' + levelId, { token: t1 })).status === 404, 'apagar de novo');
    }
    assert(!(await api('GET', '/levels')).data.some(l => l.id === levelId), 'lista pública');
    assert(!(await api('GET', '/levels?author_id=' + (await pool.query('SELECT id FROM users WHERE username=$1', [U1])).rows[0].id)).data.some(l => l.id === levelId), 'lista por autor');
    const fileId = (await pool.query('SELECT file_id FROM levels WHERE id=$1', [levelId])).rows[0].file_id;
    assert((await api('GET', '/files/' + fileId)).status === 404, 'metadados do arquivo');
    await driver.get(`${BASE}/perfil_do_jogo.html?id=${levelId}`); await waitUrl(/404\.html/); await snap('level-inativo-404');
  });
  await test('admin enxerga o level desativado (API e painel), usuário comum não acessa /admin', async () => {
    const hash = await new Promise((res, rej) => bReq('bcrypt').hash(PASS, 4, (e, h) => e ? rej(e) : res(h)));
    await pool.query(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')`, [ADM, hash]);
    const a = (await api('POST', '/auth/login', { body: { username: ADM, password: PASS } })).data;
    assert((await api('GET', '/levels/' + levelId, { token: a.token })).data.active === false, 'admin lê level inativo');
    assert((await api('GET', '/admin/levels')).status === 401, 'sem token');
    const t1 = (await api('POST', '/auth/login', { body: { username: U1, password: PASS } })).data.token;
    assert((await api('GET', '/admin/levels', { token: t1 })).status === 403, 'não-admin');
    await setSession(a.user, a.token); await driver.get(BASE + '/admin.html');
    await driver.wait(async () => !(await (await $('#auth-gate')).isDisplayed()), 8000);
    await driver.executeScript(`goPage('levels', document.querySelector('[data-page="levels"]'))`);
    await driver.wait(async () => (await driver.getPageSource()).includes('Apagada'), 8000); await snap('admin-levels');
    // painel de admin para conta comum
    await setSession({ id: 0, username: U1 }, t1); await driver.get(BASE + '/admin.html');
    await driver.wait(async () => /não tem permissão/i.test(await text('#auth-gate-body')), 8000); await snap('admin-negado');
  });
  await test('admin apaga level de outro usuário (soft delete + arquivo removido) e log é escapado', async () => {
    const tok = (await api('POST', '/auth/login', { body: { username: U1, password: PASS } })).data.token;
    const f = new FormData(); f.append('name', 'Alvo <b>admin</b> ' + RUN); f.append('file', new Blob([buildLvl()]), 'alvo.lvl');
    const lv = (await (await fetch(BASE + '/api/upload/level', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: f })).json()).level;
    const row = (await pool.query('SELECT f.hash FROM levels l JOIN files f ON f.id=l.file_id WHERE l.id=$1', [lv.id])).rows[0];
    const a = (await api('POST', '/auth/login', { body: { username: ADM, password: PASS } })).data.token;
    assert((await api('DELETE', '/admin/levels/' + lv.id, { token: a })).status === 200, 'delete admin');
    assert((await pool.query('SELECT active FROM levels WHERE id=$1', [lv.id])).rows[0].active === false, 'inativo');
    assert(!fs.existsSync(path.join(LEVELS_DIR, row.hash)), 'arquivo removido');
    const logs = (await api('GET', '/admin/logs', { token: a })).data;
    assert(logs.some(l => l.text.includes('&lt;b&gt;admin&lt;/b&gt;')) && !logs.some(l => l.text.includes('<b>admin</b>')), 'log escapado');
  });
}

(async () => {
  let fatal;
  try { await main(); } catch (e) { fatal = e; console.log('\nERRO FATAL:', e.stack || e); }
  await cleanup();
  const failed = results.filter(r => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passaram. HTML de cada passo: tests/output/`);
  failed.forEach(([n, , e]) => console.log(`  ✘ ${n}: ${e.message}`));
  process.exit(fatal || failed.length ? 1 : 0);
})();
