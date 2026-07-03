// LOGIN DO MOTORISTA — tela separada. O motorista escolhe o nome, digita a
// senha individual (CONFIG.MOTORISTAS em config.js) e entra. A senha só é
// conferida aqui no aparelho, não no backend — veja a nota no README.md.

function el(id) { return document.getElementById(id); }

window.addEventListener('DOMContentLoaded', () => {
  const select = el('motoristaSelect');
  const senha = el('senhaInput');
  const aviso = el('aviso');

  // popula o select com os motoristas (textContent evita qualquer HTML)
  CONFIG.MOTORISTAS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.nome;
    opt.textContent = m.nome;
    select.appendChild(opt);
  });

  el('formLogin').addEventListener('submit', (e) => {
    e.preventDefault();
    const motorista = CONFIG.MOTORISTAS.find((m) => m.nome === select.value);
    if (!motorista || senha.value !== motorista.senha) {
      aviso.textContent = 'Motorista ou senha incorretos.';
      aviso.className = 'aviso aviso-erro';
      senha.value = '';
      senha.focus();
      return;
    }
    localStorage.setItem('motoristaSelecionado', motorista.nome);
    window.location.replace('./index.html');
  });
});
