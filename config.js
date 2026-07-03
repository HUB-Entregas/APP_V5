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
  API_URL: 'https://script.google.com/macros/s/AKfycbynIU9FuuGiTFMu7lJBVZYaOtfpvyTNt1QwbpDA99VqeVpMf6Ex8SgKG_aPiVx94KGi/exec',
  TOKEN: 'HUB-ENTREGAS',
  MOTORISTAS: [
    { nome: 'Mello', senha: '0327' },
    { nome: 'Vinicius', senha: '9205' },
    { nome: 'Said', senha: '4771' },
    { nome: 'Matheus Silva', senha: '5840' },
    { nome: 'Joao', senha: '1551' },
    { nome: 'Thales', senha: '5824' },
    { nome: 'Bruno', senha: '1654' },
    { nome: 'Pedro', senha: '3277' }
  ]
};
