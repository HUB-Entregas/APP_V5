// Senha fica só em memória (nunca salva no navegador) — ao atualizar
// a página, o administrador precisa entrar de novo. É intencional.
let senhaAtual = null;
let registrosCache = [];
let listaRenderizada = []; // última lista mostrada na tabela (base p/ o modal)

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
  listaRenderizada = lista;
  const corpo = el('tabelaCorpo');
  const vazio = el('vazioAviso');
  el('contagem').textContent = `${lista.length} comprovante(s)`;
  corpo.innerHTML = '';

  if (lista.length === 0) {
    vazio.classList.remove('hidden');
    return;
  }
  vazio.classList.add('hidden');

  const linhas = lista.map((r, i) => `
    <tr>
      <td>${formatarData(r.dataHora)}</td>
      <td>${escapeHtml(r.motorista)}</td>
      <td>${escapeHtml(r.recebedor)}</td>
      <td>${escapeHtml(r.observacao)}</td>
      <td>${r.fotoPacoteImg ? `<img src="${escapeHtml(r.fotoPacoteImg)}" class="miniatura" data-idx="${i}" data-tipo="pacote" alt="Foto do pacote de ${escapeHtml(r.recebedor)}" loading="lazy">` : '—'}</td>
      <td>${r.fotoFachadaImg ? `<img src="${escapeHtml(r.fotoFachadaImg)}" class="miniatura" data-idx="${i}" data-tipo="fachada" alt="Foto da fachada de ${escapeHtml(r.recebedor)}" loading="lazy">` : '—'}</td>
      <td>${botaoFinalizado(r)}</td>
    </tr>`).join('');
  corpo.innerHTML = linhas;
}

// ---------- modal de fotos (galeria pacote/fachada + zoom) ----------
let modalFotos = [];   // [{ url, legenda }] do comprovante aberto
let modalIndice = 0;
let zoom = 1, panX = 0, panY = 0;
let arrastando = false, arrasteOrigem = null, arrastou = false;

function abrirModal(registro, tipoInicial) {
  modalFotos = [];
  if (registro.fotoPacoteImg) modalFotos.push({ url: registro.fotoPacoteImg, legenda: 'Foto do pacote' });
  if (registro.fotoFachadaImg) modalFotos.push({ url: registro.fotoFachadaImg, legenda: 'Foto da fachada' });
  if (modalFotos.length === 0) return;

  const inicial = modalFotos.findIndex((f) => f.legenda.toLowerCase().includes(tipoInicial));
  modalIndice = inicial >= 0 ? inicial : 0;

  el('modalRecebedor').textContent = registro.recebedor || '(sem recebedor)';
  el('modalMeta').textContent = `${registro.motorista || '—'} · ${formatarData(registro.dataHora)}`;
  const obs = el('modalObs');
  obs.textContent = registro.observacao || '';
  obs.classList.toggle('hidden', !registro.observacao);

  mostrarFotoAtual();
  el('modalFoto').classList.remove('hidden');
}

function mostrarFotoAtual() {
  const foto = modalFotos[modalIndice];
  el('modalImg').src = foto.url;
  el('modalLegenda').textContent = `${foto.legenda} — ${modalIndice + 1}/${modalFotos.length}`;
  const temVarias = modalFotos.length > 1;
  el('modalAnterior').classList.toggle('hidden', !temVarias);
  el('modalProximo').classList.toggle('hidden', !temVarias);
  resetarZoom();
}

function navegarFoto(delta) {
  if (modalFotos.length < 2) return;
  modalIndice = (modalIndice + delta + modalFotos.length) % modalFotos.length;
  mostrarFotoAtual();
}

function resetarZoom() {
  zoom = 1; panX = 0; panY = 0;
  el('modalImg').classList.remove('is-zoom');
  aplicarTransform();
}

function aplicarTransform() {
  el('modalImg').style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function alternarZoom() {
  if (zoom === 1) {
    zoom = 2.5;
    el('modalImg').classList.add('is-zoom');
    aplicarTransform();
  } else {
    resetarZoom();
  }
}

function fecharFoto() {
  el('modalFoto').classList.add('hidden');
  el('modalImg').src = '';
  resetarZoom();
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
    if (img) {
      const registro = listaRenderizada[Number(img.dataset.idx)];
      if (registro) abrirModal(registro, img.dataset.tipo);
      return;
    }
    const btn = e.target.closest('.btn-finalizar');
    if (btn && !btn.disabled) {
      toggleFinalizado(btn.dataset.id, btn.dataset.finalizado !== 'true');
    }
  });

  // --- controles do modal ---
  el('modalFechar').addEventListener('click', fecharFoto);
  el('modalAnterior').addEventListener('click', () => navegarFoto(-1));
  el('modalProximo').addEventListener('click', () => navegarFoto(1));

  // clicar no fundo (fora da imagem/setas) fecha
  el('modalPalco').addEventListener('click', (e) => {
    if (e.target === el('modalPalco')) fecharFoto();
  });

  // zoom por clique + arrastar para mover quando ampliado (mouse e toque)
  const modalImg = el('modalImg');
  modalImg.addEventListener('pointerdown', (e) => {
    arrastando = true;
    arrastou = false;
    arrasteOrigem = { x: e.clientX - panX, y: e.clientY - panY };
    modalImg.setPointerCapture(e.pointerId);
  });
  modalImg.addEventListener('pointermove', (e) => {
    if (!arrastando || zoom === 1) return;
    panX = e.clientX - arrasteOrigem.x;
    panY = e.clientY - arrasteOrigem.y;
    arrastou = true;
    aplicarTransform();
  });
  modalImg.addEventListener('pointerup', () => {
    arrastando = false;
    if (!arrastou) alternarZoom(); // clique simples (sem arrastar) alterna o zoom
  });

  // teclado: Esc fecha, setas trocam de foto
  window.addEventListener('keydown', (e) => {
    if (el('modalFoto').classList.contains('hidden')) return;
    if (e.key === 'Escape') fecharFoto();
    else if (e.key === 'ArrowLeft') navegarFoto(-1);
    else if (e.key === 'ArrowRight') navegarFoto(1);
  });
});
