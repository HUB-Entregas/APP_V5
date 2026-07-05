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

// Empresa da entrega ATUAL (Imille/Anjun). Zera a cada envio de propósito:
// o motorista pode alternar entre as duas no mesmo dia, então precisa
// informar em toda entrega — assim nunca sai registrado na empresa errada.
let empresaSelecionada = '';

// câmera ao vivo (tira as 2 fotos numa tela só)
let cameraStream = null;
let cameraFila = [];   // tipos a capturar em sequência, ex: ['pacote','fachada']
let cameraTotal = 0;
let flashLigado = false;

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


// ---------- empresa da entrega ----------

function selecionarEmpresa(nome) {
  empresaSelecionada = nome;
  document.querySelectorAll('.btn-empresa').forEach((b) => {
    b.classList.toggle('selecionada', b.dataset.empresa === nome);
  });
}

function limparEmpresa() {
  empresaSelecionada = '';
  document.querySelectorAll('.btn-empresa').forEach((b) => b.classList.remove('selecionada'));
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
    // se ainda falta foto na fila do fallback, abre a próxima direto
    if (fallbackFila.length > 0) {
      const proximo = fallbackFila.shift();
      el(proximo === 'pacote' ? 'fotoPacoteInput' : 'fotoFachadaInput').click();
    }
  } catch (err) {
    fallbackFila = [];
    resetarSlotFoto(tipo);
    mostrarAviso('Não foi possível processar essa foto. Tente novamente.');
  }
}

// ---------- câmera ao vivo ----------
// Em Android com várias lentes, o navegador às vezes abre a ULTRA-WIDE (a
// "0.5x") — que além do enquadramento errado normalmente NÃO tem flash. Por
// isso: (1) se a câmera abrir com zoom < 1x, forçamos 1x (lente principal);
// (2) há um botão 🔁 para trocar de lente manualmente, e a escolha fica salva;
// (3) zoom nunca desce abaixo de 1x (não cai na ultra-wide sem querer).

let camerasDisponiveis = []; // câmeras traseiras [{id, label}] p/ o botão 🔁

function pegarTrackVideo() {
  return cameraStream && cameraStream.getVideoTracks ? cameraStream.getVideoTracks()[0] : null;
}

function capacidadesTrack() {
  const track = pegarTrackVideo();
  try { return (track && track.getCapabilities) ? (track.getCapabilities() || {}) : {}; }
  catch (e) { return {}; }
}

async function obterStream() {
  // 1º tenta a lente que o motorista escolheu da última vez; senão, a traseira
  const salvo = localStorage.getItem('cameraDeviceId');
  const tentativas = [];
  if (salvo) {
    tentativas.push({ video: { deviceId: { exact: salvo }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  }
  tentativas.push({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  for (const c of tentativas) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch (err) { /* tenta a próxima */ }
  }
  return null;
}

async function abrirCamera(tipos) {
  cameraFila = tipos.slice();
  cameraTotal = tipos.length;

  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    return abrirFallbackNativo();
  }
  cameraStream = await obterStream();
  if (!cameraStream) {
    return abrirFallbackNativo(); // sem permissão/câmera: cai no seletor nativo
  }

  const video = el('cameraVideo');
  video.srcObject = cameraStream;
  el('cameraOverlay').classList.remove('hidden');
  atualizarRotuloCamera();
  try { await video.play(); } catch (e) { /* alguns navegadores já dão play sozinho */ }
  await configurarLenteEControles();
}

// Ajusta a lente e monta os controles (zoom/foco/flash/trocar) para o stream atual.
async function configurarLenteEControles() {
  const caps = capacidadesTrack();

  // câmera "lógica" que abre no 0.5x (ultra-wide): volta para a principal (1x)
  if (caps.zoom && caps.zoom.min < 1) {
    try {
      await pegarTrackVideo().applyConstraints({ advanced: [{ zoom: Math.min(1, caps.zoom.max) }] });
    } catch (e) { /* aparelho não deixou — segue como está */ }
  }

  configurarZoomUI(caps);
  configurarFoco(caps);
  configurarFlash();
  await listarCamerasTraseiras();
  el('cameraTrocar').classList.toggle('hidden', camerasDisponiveis.length < 2);
}

// ---------- trocar de lente (🔁) ----------

async function listarCamerasTraseiras() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const videos = devs.filter((d) => d.kind === 'videoinput');
    // descarta as frontais pelo rótulo; se os rótulos vierem vazios, mantém todas
    const traseiras = videos.filter((d) => !/front|frontal|user|selfie/i.test(d.label || ''));
    camerasDisponiveis = (traseiras.length ? traseiras : videos).map((d) => ({ id: d.deviceId, label: d.label || '' }));
  } catch (e) {
    camerasDisponiveis = [];
  }
}

async function trocarCamera() {
  if (camerasDisponiveis.length < 2) return;
  const track = pegarTrackVideo();
  const atualId = (track && track.getSettings) ? (track.getSettings().deviceId || '') : '';
  let idx = camerasDisponiveis.findIndex((c) => c.id === atualId);
  idx = (idx + 1) % camerasDisponiveis.length;
  const alvo = camerasDisponiveis[idx];

  if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: alvo.id }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
  } catch (err) {
    fecharCamera();
    mostrarAviso('Não foi possível trocar de câmera.');
    return;
  }
  localStorage.setItem('cameraDeviceId', alvo.id); // lembra a lente escolhida
  const video = el('cameraVideo');
  video.srcObject = cameraStream;
  try { await video.play(); } catch (e) { }
  await configurarLenteEControles();
}

// ---------- zoom ----------

function configurarZoomUI(caps) {
  const wrap = el('cameraZoomWrap');
  const slider = el('cameraZoom');
  if (!caps.zoom || !(caps.zoom.max > 1)) { wrap.classList.add('hidden'); return; }
  // nunca abaixo de 1x — impede cair na ultra-wide pelo zoom
  const min = Math.max(1, caps.zoom.min);
  slider.min = String(min);
  slider.max = String(caps.zoom.max);
  slider.step = String(caps.zoom.step || 0.1);
  slider.value = String(min);
  el('cameraZoomValor').textContent = formatarZoom(min);
  wrap.classList.remove('hidden');
}

function formatarZoom(v) {
  return (Math.round(v * 10) / 10).toString().replace(/\.0$/, '') + 'x';
}

async function aplicarZoom(valor) {
  const track = pegarTrackVideo();
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ zoom: valor }] });
    el('cameraZoomValor').textContent = formatarZoom(valor);
  } catch (e) { /* aparelho não deixou — mantém o zoom atual */ }
}

// ---------- foco por toque ----------

function configurarFoco(caps) {
  // liga o foco contínuo por padrão, quando o aparelho expõe esse controle
  if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
    try { pegarTrackVideo().applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { }
  }
}

async function focarNoPonto(e) {
  const video = el('cameraVideo');
  if (!video.videoWidth) return;
  mostrarIndicadorFoco(e.clientX, e.clientY);

  const track = pegarTrackVideo();
  if (!track) return;
  const caps = capacidadesTrack();
  const rect = video.getBoundingClientRect();
  const ajustes = [];
  if (caps.pointsOfInterest) {
    ajustes.push({ pointsOfInterest: [{ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }] });
  }
  if (caps.focusMode && caps.focusMode.indexOf('single-shot') >= 0) {
    ajustes.push({ focusMode: 'single-shot' });
  }
  if (!ajustes.length) return; // aparelho não expõe foco — o indicador já deu o feedback
  try { await track.applyConstraints({ advanced: ajustes }); } catch (err) { }
  // depois de focar no ponto, volta ao foco contínuo
  setTimeout(() => {
    try {
      if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch (err) { }
  }, 3000);
}

let focoTimer = null;
function mostrarIndicadorFoco(x, y) {
  const ind = el('focoIndicador');
  ind.style.left = (x - 32) + 'px';
  ind.style.top = (y - 32) + 'px';
  ind.classList.remove('hidden');
  ind.classList.remove('foco-anima');
  void ind.offsetWidth; // reinicia a animação CSS
  ind.classList.add('foco-anima');
  clearTimeout(focoTimer);
  focoTimer = setTimeout(() => ind.classList.add('hidden'), 900);
}

// ---------- flash (lanterna do celular) ----------
// Só funciona onde o navegador expõe o "torch" da câmera (Android/Chrome) — e
// só na lente que TEM flash (a principal; a ultra-wide normalmente não tem).
// Em alguns aparelhos as capacidades demoram a aparecer depois do play(), por
// isso a verificação roda de novo um instante depois.

function configurarFlash() {
  flashLigado = false;
  el('cameraFlash').classList.remove('flash-ligado');
  verificarSuporteFlash();
  setTimeout(verificarSuporteFlash, 800); // capacidades podem chegar atrasadas
}

function verificarSuporteFlash() {
  if (!cameraStream) return; // câmera já fechada
  const btn = el('cameraFlash');
  const suporta = !!capacidadesTrack().torch;
  btn.classList.toggle('hidden', !suporta);
  // reaplica a preferência salva (o motorista não precisa religar toda vez)
  if (suporta && !flashLigado && localStorage.getItem('flashLigado') === '1') {
    aplicarFlash(true);
  }
}

async function aplicarFlash(ligar) {
  const track = pegarTrackVideo();
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: ligar }] });
    flashLigado = ligar;
    el('cameraFlash').classList.toggle('flash-ligado', ligar);
    localStorage.setItem('flashLigado', ligar ? '1' : '0');
  } catch (err) {
    // aparelho não deixou mudar o flash — ignora
  }
}

function alternarFlash() {
  aplicarFlash(!flashLigado);
}

// fila do fallback: se a câmera nativa for usada para mais de uma foto,
// a próxima é aberta automaticamente quando a anterior é escolhida
let fallbackFila = [];

function abrirFallbackNativo() {
  const tipo = cameraFila[0];
  fallbackFila = cameraFila.slice(1);
  cameraFila = [];
  el(tipo === 'pacote' ? 'fotoPacoteInput' : 'fotoFachadaInput').click();
}

function atualizarRotuloCamera() {
  const tipo = cameraFila[0];
  const indice = cameraTotal - cameraFila.length + 1;
  const passo = cameraTotal > 1 ? `Foto ${indice} de ${cameraTotal} — ` : '';
  el('cameraRotulo').textContent = `${passo}${NOME_FOTO[tipo]}`;
  atualizarProgressoCamera();
}

// Chips 📦/🏠 no topo da câmera: o ATUAL pulsa em amarelo; o já tirado mostra
// a miniatura real + ✓. Só aparece quando a sessão é das 2 fotos.
function atualizarProgressoCamera() {
  const strip = el('cameraProgresso');
  if (cameraTotal < 2) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  [['pacote', 'progPacote', 'progPacoteImg'], ['fachada', 'progFachada', 'progFachadaImg']].forEach(([tipo, idChip, idImg]) => {
    const chip = el(idChip);
    const feita = !cameraFila.includes(tipo); // já saiu da fila = já capturada
    chip.classList.toggle('cam-prog-feita', feita);
    chip.classList.toggle('cam-prog-atual', cameraFila[0] === tipo);
    el(idImg).src = feita ? (tipo === 'pacote' ? fotoPacoteBase64 : fotoFachadaBase64) : '';
  });
}

// piscar branco rápido — feedback imediato de que a foto foi capturada
let blinkTimer = null;
function piscarCaptura() {
  const blink = el('cameraBlink');
  blink.classList.remove('hidden');
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => blink.classList.add('hidden'), 250);
}

function capturarFrameComprimido(video, maxLargura = 1400, qualidade = 0.72) {
  const escala = Math.min(1, maxLargura / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * escala);
  canvas.height = Math.round(video.videoHeight * escala);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', qualidade);
}

let ultimoDisparoTs = 0;

function dispararFoto() {
  const video = el('cameraVideo');
  if (!video.videoWidth) return; // vídeo ainda não pronto
  // toque duplo acidental no obturador capturaria as 2 fotos com o MESMO
  // enquadramento — ignora disparos em sequência muito rápida
  const agora = Date.now();
  if (agora - ultimoDisparoTs < 500) return;
  ultimoDisparoTs = agora;

  const tipo = cameraFila.shift();
  aplicarFoto(tipo, capturarFrameComprimido(video));
  piscarCaptura();
  if (cameraFila.length === 0) {
    // deixa o motorista VER o ✓ da última foto antes de fechar
    atualizarProgressoCamera();
    setTimeout(fecharCamera, 350);
  } else {
    atualizarRotuloCamera();
  }
}

function fecharCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop()); // apagar as tracks já desliga o flash
    cameraStream = null;
  }
  flashLigado = false;
  el('cameraFlash').classList.remove('flash-ligado');
  el('cameraVideo').srcObject = null;
  el('cameraOverlay').classList.add('hidden');
  el('cameraZoomWrap').classList.add('hidden');
  el('focoIndicador').classList.add('hidden');
  el('cameraProgresso').classList.add('hidden');
  el('cameraBlink').classList.add('hidden');
  cameraFila = [];
}

// ---------- envio e sincronização ----------

function erroAuth(msg) {
  const e = new Error(msg);
  e.authErro = true;
  return e;
}

async function enviarAoBackend(registro) {
  // o token de sessão (do login) autoriza a gravação — lido na hora do envio,
  // então os pendentes sobem com o token atual mesmo após um relogin
  const token = localStorage.getItem('authToken');
  if (!token) throw erroAuth('Sem sessão');

  // timeout: em troca de rede (Wi-Fi -> 4G) o fetch pode "pendurar" por
  // minutos; aborta e deixa a próxima sincronização tentar de novo
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let resp;
  try {
    resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: ctrl.signal,
      body: JSON.stringify({
        token: token,
        id: registro.id,
        motorista: registro.motorista,
        empresa: registro.empresa || '',
        recebedor: registro.recebedor,
        observacao: registro.observacao,
        fotoPacote: registro.fotoPacote,
        fotoFachada: registro.fotoFachada,
        timestamp: registro.timestamp
      })
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  if (data.status !== 'ok') {
    if (data.authErro) throw erroAuth(data.message || 'Sessão expirada');
    throw new Error(data.message || 'Falha no envio');
  }
}

// sessão expirada (token venceu): limpa e volta ao login. Os comprovantes
// pendentes continuam salvos e sobem depois que o motorista entrar de novo.
function irParaLogin() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('motoristaSelecionado');
  window.location.href = './login.html';
}

async function sincronizarPendentes() {
  if (sincronizando || !navigator.onLine) return;
  sincronizando = true;
  await atualizarStatusConexao();

  let sessaoExpirada = false;
  const pendentes = (await listarComprovantesLocais()).filter((r) => r.status === 'pendente');
  for (const registro of pendentes) {
    try {
      await enviarAoBackend(registro);
      registro.status = 'enviado';
      registro.ultimoErro = '';
      await salvarComprovanteLocal(registro);
      await renderHistorico();
    } catch (err) {
      // sessão expirada: não conta como "erro" do comprovante — para tudo e
      // manda relogar; os pendentes ficam salvos e sobem após o novo login
      if (err && err.authErro) { sessaoExpirada = true; break; }
      // registra a falha (para ficar visível ao motorista) e continua com os
      // próximos; este permanece pendente e será retentado depois
      registro.tentativas = (registro.tentativas || 0) + 1;
      registro.ultimoErro = String((err && err.message) || err);
      await salvarComprovanteLocal(registro);
      await renderHistorico();
    }
  }

  if (sessaoExpirada) { sincronizando = false; irParaLogin(); return; }

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

let enviando = false; // trava contra toque duplo no "Enviar" (evita duplicata)

async function handleSubmit(e) {
  e.preventDefault();
  if (enviando) return;
  esconderAviso();

  const motorista = motoristaSelecionadoAtual();
  const recebedor = el('recebedor').value.trim();
  const observacao = el('observacao').value.trim();

  if (!motorista) return mostrarAviso('Selecione o motorista antes de enviar.');
  if (!empresaSelecionada) return mostrarAviso('Toque em Imille ou Anjun para informar a empresa desta entrega.');
  if (!recebedor) return mostrarAviso('Preencha o nome do recebedor.');
  if (!fotoPacoteBase64) return mostrarAviso('Tire a foto do pacote.');
  if (!fotoFachadaBase64) return mostrarAviso('Tire a foto da fachada.');

  enviando = true;
  const botao = el('btnEnviar');
  botao.disabled = true;

  try {
    const registro = {
      id: gerarId(),
      motorista,
      empresa: empresaSelecionada,
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
  } finally {
    enviando = false;
    botao.disabled = false;
  }
}

function resetarFormulario() {
  el('recebedor').value = '';
  el('observacao').value = '';
  limparEmpresa(); // obriga a informar a empresa de novo na próxima entrega
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

  atualizarBotaoSync(pendentes, comProblema);
}

// Botão ÚNICO de sincronização: reenvia tudo (inclusive os com erro) e mostra
// a situação atual na própria cara do botão.
function atualizarBotaoSync(pendentes, comProblema) {
  const botao = el('btnSincronizar');
  botao.classList.remove('sync-erro', 'sync-ok');
  if (sincronizando) {
    botao.disabled = true;
    botao.textContent = 'Sincronizando…';
  } else if (comProblema > 0) {
    botao.disabled = false;
    botao.classList.add('sync-erro');
    botao.textContent = `⚠️ Tentar de novo (${pendentes})`;
  } else if (pendentes > 0) {
    botao.disabled = false;
    botao.textContent = `🔄 Sincronizar (${pendentes})`;
  } else {
    botao.disabled = true;
    botao.classList.add('sync-ok');
    botao.textContent = '✓ Tudo enviado';
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
        <span>${r.empresa ? `<span class="tag-empresa tag-empresa-${escapeHtml(String(r.empresa).toLowerCase())}">${escapeHtml(r.empresa)}</span>` : ''}${escapeHtml(r.motorista)} · ${formatarData(r.timestamp)}</span>
        ${comErro(r) ? `<span class="item-historico-erro-msg">Falha: ${escapeHtml(r.ultimoErro)}</span>` : ''}
      </div>
      ${carimboStatus(r)}
    </div>`).join('');
}

// Um clique reenvia TUDO: zera o contador de falhas dos itens em erro (para
// eles voltarem à fila com força total) e sincroniza todos os pendentes.
async function handleSincronizarClick() {
  const registros = await listarComprovantesLocais();
  for (const r of registros) {
    if (r.status === 'pendente' && (r.tentativas || 0) > 0) {
      r.tentativas = 0;
      r.ultimoErro = '';
      await salvarComprovanteLocal(r);
    }
  }
  await renderHistorico();
  await sincronizarPendentes(); // atualiza o botão/status no início e no fim
  await renderHistorico();
}

// ---------- inicialização ----------

window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
  }

  // pede ao navegador para NÃO apagar o armazenamento deste app quando o
  // celular ficar sem espaço — protege a fila offline de comprovantes
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  mostrarMotoristaAtual(motoristaSelecionadoAtual());

  el('trocarMotorista').addEventListener('click', () => {
    localStorage.removeItem('motoristaSelecionado');
    localStorage.removeItem('authToken');
    window.location.href = './login.html';
  });

  // empresa da entrega: um toque em Imille ou Anjun
  document.querySelectorAll('.btn-empresa').forEach((b) => {
    b.addEventListener('click', () => selecionarEmpresa(b.dataset.empresa));
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
  el('cameraFlash').addEventListener('click', alternarFlash);
  el('cameraTrocar').addEventListener('click', trocarCamera);
  el('cameraZoom').addEventListener('input', (e) => aplicarZoom(parseFloat(e.target.value)));
  el('cameraVideo').addEventListener('click', focarNoPonto); // toque no vídeo = focar ali

  el('formEntrega').addEventListener('submit', handleSubmit);
  el('btnSincronizar').addEventListener('click', handleSincronizarClick);

  window.addEventListener('online', () => { sincronizarPendentes(); });
  window.addEventListener('offline', () => { atualizarStatusConexao(); });
  setInterval(() => { if (navigator.onLine) sincronizarPendentes(); }, 25000);

  // Android suspende o app em segundo plano (o intervalo acima congela);
  // ao voltar para o primeiro plano, sincroniza e atualiza o status na hora
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      atualizarStatusConexao();
      sincronizarPendentes();
    }
  });

  await renderHistorico();
  await atualizarStatusConexao();
  sincronizarPendentes();
});
