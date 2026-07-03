// APP DO MOTORISTA — fila offline (IndexedDB), fotos e sincronização.
// A fila fica gravada no IndexedDB do aparelho: cada comprovante criado aqui
// permanece salvo com status "pendente" até o envio ao backend dar certo,
// quando então vira "enviado". Isso é o que garante que nada se perde se o
// motorista fechar o app ou ficar sem internet no meio do caminho.
//
// O login do motorista (nome + senha) acontece em login.html/login.js, numa
// aba separada. Este arquivo só lê o motorista já confirmado no
// localStorage — se não houver nenhum, o próprio index.html já redireciona
// para o login antes deste script rodar.

const DB_NOME = 'ComprovantesDB';
const DB_STORE = 'comprovantes';

// Depois de tantas falhas seguidas de envio (já estando online), o comprovante
// deixa de ser só "PENDENTE" e passa a aparecer como "ERRO" para o motorista,
// evitando que um item travado fique invisível para sempre.
const MAX_TENTATIVAS_ALERTA = 3;

// Quantos comprovantes recentes o histórico mostra — e também quantos mantêm
// as fotos guardadas no celular. Comprovantes mais antigos JÁ ENVIADOS têm as
// fotos descartadas do aparelho (elas continuam salvas no Google Drive), para
// o armazenamento local não crescer sem limite. Veja podarFotosAntigas().
const HISTORICO_LIMITE = 15;

let fotoPacoteBase64 = '';
let fotoFachadaBase64 = '';
let sincronizando = false;

// câmera ao vivo (tira as 2 fotos numa tela só)
let cameraStream = null;
let cameraFila = [];   // tipos a capturar em sequência, ex: ['pacote','fachada']
let cameraTotal = 0;

// ---------- utilidades ----------

function el(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatarData(timestamp) {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return String(timestamp);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function gerarId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mostrarAviso(msg, tipo = 'erro') {
  const aviso = el('aviso');
  aviso.textContent = msg;
  aviso.classList.remove('hidden', 'aviso-erro', 'aviso-sucesso');
  aviso.classList.add(tipo === 'erro' ? 'aviso-erro' : 'aviso-sucesso');
}

function esconderAviso() {
  el('aviso').classList.add('hidden');
}

// ---------- IndexedDB ----------

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function salvarComprovanteLocal(registro) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(registro);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listarComprovantesLocais() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp - a.timestamp));
    req.onerror = () => reject(req.error);
  });
}


// ---------- motorista (já autenticado em login.html) ----------

function motoristaSelecionadoAtual() {
  return localStorage.getItem('motoristaSelecionado') || '';
}

function mostrarMotoristaAtual(nome) {
  el('motoristaAtualNome').textContent = nome;
}

// ---------- fotos ----------

function criarImagemDeArquivo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function comprimirFoto(file, maxLargura = 1400, qualidade = 0.72) {
  let imagem;
  try {
    imagem = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    imagem = await criarImagemDeArquivo(file);
  }
  const escala = Math.min(1, maxLargura / imagem.width);
  const largura = Math.round(imagem.width * escala);
  const altura = Math.round(imagem.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext('2d').drawImage(imagem, 0, 0, largura, altura);
  return canvas.toDataURL('image/jpeg', qualidade);
}

const NOME_FOTO = { pacote: 'Pacote', fachada: 'Fachada' };

// guarda a foto no estado e preenche o slot (miniatura + selo verde via CSS)
function aplicarFoto(tipo, base64) {
  if (tipo === 'pacote') fotoPacoteBase64 = base64; else fotoFachadaBase64 = base64;
  el(tipo === 'pacote' ? 'fotoPacotePreview' : 'fotoFachadaPreview').src = base64;
  el(tipo === 'pacote' ? 'slotPacote' : 'slotFachada').classList.add('foto-slot-cheio');
}

function resetarSlotFoto(tipo) {
  if (tipo === 'pacote') fotoPacoteBase64 = ''; else fotoFachadaBase64 = '';
  el(tipo === 'pacote' ? 'fotoPacotePreview' : 'fotoFachadaPreview').src = '';
  el(tipo === 'pacote' ? 'slotPacote' : 'slotFachada').classList.remove('foto-slot-cheio');
  el(tipo === 'pacote' ? 'fotoPacoteInput' : 'fotoFachadaInput').value = '';
}

// caminho de fallback: seletor/câmera nativos do sistema (input file)
async function handleFotoSelecionada(tipo, e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    aplicarFoto(tipo, await comprimirFoto(file));
  } catch (err) {
    resetarSlotFoto(tipo);
    mostrarAviso('Não foi possível processar essa foto. Tente novamente.');
  }
}

// ---------- câmera ao vivo ----------

async function abrirCamera(tipos) {
  cameraFila = tipos.slice();
  cameraTotal = tipos.length;

  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    return abrirFallbackNativo();
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
  } catch (err) {
    return abrirFallbackNativo(); // sem permissão/câmera: cai no seletor nativo
  }

  const video = el('cameraVideo');
  video.srcObject = cameraStream;
  el('cameraOverlay').classList.remove('hidden');
  atualizarRotuloCamera();
  try { await video.play(); } catch (e) { /* alguns navegadores já dão play sozinho */ }
}

function abrirFallbackNativo() {
  const tipo = cameraFila[0];
  cameraFila = [];
  el(tipo === 'pacote' ? 'fotoPacoteInput' : 'fotoFachadaInput').click();
}

function atualizarRotuloCamera() {
  const tipo = cameraFila[0];
  const indice = cameraTotal - cameraFila.length + 1;
  const passo = cameraTotal > 1 ? `Foto ${indice} de ${cameraTotal} — ` : '';
  el('cameraRotulo').textContent = `${passo}${NOME_FOTO[tipo]}`;
}

function capturarFrameComprimido(video, maxLargura = 1400, qualidade = 0.72) {
  const escala = Math.min(1, maxLargura / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * escala);
  canvas.height = Math.round(video.videoHeight * escala);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', qualidade);
}

function dispararFoto() {
  const video = el('cameraVideo');
  if (!video.videoWidth) return; // vídeo ainda não pronto
  const tipo = cameraFila.shift();
  aplicarFoto(tipo, capturarFrameComprimido(video));
  if (cameraFila.length === 0) fecharCamera();
  else atualizarRotuloCamera();
}

function fecharCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  el('cameraVideo').srcObject = null;
  el('cameraOverlay').classList.add('hidden');
  cameraFila = [];
}

// ---------- envio e sincronização ----------

async function enviarAoBackend(registro) {
  const resp = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: CONFIG.TOKEN,
      id: registro.id,
      motorista: registro.motorista,
      recebedor: registro.recebedor,
      observacao: registro.observacao,
      fotoPacote: registro.fotoPacote,
      fotoFachada: registro.fotoFachada,
      timestamp: registro.timestamp
    })
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  if (data.status !== 'ok') throw new Error(data.message || 'Falha no envio');
}

async function sincronizarPendentes() {
  if (sincronizando || !navigator.onLine) return;
  sincronizando = true;
  await atualizarStatusConexao();

  const pendentes = (await listarComprovantesLocais()).filter((r) => r.status === 'pendente');
  for (const registro of pendentes) {
    try {
      await enviarAoBackend(registro);
      registro.status = 'enviado';
      registro.ultimoErro = '';
      await salvarComprovanteLocal(registro);
      await renderHistorico();
    } catch (err) {
      // registra a falha (para ficar visível ao motorista) e continua com os
      // próximos; este permanece pendente e será retentado depois
      registro.tentativas = (registro.tentativas || 0) + 1;
      registro.ultimoErro = String((err && err.message) || err);
      await salvarComprovanteLocal(registro);
      await renderHistorico();
    }
  }

  await podarFotosAntigas();

  sincronizando = false;
  await atualizarStatusConexao();
}

// Mantém as fotos apenas dos comprovantes mais recentes (os que aparecem no
// histórico). Nos mais antigos que JÁ FORAM ENVIADOS, descarta as fotos base64
// do aparelho — elas já estão salvas no Google Drive —, deixando só os
// metadados. Assim o armazenamento local não cresce sem limite.
// Nunca mexe em pendentes/erro: esses ainda precisam da foto para enviar.
async function podarFotosAntigas() {
  const lista = await listarComprovantesLocais(); // mais recentes primeiro
  for (let i = HISTORICO_LIMITE; i < lista.length; i++) {
    const r = lista[i];
    if (r.status === 'enviado' && (r.fotoPacote || r.fotoFachada)) {
      r.fotoPacote = '';
      r.fotoFachada = '';
      r.fotosPodadas = true;
      await salvarComprovanteLocal(r);
    }
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  esconderAviso();

  const motorista = motoristaSelecionadoAtual();
  const recebedor = el('recebedor').value.trim();
  const observacao = el('observacao').value.trim();

  if (!motorista) return mostrarAviso('Selecione o motorista antes de enviar.');
  if (!recebedor) return mostrarAviso('Preencha o nome do recebedor.');
  if (!fotoPacoteBase64) return mostrarAviso('Tire a foto do pacote.');
  if (!fotoFachadaBase64) return mostrarAviso('Tire a foto da fachada.');

  const registro = {
    id: gerarId(),
    motorista,
    recebedor,
    observacao,
    fotoPacote: fotoPacoteBase64,
    fotoFachada: fotoFachadaBase64,
    timestamp: Date.now(),
    status: 'pendente'
  };

  await salvarComprovanteLocal(registro);
  resetarFormulario();
  await renderHistorico();
  sincronizarPendentes();
}

function resetarFormulario() {
  el('recebedor').value = '';
  el('observacao').value = '';
  resetarSlotFoto('pacote');
  resetarSlotFoto('fachada');
}

// ---------- status online/offline ----------

async function atualizarStatusConexao() {
  const dot = el('statusDot');
  const texto = el('statusTexto');
  const badge = el('badgePendentes');
  const lista = await listarComprovantesLocais();
  const pendentes = lista.filter((r) => r.status === 'pendente').length;
  const comProblema = lista.filter((r) => comErro(r)).length;

  if (pendentes > 0) {
    badge.textContent = String(pendentes);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (!navigator.onLine) {
    dot.className = 'dot dot-offline';
    texto.textContent = pendentes > 0 ? `Offline — ${pendentes} pendente(s)` : 'Offline';
  } else if (sincronizando) {
    dot.className = 'dot dot-offline';
    texto.textContent = 'Sincronizando…';
  } else if (comProblema > 0) {
    dot.className = 'dot dot-erro';
    texto.textContent = `⚠️ ${comProblema} com problema`;
  } else if (pendentes > 0) {
    dot.className = 'dot dot-offline';
    texto.textContent = `Online — ${pendentes} pendente(s)`;
  } else {
    dot.className = 'dot dot-online';
    texto.textContent = 'Online — sincronizado';
  }
}

// ---------- histórico ----------

function comErro(r) {
  return r.status !== 'enviado' && (r.tentativas || 0) >= MAX_TENTATIVAS_ALERTA;
}

function carimboStatus(r) {
  if (r.status === 'enviado') return '<span class="carimbo carimbo-enviado">ENVIADO</span>';
  if (comErro(r)) return '<span class="carimbo carimbo-erro">ERRO</span>';
  return '<span class="carimbo carimbo-pendente">PENDENTE</span>';
}

// Miniatura da foto no histórico; se a foto já foi podada do aparelho,
// mostra um quadradinho vazio no lugar (a foto segue salva no Drive).
function fotoMini(src, alt) {
  return src
    ? `<img src="${src}" alt="${escapeHtml(alt)}" class="item-historico-foto">`
    : `<span class="item-historico-foto item-historico-foto-vazia" title="Foto arquivada (salva no Drive)"></span>`;
}

async function renderHistorico() {
  const lista = (await listarComprovantesLocais()).slice(0, HISTORICO_LIMITE);
  const container = el('listaHistorico');

  if (lista.length === 0) {
    container.innerHTML = '<p class="historico-vazio">Nenhum comprovante enviado ainda.</p>';
    return;
  }

  container.innerHTML = lista.map((r) => `
    <div class="item-historico ${comErro(r) ? 'item-historico-erro' : ''}">
      ${fotoMini(r.fotoPacote, 'Foto do pacote de ' + r.recebedor)}
      ${fotoMini(r.fotoFachada, 'Foto da fachada de ' + r.recebedor)}
      <div class="item-historico-info">
        <strong>${escapeHtml(r.recebedor)}</strong>
        <span>${escapeHtml(r.motorista)} · ${formatarData(r.timestamp)}</span>
        ${comErro(r) ? `<span class="item-historico-erro-msg">Falha ao enviar: ${escapeHtml(r.ultimoErro)}</span>
        <button type="button" class="btn-tentar" data-id="${escapeHtml(r.id)}">Tentar de novo</button>` : ''}
      </div>
      ${carimboStatus(r)}
    </div>`).join('');
}

async function handleSincronizarClick() {
  const botao = el('btnSincronizar');
  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = 'Sincronizando…';
  await sincronizarPendentes();
  await renderHistorico();
  botao.disabled = false;
  botao.textContent = textoOriginal;
}

async function tentarNovamente(id) {
  const registros = await listarComprovantesLocais();
  const registro = registros.find((r) => r.id === id);
  if (!registro || registro.status === 'enviado') return;
  // zera o contador para dar feedback imediato (sai do estado de "ERRO")
  registro.tentativas = 0;
  registro.ultimoErro = '';
  await salvarComprovanteLocal(registro);
  await renderHistorico();
  await atualizarStatusConexao();
  sincronizarPendentes();
}

// ---------- inicialização ----------

window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
  }

  mostrarMotoristaAtual(motoristaSelecionadoAtual());

  el('trocarMotorista').addEventListener('click', () => {
    localStorage.removeItem('motoristaSelecionado');
    window.location.href = './login.html';
  });

  el('fotoPacoteInput').addEventListener('change', (e) => handleFotoSelecionada('pacote', e));
  el('fotoFachadaInput').addEventListener('change', (e) => handleFotoSelecionada('fachada', e));

  // câmera ao vivo: o botão tira as 2 fotos em sequência; tocar num slot
  // refaz só aquela foto
  el('btnCamera').addEventListener('click', () => abrirCamera(['pacote', 'fachada']));
  el('slotPacote').addEventListener('click', () => abrirCamera(['pacote']));
  el('slotFachada').addEventListener('click', () => abrirCamera(['fachada']));
  el('cameraDisparo').addEventListener('click', dispararFoto);
  el('cameraFechar').addEventListener('click', fecharCamera);

  el('formEntrega').addEventListener('submit', handleSubmit);
  el('btnSincronizar').addEventListener('click', handleSincronizarClick);

  // delegação: botão "Tentar de novo" nos itens em erro
  el('listaHistorico').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-tentar');
    if (btn) tentarNovamente(btn.dataset.id);
  });

  window.addEventListener('online', () => { sincronizarPendentes(); });
  window.addEventListener('offline', () => { atualizarStatusConexao(); });
  setInterval(() => { if (navigator.onLine) sincronizarPendentes(); }, 25000);

  await renderHistorico();
  await atualizarStatusConexao();
  sincronizarPendentes();
});
