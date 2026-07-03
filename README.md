# Comprovante de Entrega — App Offline para Motoristas

App web instalável (PWA) para o motorista registrar: motorista (com senha
individual), nome do recebedor, foto do pacote e foto da fachada do local de
entrega. Funciona **sem internet** (fila local no celular) e sincroniza
sozinho quando a conexão volta, gravando tudo automaticamente numa planilha.

Não precisa de nenhuma licença paga. O backend usa o Google Sheets + Google
Apps Script (gratuitos), e você exporta/sincroniza para Excel quando quiser.

---

## Como funciona, na prática

1. Motorista abre o app no celular (instalado na tela inicial, como um app normal).
2. **Na primeira vez**, o app abre numa tela de **login separada**
   (`login.html`) perguntando "Quem está usando este aparelho hoje?" — o
   motorista toca no próprio nome e digita sua **senha individual**
   (configurada em `config.js`), e só então é levado para a tela de
   comprovantes (`index.html`). Da próxima vez que abrir o app (mesmo depois
   de fechar e reabrir, ou dias depois), ele já entra direto na tela de
   comprovantes com o nome certo, sem passar pelo login de novo. Isso fica
   salvo no próprio celular (cada aparelho lembra o seu motorista).
   - Se o aparelho for usado por outra pessoa em algum dia, é só tocar em
     **"Trocar"** na tela de comprovantes — isso volta para a tela de login,
     onde é só escolher outro motorista da lista e digitar a senha dele.
3. Preenche o nome do recebedor, tira a **foto do pacote**, tira a **foto da
   fachada** do local de entrega e toca em **Enviar**.
4. Se tiver internet, o comprovante já sai daquela tela sincronizado ("ENVIADO").
5. Se **não** tiver internet, fica guardado no celular como "PENDENTE" e é
   enviado sozinho assim que a conexão voltar — não precisa reabrir o app nem
   reenviar manualmente.
6. Cada comprovante vira uma linha na planilha "Entregas", com link direto
   para as duas fotos (pacote e fachada) salvas no Google Drive.

---

## Passo 1 — Criar o backend (Google Sheets + Apps Script) — 5 min

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha
   nova. Dê um nome, ex: **"Comprovantes de Entrega"**.
2. Menu **Extensões → Apps Script**.
3. Apague todo o código de exemplo (`function myFunction() {...}`) e cole o
   conteúdo do arquivo `backend/Code.gs` (está nesta pasta).
4. Na linha `var TOKEN = 'TROQUE_ESTA_SENHA';`, troque por uma senha simples
   que só você vai saber (ex: `entregas2026x`). Faça o mesmo na linha
   `var ADMIN_SENHA = 'TROQUE_ESTA_SENHA_DE_ADMIN';` — use uma senha
   **diferente** da anterior, essa é a senha do painel de administrador.
   No mapa `var MOTORISTAS = { ... }`, coloque o nome e a senha de cada
   motorista (essas senhas ficam **só aqui no backend**, nunca no app).
5. Clique em **Implantar → Nova implantação**.
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
6. Clique em **Implantar**, autorize as permissões pedidas (é o próprio
   Google pedindo confirmação de que o script pode ler/escrever na sua planilha).
7. Copie a **URL do app da Web** gerada — você vai usar no Passo 2.

> Sempre que editar o `Code.gs`, é preciso fazer **"Gerenciar implantações →
> editar (ícone de lápis) → Nova versão → Implantar"** para as mudanças valerem.

---

## Passo 2 — Configurar o app

Abra o arquivo `app.js` e edite as 3 primeiras linhas úteis:

```js
const CONFIG = {
  API_URL: 'COLE_AQUI_A_URL_DO_APPS_SCRIPT',   // a URL do Passo 1.6
  TOKEN: 'TROQUE_ESTA_SENHA',                   // a MESMA senha do Code.gs
  MOTORISTAS: ['Motorista 1', 'Motorista 2', 'Motorista 3'] // só os NOMES
};
```

> Aqui ficam **só os nomes** dos motoristas (o que aparece na lista de login).
> As **senhas** ficam no `backend/Code.gs` (mapa `MOTORISTAS`) e são conferidas
> no servidor — assim não ficam visíveis neste arquivo, que é público. Como a
> conferência é no backend, o **primeiro login de cada motorista precisa de
> internet**; depois disso o aparelho lembra o motorista e não pede senha de
> novo (só ao tocar em "Trocar"). Para adicionar um motorista, coloque o nome
> aqui **e** a senha no `Code.gs`, e republique a implantação.

---

## Passo 3 — Publicar o app (hospedagem gratuita) — 5 min

O app precisa estar em um endereço HTTPS para funcionar offline (é uma regra
de segurança dos navegadores para PWAs). A forma mais simples e gratuita:

**Opção A — Netlify Drop (mais rápido, sem conta de programador)**
1. Acesse [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arraste a pasta inteira `entrega-app` (com index.html, app.js etc.) para a página.
3. Pronto — você recebe um link tipo `https://seu-app.netlify.app`.

**Opção B — GitHub Pages**
1. Crie um repositório novo no GitHub e suba os arquivos desta pasta.
2. Em Settings → Pages, ative o Pages apontando para a branch principal.
3. O link fica algo como `https://seu-usuario.github.io/entrega-app`.

Qualquer uma das duas funciona bem para até dezenas de motoristas.

---

## Passo 4 — Instalar no celular do motorista

- **Android (Chrome):** abrir o link → menu (⋮) → **"Adicionar à tela inicial"**.
- **iPhone (Safari):** abrir o link → botão de compartilhar → **"Adicionar à
  Tela de Início"**.

Depois de instalado, o app abre em tela cheia, como um app nativo, e o ícone
laranja/azul marinho fica na tela do celular.

> **Nota sobre iPhone:** o Safari é mais restritivo com armazenamento offline
> de apps não instalados. Por isso é importante orientar o motorista a
> **instalar na tela de início** (não só deixar aberto no navegador) — assim
> a fila offline fica salva de forma confiável.

---

## Passo 5 — Testar

1. Abra o app instalado, coloque o celular em **modo avião**.
2. Preencha um comprovante de teste e envie — deve aparecer como **PENDENTE**
   (carimbo laranja tracejado) e o topo mostra "Offline — 1 pendente".
3. Tire do modo avião — em poucos segundos o carimbo vira **ENVIADO** (verde)
   sozinho, e a linha aparece na planilha.

---

## Painel do administrador (só pelo computador)

Depois de publicar o app (Passo 3), abra `https://seu-link/admin.html` no
navegador do computador. Ele pede a senha de administrador (a que você
definiu em `ADMIN_SENHA` no `Code.gs`) e mostra uma tabela com todos os
comprovantes já sincronizados: data/hora, motorista, recebedor, observação,
uma miniatura da foto do pacote, uma da fachada e um botão de status.

- **Fotos:** clique em qualquer miniatura (pacote ou fachada) para abrir a
  imagem em tamanho grande, direto na página (sem abrir outra aba). Clique
  fora da imagem, no ✕, ou aperte Esc para fechar.
- **Finalizado:** clique no botão para marcar/desmarcar um comprovante como
  finalizado. Fica salvo na planilha na hora (coluna "Finalizado"), então
  vale pra qualquer computador que abrir o painel depois.
- Tem busca por nome de recebedor ou motorista, e um botão "Atualizar" para
  buscar comprovantes novos sem recarregar a página.
- A senha não fica salva no navegador — se atualizar a página, precisa
  digitar de novo. Isso é proposital, para não deixar sessão aberta em
  computador compartilhado.
- Comprovantes enviados **antes** dessa atualização não têm um ID salvo na
  planilha, então o botão "Finalizado" aparece desabilitado para eles. Dá pra
  liberar manualmente: na planilha, preencha a coluna "ID" dessa linha com
  qualquer texto único (ex: `antigo1`).

---

## Como ver isso no Excel

A planilha "Entregas" no Google Sheets já é a sua fonte de dados ao vivo.
Três formas de ter isso em Excel, da mais simples à mais automática:

1. **Baixar quando quiser:** no Google Sheets, `Arquivo → Fazer download →
   Microsoft Excel (.xlsx)`.
2. **Excel sempre atualizado, sem trabalho manual:** se vocês tiverem
   Microsoft 365, crie um fluxo no **Power Automate** com o gatilho *"Quando
   uma linha é adicionada"* (conector do Google Sheets) e a ação *"Adicionar
   linha a uma tabela"* (Excel Online, num arquivo no OneDrive/SharePoint).
   Isso replica cada comprovante automaticamente para um Excel de verdade.
3. **Consulta ao vivo:** no Excel, `Dados → Obter Dados → Do Google Sheets`
   (via link público de exportação CSV da planilha) e configurar atualização
   automática.

Se no futuro vocês migrarem para Microsoft 365 por completo, dá pra trocar
o backend por um Power Apps + SharePoint/Excel diretamente — me avise que eu
te ajudo a montar essa versão também.

---

## Estrutura dos arquivos

```
entrega-app/
├── index.html          → tela do app do motorista (comprovantes)
├── login.html            → tela de login do motorista (nome + senha)
├── relatorio.html          → relatório de desempenho do motorista (diário + quinzenal)
├── admin.html                → painel do administrador (login + tabela)
├── styles.css                  → visual do app do motorista, login e relatório
├── admin.css                     → visual do painel do administrador
├── config.js                       → URL do backend, token e lista de nomes dos motoristas
├── app.js                            → lógica do motorista: fila offline, câmera (2 fotos), sincronização
├── login.js                            → lógica do login: escolher motorista e conferir senha (no backend)
├── relatorio.js                          → lógica do relatório: conta as entregas locais por dia/quinzena
├── admin.js                                → lógica do painel: login e listagem dos comprovantes
├── sw.js                                     → service worker (cache offline, só no app do motorista)
├── manifest.json                              → configuração do "instalar na tela inicial"
├── icons/                                       → ícones do app
└── backend/
    └── Code.gs                                    → backend Google Apps Script (cole no Apps Script)
```

## Relatório de desempenho (do motorista)

No rodapé da tela do motorista há o link **"📊 Meu desempenho"**, que abre uma
página só de leitura com os números **daquele** motorista:

- **Hoje:** total de entregas do dia.
- **Quinzena atual:** total da quinzena, sempre nas duas faixas fixas do mês —
  **1ª: dias 1 a 15** e **2ª: dia 16 até o fim do mês** — com o intervalo de
  datas mostrado.
- **Por dia:** uma lista com a contagem de cada dia da quinzena e uma barrinha
  de volume, para ver os dias mais/menos movimentados.

Os números são calculados **no próprio celular**, a partir da fila local de
comprovantes — por isso é instantâneo, funciona **offline** e não depende do
backend. Consequência: o relatório reflete as entregas feitas **naquele
aparelho**. A fonte oficial e consolidada continua sendo a planilha (painel do
administrador).

---

## Relatório de desempenho (aba "Desempenho" — para a administração)

Na própria planilha existe uma aba **"Desempenho"** que consolida o desempenho
de **todos** os motoristas, para o controle da administração. Ela é gerada e
formatada automaticamente pelo backend (`Code.gs`), com uma linha por motorista
e as colunas:

- **Hoje** — entregas do dia.
- **Quinzena (01–15 / 16–fim)** — entregas na quinzena atual (as duas faixas
  fixas do mês).
- **Mês** — entregas no mês corrente.
- **Total** — todas as entregas já registradas.
- **Finalizadas** — quantas já foram marcadas como finalizadas no painel.
- **Última entrega** — data/hora da entrega mais recente do motorista.

Formatação: título com o mês, "Atualizado em…", cabeçalho fixo, linhas zebradas,
totais no rodapé e destaque **🏆** para o líder da quinzena. Os motoristas são
ordenados pela quinzena (maior primeiro).

**Atualização automática:** a aba se atualiza sozinha conforme entram novas
entregas (ou quando você finaliza um comprovante), no máximo **a cada ~10 min**
para não pesar. Para criá-la/atualizá-la na hora, abra **Extensões → Apps
Script**, escolha a função **`gerarRelatorioDesempenho`** e clique em **▶ Executar**
(só na primeira vez ele pode pedir autorização). Se quiser que ela também
atualize de tempos em tempos mesmo sem novas entregas, rode **uma vez** a função
**`configurarRelatorioAutomatico`** (instala um gatilho a cada 30 min).

> Lembre: como o `Code.gs` mudou, é preciso **republicar** a implantação
> (Gerenciar implantações → editar → Nova versão → Implantar) para valer.

---

## Limites e pontos de atenção

- Cada motorista precisa **instalar o app na tela inicial** para o offline
  funcionar de forma confiável (principalmente no iPhone).
- As fotos são comprimidas automaticamente antes de guardar/enviar, para não
  pesar no celular nem na sincronização.
- As senhas dos motoristas são conferidas **no backend** (mapa `MOTORISTAS` no
  `Code.gs`), então não ficam expostas no `config.js` público. Ainda assim, não
  é um login forte: senhas curtas (ex: 4 dígitos) são fáceis de adivinhar por
  tentativa e erro contra a rota de login — se precisar de mais segurança, use
  senhas mais longas. Para autenticação real por motorista (sessão, bloqueio
  após tentativas), a próxima etapa seria migrar para Power Apps ou um backend
  com autenticação de verdade.
- O `TOKEN` de escrita ainda fica no `config.js` público (é o que o app usa para
  gravar comprovantes). Ele é uma proteção simples contra spam — escondê-lo por
  completo exigiria autenticação por sessão, fora do escopo atual.
- Se um comprovante falhar ao enviar várias vezes seguidas (já com internet), ele
  aparece como **ERRO** (vermelho) no histórico do motorista, com a razão e um
  botão **"Tentar de novo"** — em vez de ficar preso e invisível como "pendente".
