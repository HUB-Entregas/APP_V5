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
  API_URL: 'https://script.google.com/macros/s/AKfycbwLtGCY_46qVBnzMD5fJ87KOIT4WTQHZ1hv_52n5KjfJJpKYusHn9LAXjUstwpm1LQ/exec',
  TOKEN: 'HUB-ENTREGAS',
  // Só os NOMES dos motoristas ficam aqui (não é dado sensível — é o que
  // aparece na lista da tela de login). As SENHAS ficam no backend
  // (backend/Code.gs, mapa MOTORISTAS), conferidas no servidor no momento
  // do login, para não ficarem visíveis neste arquivo público.
  MOTORISTAS: ['Mello', 'Vinicius', 'Said', 'Matheus Silva', 'Joao', 'Thales', 'Bruno', 'Pedro']
};
