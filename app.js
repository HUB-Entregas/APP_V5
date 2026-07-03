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

let fotoPacoteBase64 = '';
let fotoFachadaBase64 = '';
let sincronizando = false;

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

async function contarPendentes() {
  const lista = await listarComprovantesLocais();
  return lista.filter((r) => r.status === 'pendente').length;
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

async function handleFotoSelecionada(tipo, e) {
  const file = e.target.files[0];
  if (!file) return;
  const rotulo = el(tipo === 'pacote' ? 'fotoPacoteRotulo' : 'fotoFachadaRotulo');
  const preview = el(tipo === 'pacote' ? 'fotoPacotePreview' : 'fotoFachadaPreview');
  const textoOriginal = tipo === 'pacote' ? 'Tirar foto do pacote' : 'Tirar foto da fachada';
  rotulo.textContent = 'Processando foto…';
  try {
    const base64 = await comprimirFoto(file);
    if (tipo === 'pacote') fotoPacoteBase64 = base64; else fotoFachadaBase64 = base64;
    preview.src = base64;
    preview.classList.remove('hidden');
    rotulo.textContent = 'Foto selecionada ✓ (toque para trocar)';
  } catch (err) {
    if (tipo === 'pacote') fotoPacoteBase64 = ''; else fotoFachadaBase64 = '';
    rotulo.textContent = textoOriginal;
    mostrarAviso('Não foi possível processar essa foto. Tente novamente.');
  }
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
      await salvarComprovanteLocal(registro);
      await renderHistorico();
    } catch (err) {
      // continua tentando os próximos; este permanece pendente e será
      // retentado na próxima sincronização
    }
  }

  sincronizando = false;
  await atualizarStatusConexao();
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
  el('fotoPacoteInput').value = '';
  el('fotoPacotePreview').classList.add('hidden');
  el('fotoPacotePreview').src = '';
  el('fotoPacoteRotulo').textContent = 'Tirar foto do pacote';
  fotoPacoteBase64 = '';
  el('fotoFachadaInput').value = '';
  el('fotoFachadaPreview').classList.add('hidden');
  el('fotoFachadaPreview').src = '';
  el('fotoFachadaRotulo').textContent = 'Tirar foto da fachada';
  fotoFachadaBase64 = '';
}

// ---------- status online/offline ----------

async function atualizarStatusConexao() {
  const dot = el('statusDot');
  const texto = el('statusTexto');
  const badge = el('badgePendentes');
  const pendentes = await contarPendentes();

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
  } else if (pendentes > 0) {
    dot.className = 'dot dot-offline';
    texto.textContent = `Online — ${pendentes} pendente(s)`;
  } else {
    dot.className = 'dot dot-online';
    texto.textContent = 'Online — sincronizado';
  }
}

// ---------- histórico ----------

function carimboStatus(status) {
  return status === 'enviado'
    ? '<span class="carimbo carimbo-enviado">ENVIADO</span>'
    : '<span class="carimbo carimbo-pendente">PENDENTE</span>';
}

async function renderHistorico() {
  const lista = (await listarComprovantesLocais()).slice(0, 15);
  const container = el('listaHistorico');

  if (lista.length === 0) {
    container.innerHTML = '<p class="historico-vazio">Nenhum comprovante enviado ainda.</p>';
    return;
  }

  container.innerHTML = lista.map((r) => `
    <div class="item-historico">
      <img src="${r.fotoPacote}" alt="Foto do pacote de ${escapeHtml(r.recebedor)}" class="item-historico-foto">
      <img src="${r.fotoFachada}" alt="Foto da fachada de ${escapeHtml(r.recebedor)}" class="item-historico-foto">
      <div class="item-historico-info">
        <strong>${escapeHtml(r.recebedor)}</strong>
        <span>${escapeHtml(r.motorista)} · ${formatarData(r.timestamp)}</span>
      </div>
      ${carimboStatus(r.status)}
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

  el('formEntrega').addEventListener('submit', handleSubmit);
  el('btnSincronizar').addEventListener('click', handleSincronizarClick);

  window.addEventListener('online', () => { sincronizarPendentes(); });
  window.addEventListener('offline', () => { atualizarStatusConexao(); });
  setInterval(() => { if (navigator.onLine) sincronizarPendentes(); }, 25000);

  await renderHistorico();
  await atualizarStatusConexao();
  sincronizarPendentes();
});
