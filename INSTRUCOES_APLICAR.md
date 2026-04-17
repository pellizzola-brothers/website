# INSTRUÇÕES DE APLICAÇÃO DAS CORREÇÕES

## Resumo do que foi corrigido

### 🔴 Crítico
1. **Sessão inconsistente** → sessionStorage → localStorage via auth.js
2. **multer vulnerável** → atualizado para v2 no package.json
3. **getDeletedLevels() indefinida** → removida de perfil_do_usuario.html
4. **URL duplicando /api no DELETE** → corrigida em perfil_do_usuario.html
5. **pacote `users` deprecated** → removido do package.json

### 🟠 Importante
6. **escHtml duplicada** → mantida apenas em perfil_do_usuario.html e perfil_do_jogo.html
7. **cacheSave em dados mockados** → o bug já estava corrigido em levels.html; confirmado na análise
8. **niveis.html** → deve ser DELETADO (o nav aponta para levels.html que tem filtro avançado)

---

## Onde colocar cada arquivo

| Arquivo gerado | Destino no projeto |
|---|---|
| `frontend_auth.js` | `frontend/auth.js` (CRIAR — novo arquivo) |
| `frontend_api.js` | `frontend/api.js` (CRIAR — novo arquivo) |
| `login.html` | `frontend/login.html` (SUBSTITUIR) |
| `index.html` | `frontend/index.html` (SUBSTITUIR) |
| `404.html` | `frontend/404.html` (SUBSTITUIR) |
| `perfil_do_jogo.html` | `frontend/perfil_do_jogo.html` (SUBSTITUIR) |
| `perfil_do_usuario.html` | `frontend/perfil_do_usuario.html` (SUBSTITUIR) |
| `package.json` | `backend/package.json` (SUBSTITUIR) |
| `upload_route.js` | `backend/routes/upload.js` (SUBSTITUIR) |

---

## Passos obrigatórios após copiar os arquivos

### 1. Atualizar dependências do backend
```bash
cd backend
npm install
```
Isso instala multer v2 e remove o pacote `users`.

### 2. Deletar niveis.html
```bash
rm frontend/niveis.html
```
O arquivo `niveis.html` não é linkado no nav e tem um bug de cache com fallback mockado.
`levels.html` é a versão correta com filtro avançado de autor.

### 3. Verificar que auth.js está incluído em todas as páginas HTML
Cada página que lê sessão de usuário deve ter no `<head>`:
```html
<script src="config.js"></script>
<script src="auth.js"></script>
```
As páginas já corrigidas neste pacote já têm isso.
**Páginas restantes que você deve verificar manualmente:**
- `frontend/usuarios.html` — adicionar `<script src="auth.js"></script>` após config.js e trocar `sessionStorage.getItem('pb_user')` por `getUser()`
- `frontend/upload.html` — adicionar `<script src="auth.js"></script>` e trocar `sessionStorage.getItem('pb_user')` por `getUser()`, `sessionStorage.getItem('pb_token')` por `getToken()`
- `frontend/levels.html` — adicionar `<script src="auth.js"></script>` e trocar o `sessionStorage.getItem('pb_user')` por `getUser()`

### 4. Rodar grep de auditoria para confirmar que não sobrou sessionStorage
```bash
grep -rn "sessionStorage" frontend/ | grep "pb_token\|pb_user"
```
Qualquer resultado que não venha de auth.js é um candidato à substituição.

### 5. Sobre o código de recovery retornando o código no JSON
O `backend/routes/auth.js` inclui `code` na resposta em desenvolvimento.
Antes de ir para produção, remova essa linha:
```javascript
// Em routes/auth.js, rota POST /recovery/request — REMOVER antes de produção:
res.json({ ok: true, code, message: '...' });
// Substituir por:
res.json({ ok: true, message: 'Se o usuário existir, o código foi gerado.' });
```

### 6. Sobre CORS em produção
Certifique-se que o `.env` de produção no Railway tem:
```
ALLOWED_ORIGINS=https://frontend-production-31a0.up.railway.app
```

---

## Verificação final

Após aplicar tudo:
1. Abra o site em duas abas diferentes
2. Faça login em uma aba
3. Atualize a outra — você deve aparecer logado (esse era o bug principal)
4. Teste upload de level
5. Teste deletar level — deve funcionar sem erro 404/403
