# GUIA DE CORREÇÕES — Pellizzola Brothers
## Como usar este guia
Para cada problema: leia onde colar, copie o bloco de código, substitua no VS Code.

---

# PROBLEMA 1 — SEGURANÇA CRÍTICA: .env versionado

## Passo 1 — Rotacionar credenciais AGORA (antes de qualquer commit)

### Gerar novo JWT_SECRET (rode no terminal):
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Copie o resultado — você vai colar no painel do Railway.

### Rotacionar senha do Neon:
1. Acesse https://console.neon.tech
2. Selecione seu projeto → aba **Roles**
3. Clique em `neondb_owner` → **Reset password**
4. Copie a nova senha — anote junto com o novo JWT_SECRET

---

## Passo 2 — Remover backend/.env do histórico Git

### Opção A — git filter-repo (RECOMENDADO, mais rápido):
```bash
# Instala a ferramenta (uma vez)
pip install git-filter-repo

# Remove o arquivo do histórico inteiro
git filter-repo --path backend/.env --invert-paths --force

# Force-push em todas as branches e tags
git push origin --force --all
git push origin --force --tags
```

### Opção B — git filter-branch (alternativa sem dependência extra):
```bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch backend/.env" \
  --prune-empty --tag-name-filter cat -- --all

git push origin --force --all
git push origin --force --tags
```

⚠️ Avise todos os colaboradores para excluírem o clone local e clonarem novamente após o force push.

---

## Passo 3 — Arquivo .gitignore corrigido

**Arquivo:** `.gitignore` (raiz do projeto)
**Ação:** Substitua o conteúdo inteiro pelo bloco abaixo.

```
backend/node_modules/*
node_modules/*
.DS_Store

# ── SEGURANÇA: nunca versionar arquivos .env ─────────────────
.env
.env.*
!.env.example
backend/.env
backend/.env.*
!backend/.env.example
```

Depois commit:
```bash
git add .gitignore
git commit -m "chore: ignorar .env em todas as localizações"
```

---

## Passo 4 — Configurar variáveis no Railway (produção)

No painel do Railway → seu serviço → aba **Variables**, adicione:
```
DATABASE_URL=postgresql://neondb_owner:NOVA_SENHA@ep-round-morning-ac6dtlgw-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full&pgbouncer=true
JWT_SECRET=VALOR_GERADO_NO_PASSO_1
PORT=3000
ALLOWED_ORIGINS=https://frontend-production-31a0.up.railway.app
```
O arquivo `backend/.env` **nunca deve existir em produção** — só localmente para dev.

---

## Passo 5 — Pre-commit hook (prevenção futura)

```bash
pip install detect-secrets pre-commit
detect-secrets scan > .secrets.baseline
```

Crie o arquivo `.pre-commit-config.yaml` na raiz (já está na pasta de outputs):
```yaml
repos:
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
```

Depois:
```bash
pre-commit install
git add .secrets.baseline .pre-commit-config.yaml
git commit -m "chore: adicionar detect-secrets ao pre-commit"
```

---
---

# PROBLEMA 2 — BUG: getDeletedLevels() indefinida

## Onde está o problema

**Arquivo:** `frontend/perfil_do_usuario.html`
**Localização:** dentro da função `loadProfile()`, por volta da linha onde `u.levels` é filtrado.

## Código ANTES (com o bug):
```javascript
// DENTRO de loadProfile(), trecho problemático:
  const deleted = getDeletedLevels();
  const levels = (u.levels || []).filter(l => !deleted.includes(l.id));
```

## Código DEPOIS (correto):

**Localize no VS Code** usando Ctrl+F (ou Cmd+F no Mac) dentro de `perfil_do_usuario.html`:
```
const deleted = getDeletedLevels();
```

Selecione as **duas linhas** abaixo e substitua por:
```javascript
  const levels = u.levels || [];  // O backend já filtra os deletados — server-side
```

### Verificação — também remova esta linha logo abaixo (se existir):
```javascript
  // getDeletedLevels removido — delete agora é server-side
```
Essa linha de comentário pode ficar, mas a chamada `getDeletedLevels()` e o `.filter()` que a usa devem ir embora.

---

## Grep para encontrar outras chamadas órfãs (rode no terminal):
```bash
grep -rn "getDeletedLevels" frontend/
```
Se aparecer algum resultado que não seja um comentário, remova também.

---

## Arquivo ESLint (previne recorrência)

**Crie o arquivo** `.eslintrc.json` na raiz (já está na pasta de outputs).

Para rodar o lint:
```bash
# instala uma vez
npm install -g eslint

# roda em todo o frontend
eslint frontend/*.html --ext .html
```

---
---

# PROBLEMA 3 — BUG DE ROTA: URL duplicando /api

## Onde está o problema

**Arquivo:** `frontend/perfil_do_usuario.html`
**Função:** `confirmDelete()`

## Linha ANTES (com o bug):
```javascript
    const res = await fetch(API + '/api/levels/' + id, {
```

## Linha DEPOIS (correta):
**Localize** com Ctrl+F: `API + '/api/levels/'`
**Substitua por:**
```javascript
    const res = await fetch(API + '/levels/' + id, {
```

---

## Grep para auditar todas as ocorrências do padrão errado:
```bash
grep -rn "API + '/api/" frontend/
grep -rn 'API + "/api/' frontend/
```
Qualquer resultado é um bug. A constante `API` já termina em `/api`, então o caminho seguinte nunca deve começar com `/api/`.

---

## Módulo api.js (solução permanente)

O arquivo `api.js` já está gerado na pasta de outputs. Ele centraliza todas as chamadas e elimina a possibilidade de duplicar segmentos de URL.

**Como incluir nas páginas:**

Adicione as duas linhas abaixo no `<head>` de cada página HTML, **após** `config.js` e **antes** de qualquer `<script>` que faça chamadas à API:

```html
<script src="config.js"></script>
<script src="auth.js"></script>   <!-- deve vir antes -->
<script src="api.js"></script>    <!-- depende de auth.js (usa getToken) -->
```

**Como migrar chamadas existentes (exemplos):**

| Antes | Depois |
|---|---|
| `fetch(API + '/levels/' + id)` | `api.levels.get(id)` |
| `fetch(API + '/levels/' + id + '/like', {method:'POST',...})` | `api.levels.like(id)` |
| `fetch(API + '/api/levels/' + id, {method:'DELETE',...})` | `api.levels.delete(id)` |
| `fetch(API + '/users/' + id)` | `api.users.get(id)` |
| `fetch(API + '/levels/' + id + '/comment', ...)` | `api.levels.comment(id, content)` |

A migração pode ser **incremental** — não precisa substituir tudo de uma vez. O arquivo api.js e as chamadas diretas coexistem sem conflito.

---
---

# PROBLEMA 4 — localStorage vs sessionStorage

## Arquivo auth.js (já gerado em outputs)

**Copie `auth.js` para** `frontend/auth.js`.

Inclua em **todas as páginas HTML** dentro do `<head>`, logo após `config.js`:
```html
<script src="config.js"></script>
<script src="auth.js"></script>
```

---

## Correção em login.html

**Arquivo:** `frontend/login.html`

### Trecho da função `doLogin()` — ANTES:
```javascript
    sessionStorage.setItem('pb_user', JSON.stringify(data.user));
    if (data.token) sessionStorage.setItem('pb_token', data.token);
```

### Trecho da função `doLogin()` — DEPOIS:
**Localize** com Ctrl+F: `sessionStorage.setItem('pb_user', JSON.stringify(data.user));`
**Substitua as duas linhas por:**
```javascript
    saveSession(data.user, data.token);
```

---

### Trecho da função `doRegister()` — ANTES:
```javascript
    sessionStorage.setItem('pb_user',  JSON.stringify(data.user));
    if (data.token) sessionStorage.setItem('pb_token', data.token);
```

### Trecho da função `doRegister()` — DEPOIS:
**Localize** com Ctrl+F: `sessionStorage.setItem('pb_user',  JSON.stringify(data.user));`
**Substitua as duas linhas por:**
```javascript
    saveSession(data.user, data.token);
```

---

### Verificação de sessão no topo da página — ANTES:
```javascript
const existing = JSON.parse(sessionStorage.getItem('pb_user') || 'null');
```

### DEPOIS:
**Localize** com Ctrl+F: `sessionStorage.getItem('pb_user')`
**Substitua a linha por:**
```javascript
const existing = getUser();
```

---

## Correção em perfil_do_jogo.html

**Arquivo:** `frontend/perfil_do_jogo.html`

### Leitura do usuário e token — ANTES:
```javascript
const user  = JSON.parse(localStorage.getItem('pb_user')  || 'null');
const token = localStorage.getItem('pb_token') || '';
```

### DEPOIS:
**Localize** com Ctrl+F: `localStorage.getItem('pb_user')`
**Substitua as duas linhas por:**
```javascript
const user  = getUser();
const token = getToken();
```

---

## Correção em perfil_do_usuario.html

**Arquivo:** `frontend/perfil_do_usuario.html`

### Leitura do usuário logado — ANTES:
```javascript
const loggedUser = JSON.parse(sessionStorage.getItem('pb_user') || 'null');
```

### DEPOIS:
**Localize** com Ctrl+F: `sessionStorage.getItem('pb_user')`
**Substitua a linha por:**
```javascript
const loggedUser = getUser();
```

---

### Função logout() — ANTES:
```javascript
function logout() { sessionStorage.removeItem('pb_user'); sessionStorage.removeItem('pb_token'); window.location.href = 'index.html'; }
```

### DEPOIS:
**Localize** com Ctrl+F: `function logout()`
**Substitua a função inteira por:**
```javascript
function logout() {
  clearSession();
  window.location.href = 'index.html';
}
```

---

### Token no confirmDelete() — ANTES:
```javascript
  const token = sessionStorage.getItem('pb_token');
```

### DEPOIS:
**Localize** com Ctrl+F: `sessionStorage.getItem('pb_token')`
**Substitua por:**
```javascript
  const token = getToken();
```

---

## Correção em 404.html e index.html (leitura de sessão na navbar)

Nesses arquivos, a sessão é lida inline no script. Localize e substitua:

**ANTES:**
```javascript
const user = JSON.parse(sessionStorage.getItem('pb_user') || 'null');
```

**DEPOIS:**
```javascript
const user = getUser();
```

(Lembre de incluir `<script src="auth.js"></script>` no `<head>` dessas páginas também.)

---

## Grep para detectar todos os acessos diretos pendentes:
```bash
# Encontra qualquer acesso direto a pb_token ou pb_user nos storages
grep -rn "sessionStorage\|localStorage" frontend/ | grep "pb_token\|pb_user"
```
Qualquer resultado que **não** venha de `auth.js` é um candidato à substituição.

---
---

# RESUMO — Ordem de execução recomendada

1. **Rotacione credenciais** no Neon e gere novo JWT_SECRET (Problema 1 — Passo 1)
2. **Remova backend/.env do histórico** Git e faça force push (Problema 1 — Passo 2)
3. **Atualize .gitignore** (Problema 1 — Passo 3)
4. **Copie `auth.js` e `api.js`** para `frontend/` (Problemas 3 e 4)
5. **Corrija `perfil_do_usuario.html`**: remove `getDeletedLevels()` + corrige URL do DELETE + corrige sessionStorage → getUser()/clearSession() (Problemas 2, 3 e 4)
6. **Corrija `login.html`**: sessionStorage → saveSession() + getUser() (Problema 4)
7. **Corrija `perfil_do_jogo.html`**: localStorage direto → getUser()/getToken() (Problema 4)
8. **Adicione `<script src="auth.js"></script>`** em todas as páginas (Problema 4)
9. **Rode o grep de auditoria** para verificar que não sobraram acessos diretos
10. **Configure variáveis no Railway** e faça deploy (Problema 1 — Passo 4)
