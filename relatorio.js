// RELATÓRIO DE DESEMPENHO — página separada (aba própria), lê os comprovantes
// guardados NESTE aparelho (IndexedDB) e mostra os números do motorista logado.
// Nada sai do celular e não há chamada ao backend: é instantâneo e funciona
// offline. As duas quinzenas são fixas: dias 1–15 e 16 até o fim do mês.

const DB_NOME = 'ComprovantesDB';
const DB_STORE = 'comprovantes';
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function el(id) { return document.getElementById(id); }
function pad(n) { return String(n).padStart(2, '0'); }
function rotuloData(d) { return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; }

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, 1);
    // cria o store se ainda não existir (caso o relatório abra antes do app)
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listarTodos() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function mesmoDia(ts, d) {
  const x = new Date(ts);
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
}

// Intervalo da quinzena atual: 1ª = dia 1 a 15; 2ª = dia 16 ao último do mês.
function intervaloQuinzena(hoje) {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  if (hoje.getDate() <= 15) {
    return { ini: new Date(ano, mes, 1, 0, 0, 0, 0), fim: new Date(ano, mes, 15, 23, 59, 59, 999) };
  }
  // dia 0 do próximo mês = último dia deste mês
  return { ini: new Date(ano, mes, 16, 0, 0, 0, 0), fim: new Date(ano, mes + 1, 0, 23, 59, 59, 999) };
}

window.addEventListener('DOMContentLoaded', async () => {
  const motorista = localStorage.getItem('motoristaSelecionado');
  el('relMotorista').textContent = motorista || '—';

  const hoje = new Date();
  el('relDataHoje').textContent = rotuloData(hoje);
  const { ini, fim } = intervaloQuinzena(hoje);
  el('relQuinzenaIntervalo').textContent = `${rotuloData(ini)} a ${rotuloData(fim)}`;

  // só os comprovantes deste motorista (conta pendentes e enviados — é o
  // trabalho feito, independente de já ter sincronizado)
  const meus = (await listarTodos()).filter((r) => r.motorista === motorista);

  el('relHoje').textContent = meus.filter((r) => mesmoDia(r.timestamp, hoje)).length;

  const naQuinzena = meus.filter((r) => r.timestamp >= ini.getTime() && r.timestamp <= fim.getTime());
  el('relQuinzena').textContent = naQuinzena.length;

  // contagem por dia, do início da quinzena até hoje
  const fimListagem = hoje < fim ? hoje : fim;
  const porDia = [];
  for (let d = new Date(ini); d <= fimListagem; d.setDate(d.getDate() + 1)) {
    const dia = new Date(d);
    porDia.push({ dia, count: naQuinzena.filter((r) => mesmoDia(r.timestamp, dia)).length });
  }
  const maxCount = Math.max(1, ...porDia.map((p) => p.count));
  porDia.reverse(); // mais recente primeiro

  const container = el('relPorDia');
  if (porDia.length === 0) {
    container.innerHTML = '<p class="rel-vazio">Sem dias na quinzena ainda.</p>';
    return;
  }
  container.innerHTML = porDia.map((p) => `
    <div class="rel-dia">
      <span class="rel-dia-data">${DIAS_SEMANA[p.dia.getDay()]} ${rotuloData(p.dia)}</span>
      <span class="rel-dia-barra"><span class="rel-dia-barra-fill" style="width:${Math.round(p.count / maxCount * 100)}%"></span></span>
      <span class="rel-dia-num">${p.count}</span>
    </div>`).join('');
});
