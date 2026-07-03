// Senha fica só em memória (nunca salva no navegador) — ao atualizar
// a página, o administrador precisa entrar de novo. É intencional.
let senhaAtual = null;
let registrosCache = [];

function el(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatarData(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function buscarComprovantes(senha) {
  const url = `${CONFIG.API_URL}?acao=listar&senha=${encodeURIComponent(senha)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

async function fazerLogin() {
  const senha = el('senhaInput').value;
  if (!senha) return;
  const botao = el('btnEntrar');
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  el('loginErro').classList.add('hidden');

  try {
    const data = await buscarComprovantes(senha);
    if (data.status !== 'ok') {
      mostrarErroLogin(data.message || 'Senha incorreta.');
      return;
    }
    senhaAtual = senha;
    registrosCache = data.registros;
    mostrarPainel();
  } catch (err) {
    mostrarErroLogin('Não foi possível conectar. Verifique sua internet e a URL configurada em config.js.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

function mostrarErroLogin(msg) {
  const erro = el('loginErro');
  erro.textContent = msg;
  erro.classList.remove('hidden');
}

function mostrarPainel() {
  el('telaLogin').classList.add('hidden');
  el('telaPainel').classList.remove('hidden');
  el('btnSair').classList.remove('hidden');
  renderTabela(registrosCache);
}

function sair() {
  senhaAtual = null;
  registrosCache = [];
  el('senhaInput').value = '';
  el('busca').value = '';
  el('telaPainel').classList.add('hidden');
  el('btnSair').classList.add('hidden');
  el('loginErro').classList.add('hidden');
  el('telaLogin').classList.remove('hidden');
}

async function atualizar() {
  if (!senhaAtual) return;
  const botao = el('btnAtualizar');
  botao.disabled = true;
  botao.textContent = 'Atualizando…';
  try {
    const data = await buscarComprovantes(senhaAtual);
    if (data.status === 'ok') {
      registrosCache = data.registros;
      renderTabela(filtrarPorBusca(registrosCache));
    }
  } catch (err) {
    // sem internet no momento — mantém a última lista carregada na tela
  } finally {
    botao.disabled = false;
    botao.textContent = '🔄 Atualizar';
  }
}

function filtrarPorBusca(lista) {
  const termo = el('busca').value.trim().toLowerCase();
  if (!termo) return lista;
  return lista.filter((r) =>
    (r.recebedor || '').toLowerCase().includes(termo) ||
    (r.motorista || '').toLowerCase().includes(termo)
  );
}

function botaoFinalizado(r) {
  const finalizado = !!r.finalizado;
  const semId = !r.id;
  const atributos = semId ? 'disabled title="Comprovante antigo sem ID — não pode ser atualizado"' : '';
  return `<button type="button" class="btn-finalizar ${finalizado ? 'is-finalizado' : ''}" data-id="${escapeHtml(r.id)}" data-finalizado="${finalizado}" ${atributos}>${finalizado ? '✔ Finalizado' : 'Finalizado'}</button>`;
}

function renderTabela(lista) {
  const corpo = el('tabelaCorpo');
  const vazio = el('vazioAviso');
  el('contagem').textContent = `${lista.length} comprovante(s)`;
  corpo.innerHTML = '';

  if (lista.length === 0) {
    vazio.classList.remove('hidden');
    return;
  }
  vazio.classList.add('hidden');

  const linhas = lista.map((r) => `
    <tr>
      <td>${formatarData(r.dataHora)}</td>
      <td>${escapeHtml(r.motorista)}</td>
      <td>${escapeHtml(r.recebedor)}</td>
      <td>${escapeHtml(r.observacao)}</td>
      <td>${r.fotoPacoteImg ? `<img src="${escapeHtml(r.fotoPacoteImg)}" class="miniatura" data-foto="${escapeHtml(r.fotoPacoteImg)}" alt="Foto do pacote de ${escapeHtml(r.recebedor)}" loading="lazy">` : '—'}</td>
      <td>${r.fotoFachadaImg ? `<img src="${escapeHtml(r.fotoFachadaImg)}" class="miniatura" data-foto="${escapeHtml(r.fotoFachadaImg)}" alt="Foto da fachada de ${escapeHtml(r.recebedor)}" loading="lazy">` : '—'}</td>
      <td>${botaoFinalizado(r)}</td>
    </tr>`).join('');
  corpo.innerHTML = linhas;
}

function abrirFoto(url) {
  if (!url) return;
  el('modalImg').src = url;
  el('modalFoto').classList.remove('hidden');
}

function fecharFoto() {
  el('modalFoto').classList.add('hidden');
  el('modalImg').src = '';
}

async function toggleFinalizado(id, novoValor) {
  if (!id) return;
  atualizarFinalizadoLocal(id, novoValor); // atualiza a tela na hora
  try {
    const resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao: 'finalizar', senha: senhaAtual, id, valor: novoValor })
    });
    const data = await resp.json();
    if (data.status !== 'ok') {
      atualizarFinalizadoLocal(id, !novoValor); // reverte se falhou
      alert(data.message || 'Não foi possível atualizar. Tente novamente.');
    }
  } catch (err) {
    atualizarFinalizadoLocal(id, !novoValor); // reverte se ficou offline
    alert('Sem conexão no momento. Tente novamente.');
  }
}

function atualizarFinalizadoLocal(id, valor) {
  const registro = registrosCache.find((r) => r.id === id);
  if (registro) registro.finalizado = valor;
  renderTabela(filtrarPorBusca(registrosCache));
}

window.addEventListener('DOMContentLoaded', () => {
  el('btnEntrar').addEventListener('click', fazerLogin);
  el('senhaInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') fazerLogin(); });
  el('btnSair').addEventListener('click', sair);
  el('btnAtualizar').addEventListener('click', atualizar);
  el('busca').addEventListener('input', () => renderTabela(filtrarPorBusca(registrosCache)));
  el('senhaInput').focus();

  // delegação de eventos: clique na miniatura abre o modal,
  // clique no botão alterna o status de finalizado
  el('tabelaCorpo').addEventListener('click', (e) => {
    const img = e.target.closest('.miniatura');
    if (img) { abrirFoto(img.dataset.foto); return; }
    const btn = e.target.closest('.btn-finalizar');
    if (btn && !btn.disabled) {
      toggleFinalizado(btn.dataset.id, btn.dataset.finalizado !== 'true');
    }
  });

  el('modalFechar').addEventListener('click', fecharFoto);
  el('modalFoto').addEventListener('click', (e) => {
    if (e.target === el('modalFoto')) fecharFoto(); // clicou fora da imagem
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharFoto();
  });
});
