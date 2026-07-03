/**
 * BACKEND — Comprovante de Entrega
 * ---------------------------------
 * Como instalar (veja o README.md para o passo a passo com prints):
 * 1. Crie uma planilha nova no Google Sheets.
 * 2. Menu Extensões > Apps Script.
 * 3. Apague o código de exemplo e cole este arquivo inteiro.
 * 4. Troque o valor de TOKEN e ADMIN_SENHA abaixo por senhas só suas.
 * 5. Implantar > Nova implantação > tipo "App da Web".
 *    - Executar como: Eu
 *    - Quem pode acessar: Qualquer pessoa
 * 6. Autorize as permissões pedidas e copie a URL gerada.
 * 7. Cole essa URL e as senhas no arquivo config.js do app.
 *
 * Toda vez que editar este arquivo: Gerenciar implantações > editar
 * (lápis) > Nova versão > Implantar — senão as mudanças não valem.
 */

var TOKEN = 'HUB-ENTREGAS';
var ADMIN_SENHA = 'ADMIN3917';

// Senhas dos motoristas — ficam SÓ aqui no backend (não no config.js público).
// A tela de login (login.html) envia nome + senha e o servidor confere abaixo.
// Para adicionar/remover motorista: edite este mapa E a lista de nomes em
// config.js (MOTORISTAS), e republique esta implantação.
var MOTORISTAS = {
  'Mello': '0327',
  'Vinicius': '9205',
  'Said': '4771',
  'Matheus Silva': '5840',
  'Joao': '1551',
  'Thales': '5824',
  'Bruno': '1654',
  'Pedro': '3277'
};

var NOME_ABA = 'Entregas';
var NOME_ABA_RELATORIO = 'Desempenho';
var NOME_PASTA_DRIVE = 'Comprovantes de Entrega';
var CABECALHO = ['Data/Hora', 'Motorista', 'Recebedor', 'Observações', 'Foto Pacote', 'Foto Fachada', 'ID', 'Finalizado'];

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);

    if (dados.acao === 'login') {
      return verificarLogin(dados);
    }

    if (dados.acao === 'finalizar') {
      return marcarFinalizado(dados);
    }

    // envio normal de um novo comprovante (motorista)
    if (dados.token !== TOKEN) {
      return responder({ status: 'error', message: 'Token inválido' });
    }
    if (!dados.recebedor || !dados.motorista) {
      return responder({ status: 'error', message: 'Dados incompletos' });
    }

    var aba = obterOuCriarAba();

    // Idempotência: se este ID já foi gravado antes, não grava de novo.
    // Evita linha duplicada quando o celular reenvia um comprovante cuja
    // resposta se perdeu na rede (ele continua "pendente" e tenta de novo).
    if (dados.id && idJaExiste(aba, dados.id)) {
      return responder({ status: 'ok', duplicado: true });
    }

    var pasta = obterOuCriarPasta();
    var urlFotoPacote = dados.fotoPacote ? salvarImagem(dados.fotoPacote, pasta, 'pacote_' + dados.recebedor) : '';
    var urlFotoFachada = dados.fotoFachada ? salvarImagem(dados.fotoFachada, pasta, 'fachada_' + dados.recebedor) : '';

    aba.appendRow([
      new Date(dados.timestamp || Date.now()),
      dados.motorista,
      dados.recebedor,
      dados.observacao || '',
      urlFotoPacote,
      urlFotoFachada,
      dados.id || '',
      false
    ]);

    atualizarRelatorioSeNecessario(); // mantém a aba "Desempenho" em dia
    return responder({ status: 'ok' });
  } catch (err) {
    return responder({ status: 'error', message: String(err) });
  }
}

function verificarLogin(dados) {
  var senhaCorreta = MOTORISTAS[dados.nome];
  if (senhaCorreta && String(dados.senha) === String(senhaCorreta)) {
    return responder({ status: 'ok' });
  }
  return responder({ status: 'error', message: 'Motorista ou senha incorretos.' });
}

function marcarFinalizado(dados) {
  if (dados.senha !== ADMIN_SENHA) {
    return responder({ status: 'error', message: 'Senha incorreta' });
  }
  if (!dados.id) {
    return responder({ status: 'error', message: 'Comprovante sem ID' });
  }
  var aba = obterOuCriarAba();
  var valores = aba.getDataRange().getValues();
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][6]) === String(dados.id)) {
      aba.getRange(i + 1, 8).setValue(!!dados.valor); // coluna H = Finalizado
      atualizarRelatorioSeNecessario(); // reflete a mudança no "Desempenho"
      return responder({ status: 'ok' });
    }
  }
  return responder({ status: 'error', message: 'Comprovante não encontrado' });
}

// Verifica se já existe uma linha com este ID (coluna G = índice 6).
function idJaExiste(aba, id) {
  var valores = aba.getDataRange().getValues();
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][6]) === String(id)) return true;
  }
  return false;
}

function doGet(e) {
  if (e.parameter.acao === 'listar') {
    return listarComprovantes(e.parameter.senha);
  }
  return ContentService.createTextOutput('API de comprovantes ativa ✅');
}

function listarComprovantes(senha) {
  if (senha !== ADMIN_SENHA) {
    return responder({ status: 'error', message: 'Senha incorreta' });
  }
  var aba = obterOuCriarAba();
  var valores = aba.getDataRange().getValues();
  valores.shift(); // remove a linha de cabeçalho

  var registros = valores
    .filter(function (linha) { return linha[1] || linha[2]; }) // ignora linhas vazias
    .map(function (linha) {
      var idDrivePacote = extrairIdDrive(linha[4]);
      var idDriveFachada = extrairIdDrive(linha[5]);
      return {
        dataHora: linha[0] instanceof Date ? linha[0].toISOString() : String(linha[0]),
        motorista: linha[1],
        recebedor: linha[2],
        observacao: linha[3],
        fotoPacote: linha[4],
        fotoPacoteImg: idDrivePacote ? ('https://drive.google.com/thumbnail?id=' + idDrivePacote + '&sz=w1600') : '',
        fotoFachada: linha[5],
        fotoFachadaImg: idDriveFachada ? ('https://drive.google.com/thumbnail?id=' + idDriveFachada + '&sz=w1600') : '',
        id: linha[6] ? String(linha[6]) : '',
        finalizado: linha[7] === true || String(linha[7]).toLowerCase() === 'true'
      };
    })
    .reverse(); // mais recentes primeiro

  return responder({ status: 'ok', registros: registros });
}

function extrairIdDrive(url) {
  if (!url) return '';
  var m = String(url).match(/\/d\/([^/]+)/);
  return m ? m[1] : '';
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function obterOuCriarPasta() {
  var pastas = DriveApp.getFoldersByName(NOME_PASTA_DRIVE);
  if (pastas.hasNext()) return pastas.next();
  return DriveApp.createFolder(NOME_PASTA_DRIVE);
}

function obterOuCriarAba() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(NOME_ABA);
  if (!aba) {
    aba = ss.insertSheet(NOME_ABA);
    aba.appendRow(CABECALHO);
    aba.setFrozenRows(1);
    return aba;
  }
  // migração automática: garante que planilhas já existentes ganhem
  // as colunas novas (ID, Finalizado) sem perder dados antigos
  var ultimaColuna = aba.getLastColumn();
  if (ultimaColuna < CABECALHO.length) {
    aba.getRange(1, ultimaColuna + 1, 1, CABECALHO.length - ultimaColuna)
      .setValues([CABECALHO.slice(ultimaColuna)]);
  }
  return aba;
}

function salvarImagem(base64, pasta, nomeBase) {
  var partes = base64.split(',');
  var mimeMatch = partes[0].match(/data:(.*);base64/);
  var mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  var bytes = Utilities.base64Decode(partes[1]);
  var extensao = mime.indexOf('png') > -1 ? '.png' : '.jpg';
  var blob = Utilities.newBlob(bytes, mime, nomeBase + extensao);
  var arquivo = pasta.createFile(blob);
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return arquivo.getUrl();
}

/* =====================================================================
 * RELATÓRIO DE DESEMPENHO (aba "Desempenho") — para a administração
 * ---------------------------------------------------------------------
 * Uma aba separada, formatada, com o desempenho por motorista. Atualiza
 * sozinha conforme entram entregas (no máximo a cada ~10 min, para não
 * pesar). Você também pode:
 *   - rodar gerarRelatorioDesempenho() para atualizar na hora;
 *   - rodar configurarRelatorioAutomatico() uma vez para, além disso,
 *     atualizar de tempos em tempos mesmo sem novas entregas.
 * ===================================================================== */

// Regera o relatório, mas no máximo uma vez a cada 10 min (evita refazer a
// cada entrega quando o movimento é alto). Nunca derruba o envio se falhar.
function atualizarRelatorioSeNecessario() {
  try {
    var props = PropertiesService.getScriptProperties();
    var ultimo = Number(props.getProperty('relatorio_ultimo') || 0);
    if (Date.now() - ultimo < 10 * 60 * 1000) return;
    gerarRelatorioDesempenho();
    props.setProperty('relatorio_ultimo', String(Date.now()));
  } catch (err) {
    // relatório é secundário — nunca quebra o fluxo principal
  }
}

// Instala um gatilho por tempo (a cada 30 min) e gera o relatório agora.
// Rode UMA vez pelo editor do Apps Script (menu ▶) se quiser atualização
// periódica mesmo em horários sem novas entregas.
function configurarRelatorioAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gerarRelatorioDesempenho') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('gerarRelatorioDesempenho').timeBased().everyMinutes(30).create();
  gerarRelatorioDesempenho();
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function gerarRelatorioDesempenho() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();

  var abaDados = ss.getSheetByName(NOME_ABA);
  var dados = abaDados ? abaDados.getDataRange().getValues() : [];
  if (dados.length) dados.shift(); // tira o cabeçalho

  var agora = new Date();
  var hojeStr = Utilities.formatDate(agora, tz, 'yyyy-MM-dd');
  var ymAtual = hojeStr.substring(0, 7);
  var diaAtual = parseInt(hojeStr.substring(8, 10), 10);
  var quinzena = diaAtual <= 15 ? 1 : 2;
  var iniQ = quinzena === 1 ? 1 : 16;
  var fimQ = quinzena === 1 ? 15 : new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();

  // universo de motoristas: os cadastrados + quaisquer que apareçam nos dados
  var stats = {};
  function garantir(nome) {
    if (!stats[nome]) stats[nome] = { hoje: 0, quinzena: 0, mes: 0, total: 0, finalizadas: 0, ultima: null };
    return stats[nome];
  }
  Object.keys(MOTORISTAS).forEach(garantir);

  for (var i = 0; i < dados.length; i++) {
    var linha = dados[i];
    var nome = linha[1];
    if (!nome) continue;
    var s = garantir(String(nome));
    s.total++;
    if (linha[7] === true || String(linha[7]).toLowerCase() === 'true') s.finalizadas++;

    var d = linha[0] instanceof Date ? linha[0] : new Date(linha[0]);
    if (!isNaN(d.getTime())) {
      var ds = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      var ym = ds.substring(0, 7);
      var dia = parseInt(ds.substring(8, 10), 10);
      if (ds === hojeStr) s.hoje++;
      if (ym === ymAtual) {
        s.mes++;
        if ((quinzena === 1 && dia <= 15) || (quinzena === 2 && dia >= 16)) s.quinzena++;
      }
      if (!s.ultima || d.getTime() > s.ultima.getTime()) s.ultima = d;
    }
  }

  // ordena por quinzena (desc) e, empate, por total (desc)
  var nomes = Object.keys(stats).sort(function (a, b) {
    return stats[b].quinzena - stats[a].quinzena || stats[b].total - stats[a].total;
  });

  var rotuloQuinzena = 'Quinzena (' + pad2(iniQ) + '–' + pad2(fimQ) + ')';
  var cabecalho = ['Motorista', 'Hoje', rotuloQuinzena, 'Mês', 'Total', 'Finalizadas', 'Última entrega'];
  var linhas = nomes.map(function (n) {
    var s = stats[n];
    return [n, s.hoje, s.quinzena, s.mes, s.total, s.finalizadas,
      s.ultima ? Utilities.formatDate(s.ultima, tz, 'dd/MM/yyyy HH:mm') : '—'];
  });
  var tot = ['TOTAL', 0, 0, 0, 0, 0, ''];
  linhas.forEach(function (l) { for (var c = 1; c <= 5; c++) tot[c] += l[c]; });

  var nCols = cabecalho.length;
  var LINHA_CAB = 4;

  // (re)cria a aba limpa
  var aba = ss.getSheetByName(NOME_ABA_RELATORIO);
  if (!aba) aba = ss.insertSheet(NOME_ABA_RELATORIO);
  aba.clear();
  aba.getRange(1, 1, aba.getMaxRows(), Math.max(aba.getMaxColumns(), nCols)).breakApart();
  aba.setTabColor('#12203A');

  // título
  var mesNome = Utilities.formatDate(agora, tz, 'MM/yyyy');
  aba.getRange(1, 1, 1, nCols).merge()
    .setValue('RELATÓRIO DE DESEMPENHO — ' + mesNome)
    .setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#12203A')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  aba.setRowHeight(1, 36);

  // subtítulo
  aba.getRange(2, 1, 1, nCols).merge()
    .setValue('Atualizado em ' + Utilities.formatDate(agora, tz, 'dd/MM/yyyy HH:mm') +
      '  ·  Quinzena atual: dia ' + iniQ + ' a ' + fimQ)
    .setFontColor('#5B6B85').setFontStyle('italic').setHorizontalAlignment('center');

  // cabeçalho da tabela
  aba.getRange(LINHA_CAB, 1, 1, nCols).setValues([cabecalho])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2F4560')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  aba.setRowHeight(LINHA_CAB, 28);

  // dados
  if (linhas.length) {
    aba.getRange(LINHA_CAB + 1, 1, linhas.length, nCols).setValues(linhas);
    // zebra
    for (var r = 0; r < linhas.length; r++) {
      if (r % 2 === 1) aba.getRange(LINHA_CAB + 1 + r, 1, 1, nCols).setBackground('#F7F7F3');
    }
    // formatação inteligente: destaca o líder da quinzena
    if (linhas[0][2] > 0) {
      aba.getRange(LINHA_CAB + 1, 1, 1, nCols).setBackground('#DFF3E7').setFontWeight('bold');
      aba.getRange(LINHA_CAB + 1, 1).setValue('🏆 ' + linhas[0][0]);
    }
  }

  // total
  var linhaTot = LINHA_CAB + 1 + linhas.length;
  aba.getRange(linhaTot, 1, 1, nCols).setValues([tot])
    .setFontWeight('bold').setBackground('#ECEBE3');

  // bordas + alinhamento dos números
  aba.getRange(LINHA_CAB, 1, linhas.length + 2, nCols)
    .setBorder(true, true, true, true, true, true, '#DEDCD2', SpreadsheetApp.BorderStyle.SOLID);
  aba.getRange(LINHA_CAB, 2, linhas.length + 2, nCols - 1).setHorizontalAlignment('center');

  aba.setFrozenRows(LINHA_CAB);
  for (var c2 = 1; c2 <= nCols; c2++) aba.autoResizeColumn(c2);
  if (aba.getColumnWidth(1) < 140) aba.setColumnWidth(1, 140);
}
