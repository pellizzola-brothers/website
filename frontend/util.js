// util.js — helpers compartilhados entre páginas

/**
 * Escapa HTML para uso seguro dentro de innerHTML.
 * Usar sempre que dado vindo do usuário (nome, bio, descrição, comentário)
 * for concatenado em uma string HTML.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Emojis aceitos como avatar — mesma lista de backend/lib/avatars.js.
 * O avatar fica em users.avatar (NULL = ainda não escolheu = '👤').
 */
const AVATARS = ['👤','🦊','🐯','🐸','🦁','🐧','🐺','🤖','👾','🦄','🐉','🎭','💀','🧙','🕵️','🧑‍🚀','👻','🦸','🧛','🐮','🐱','🐻','🐼','🦋','🌟','🔥','😎','🤠','👑','⚡','🎃','🌈'];

/** Avatar de um usuário vindo da API ({ avatar }) — sempre usar este helper. */
function avatarOf(u) {
  return (u && u.avatar) || AVATARS[0];
}
