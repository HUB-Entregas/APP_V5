// ============================================================
// CONFIGURAÇÃO — edite depois de publicar o backend do Google
// Apps Script (veja o README.md). Usado pelo app do motorista
// (index.html) e pelo painel do administrador (admin.html).
//
// Cada motorista tem sua própria senha — é o motorista quem escolhe
// o próprio nome e digita a senha para "logar" no aparelho. Isso não é
// uma autenticação de servidor (veja a nota no fim do README.md), é só
// uma confirmação simples pra evitar que alguém entre no nome errado.
// ============================================================
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzb_KrAEOtEFcW5fSe7co6csV4ta-oISRCAE8j-YANRG_9YC4pAcYSACcNwSo_ioihj/exec',
  // Não há mais senha nem token neste arquivo público. A escrita de
  // comprovantes agora exige um token de sessão emitido no login (guardado no
  // aparelho). As SENHAS dos motoristas ficam no backend (Code.gs, MOTORISTAS).
  // Aqui ficam só os NOMES (o que aparece na lista de login) — não é sensível.
  MOTORISTAS: ['Mello', 'Vinicius', 'Said', 'Matheus Silva', 'Joao', 'Thales', 'Bruno', 'Carlos', 'Pedro', 'Adrian']
};
