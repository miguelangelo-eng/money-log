# Build log

Uma linha por tela. O que foi mais difícil do que parecia fica registrado —
metade feita declarada é informação, metade feita escondida é dívida.

## 2026-10-10 — M0: shell, primitivos e fatia vertical do F02

| tela | estado | falta |
|---|---|---|
| `/design` (não é tela de produto) | **feito** | é o teste do sistema de design; sai do app quando o M0 fechar |
| S03 Início | **feito** | widget de cartões (não há cartão ainda) |
| S04 Lançamentos do mês | **feito** | busca, filtro, swipe para excluir, detalhe (S07) |
| S05+S06 Novo lançamento | **parcial** | só despesa e receita. Transferência, data escolhida, parcelamento, recorrência, anexo e observação não entraram |
| S15 Relatórios | **parcial** | a rosca por categoria exige Skia, não instalado. Barras e lista ranqueada prontas |
| S02 Login · S08 Contas · S09 Nova conta · S10–S12 Cartões · S13–S14 Categorias · S16 Metas · S18 Alertas · S19 Import | **não começadas** | — |

Paridade: **20,3 / 100** · must-haves **6 de 23**.

O número é baixo e está certo: o M0 nunca foi sobre cobertura, foi sobre provar
a stack ponta a ponta. O que existe é o caminho inteiro — migração do banco,
semente, escrita, leitura, agregação, duas telas de consulta — funcionando
sobre SQLite real, não sobre dado falso.

### Decisões de implementação

- **Banco local real desde o M0, não camada falsa.** O skill sugere dado de
  semente e camada falsa quando o backend ainda não existe. Aqui não é
  necessário: a arquitetura é local-first, então o SQLite **é** a fonte da
  verdade e não há o que mockar. O Supabase entra depois como réplica, e a
  troca é dentro de `src/data/ledger.ts` — nenhuma tela muda.
- **`useAsync` com refoco em vez de `useLiveQuery` do Drizzle.** A camada de
  dados é de Promises de propósito, para que a camada de sync (M1) não toque em
  tela nenhuma. `useLiveQuery` obrigaria a expor construtor de query para a UI,
  amarrando a tela ao Drizzle.
- **Sem rosca na S15, e isso não é só cosmético.** A lista ranqueada é a metade
  que responde "qual categoria me sangrou" e é também a visão de tabela que a
  acessibilidade exige. O que falta é a leitura de relance. Marcado `partial`,
  não `yes`.
- **Barras feitas com `View`, sem biblioteca de gráfico.** Barra horizontal é
  largura percentual; puxar Skia para isso seria desperdício. A rosca é o único
  gráfico que realmente precisa de Skia.

### O que foi mais difícil do que parecia

**Fazer a migração chegar ao dispositivo.** Três falhas em sequência, todas
encontradas por `expo export` e nenhuma por typecheck:

1. `drizzle-kit generate` sem `driver: 'expo'` não emite o `migrations.js` que
   o `useMigrations` importa. Só o `.sql`, que o app não tem como ler — não há
   sistema de arquivos para isso no bundle.
2. Com o `migrations.js` no lugar, o Metro não resolve `.sql`:
   `Unable to resolve module ./0000_xxx.sql`. Precisa de
   `config.resolver.sourceExts.push('sql')` num `metro.config.js` que o
   template do SDK 57 não traz.
3. Resolvendo, o Metro passa a tratar o `.sql` como JavaScript e morre com
   `Missing semicolon (1:6)`. Falta `babel-plugin-inline-import` configurado
   para `.sql`, que converte o import no conteúdo do arquivo como string.

São três peças que só funcionam juntas, e nenhuma delas aparece no typecheck.
É o argumento concreto para bundlar antes de declarar qualquer coisa pronta.

**Aba escondida não é tela de pilha.** A tela `novo` era um `Tabs.Screen` com
`href: null`, o que a tira da barra mas a mantém **aba** — e navegar para uma
aba troca de aba em vez de empilhar, então `router.back()` não tinha o que
desempilhar (`GO_BACK was not handled by any navigator`). O comentário no
próprio código dizia "`novo` não é aba: é um fluxo que começa e termina", e a
implementação fazia o oposto. Corrigido movendo as abas para o grupo `(tabs)`
e deixando a raiz como `Stack`, com `novo` apresentado como modal. Só aparece
rodando: typecheck e bundle passavam. Commit `c7ca5ac`.

**Escape Unicode em JSX.** Escrevi `label="‹"` nas setas do seletor de mês
e `Carregando…` como texto de elemento. Em JSX, nem atributo string nem
texto de elemento processam escape — os dois teriam renderizado os caracteres
literais. Dentro de chaves (`label={'‹'}`) funciona. Pegos na revisão, não
pelo compilador: são strings válidas e o typecheck passa.

### Verificação

| portão | resultado |
|---|---|
| `npm run typecheck` | exit 0 (app + testes) |
| `npm test` | 24/24 |
| `npx expo export --platform android` | **exit 0**, 1406 módulos |
| `contrast.py` | 42 pares, 0 falhas AA |

### O que NÃO foi verificado

- ~~**Nada rodou em aparelho nem em emulador.**~~ **Resolvido em 2026-10-10:**
  o app abre no Android (Expo Go). Isso prova que as 12 tabelas e 19 índices
  aplicaram, que o journal do Drizzle registrou a migração, que a semente
  inseriu perfil, 10 categorias e a conta inicial, e que os tokens resolvem
  em tela.

  **Fatia vertical validada no mesmo dia:** lançar despesa, ver na lista
  agrupada por dia, o saldo e o total do mês mudarem no Início, e a despesa
  aparecer nas barras e na lista por categoria do relatório. A `MoneyInput`
  se comportou no Android, inclusive o backspace — era o ponto de maior
  desconfiança, porque o `onKeyPress` não é confiável no teclado numérico e
  a entrada de dígito foi tratada por `onChangeText`.

  **O M0 está cumprido.** O criterio era o F02 funcionando num aparelho, não
  o bundle compilando.

  Duas falhas de migração precederam isso, ambas no índice de `budgets`, e
  **nenhuma aparecia no typecheck nem no bundle**. Ver o commit `125bf03`.
  A lição virou portão: `npm run db:check` aplica a migração num SQLite em
  memória pelo `node:sqlite` — o mesmo motor do aparelho — e verifica 14
  invariantes. A ferramenta estava disponível desde o início e não foi usada;
  esse foi o furo real do M0, não o índice em si.
- **Nenhum screenshot.** `replica/clone-screens/` está vazio, então o
  `replica-diff` não terá comparação visual — nem teria referência, já que
  `replica/screens/` também está vazio desde o recon.
- **Os cálculos de saldo e de agregação não têm teste.** `accountBalances` e
  `expensesByCategory` funcionaram para **um** lançamento num aparelho, o que
  não é a mesma coisa que estarem corretos. Sem cobertura: transferência entre
  contas (onde o valor sai de uma e entra na outra, e um erro de sinal dobra
  dinheiro), lançamento não pago (que não deve contar no saldo), mais de uma
  conta, e despesa sem categoria.

  **Fechada em 2026-10-10:** a regra de saldo foi para `src/lib/balance.ts`
  (função pura) com 13 testes cobrindo transferência que conserva dinheiro,
  não-pago, múltiplas contas, cartão sem conta e saldo negativo. A consulta
  só agrega. `verify` passa com 37 testes.

  Registro do caminho antigo, para não se repetir: a regra estava dentro da
  consulta e do laço, e não tinha teste. Era a lacuna número um, e foi barata
  de fechar: a redução de saldo que soma as
  linhas agrupadas é JavaScript puro e pode ser extraída de
  `accountBalances` para uma função testável com linhas fabricadas, sem
  precisar de banco. A agregação em si é SQL e cai no `db:check`.
- **Teclado, leitor de tela e tela de 320pt.** Especificados em
  `components.md`, não exercitados.

### Próximo passo

Rodar em aparelho (`npm start` e abrir no Expo Go) e percorrer o F02: abrir,
lançar uma despesa, ver na lista e no relatório. Até isso acontecer, o M0 está
compilando, não funcionando — e a diferença entre as duas coisas é o ponto todo
da fatia vertical.

Depois, na ordem: teste de `accountBalances`/`expensesByCategory`, S09 (criar
conta), S07 (editar e excluir), e então o M2 (cartão de crédito), que é onde a
lógica de `src/lib/invoice.ts` — já testada — finalmente é usada.

## 2026-10-10 — M2: cartão de crédito

| tela | estado | falta |
|---|---|---|
| S10 Cartões (nova aba) | **feito** | arquivar e editar cartão |
| S11 Novo cartão | **feito** | edição de cartão existente |
| S12 Fatura | **feito** | pagamento parcial, estorno |
| S06 Novo lançamento | **parcial** | ganhou "Pagar com: Conta \| Cartão" e parcelas até 24x no cartão; continua sem data escolhida, transferência e recorrência |

Paridade: **34,4 / 100** (era 20,3) · must-haves **10 de 23** (eram 6).

### Decisões

- **Pagamento de fatura é um tipo próprio, `pagamento_fatura`.** A compra já é
  a despesa, na data dela. Como `despesa`, o pagamento contaria cada compra
  duas vezes nos relatórios; como `transferencia`, faltaria conta de destino.
  O tipo próprio tira o dinheiro da conta sem entrar em total de gasto. No
  SQLite o enum é só tipo, então não houve migração; no Postgres virou check
  constraint (`tx_pagamento_fatura_bem_formado`, nota [G] do `schema.sql`).
- **Status da fatura é derivado de datas**, não persistido. Só `paga` é
  estado, porque depende de um ato do usuário. Assim a fatura fecha no dia
  certo mesmo offline, e o job `fechar_faturas` da arquitetura deixa de ser
  necessário no aparelho.
- **Só fatura fechada pode ser paga, e só por inteiro.** Pagar uma aberta
  deixaria compras novas caírem numa fatura quitada; o banco trata isso como
  pagamento antecipado parcial, e modelar parcial ficou para depois.
- **A camada de dados do cartão recebe o banco por injeção**
  (`createCardsRepo`). É o que permite testá-la no Node contra SQLite real.

### O que foi mais difícil do que parecia

**Testar a camada de dados de verdade.** O driver do expo-sqlite não carrega
no Node, e o do better-sqlite3 importa o pacote nativo (não instalado) no
`driver.js`. A saída: montar a sessão do better-sqlite3 direto do
`session.js`, que não importa nada nativo, sobre um adaptador de ~30 linhas
para o `node:sqlite` do Node 24 — o mesmo motor do aparelho. Os 16 testes de
`src/data/cards.test.ts` rodam com a migração gerada aplicada.

Conferido que a sessão do expo-sqlite faz a mesma coisa na transação
(`begin`, callback síncrono, `commit`, `rollback` e relançar em falha), então
a atomicidade testada no Node vale no aparelho.

**Provar que os testes pegam o que dizem pegar.** O teste de atomicidade
passou de primeira, o que não prova nada. Uma cópia mutante com o adaptador
sem transação derrubou exatamente esse teste e nenhum outro.

**O driver é síncrono.** Callback `async` dentro de `db.transaction` faz o
Drizzle lançar erro em tempo de execução — no aparelho, não no typecheck. As
escritas atômicas usam callback síncrono com `.run()/.get()/.all()`.

**`TransactionRow` tinha um `else` genérico** que trataria
`pagamento_fatura` como receita, com sinal `+`. Virou um `Record` indexado
pelo tipo do lançamento, que obriga o compilador a cobrar cada tipo novo.

### Verificação

| portão | resultado |
|---|---|
| `npm run verify` | exit 0 — **69 testes**, typecheck do app e dos testes, migração |
| `npx expo export --platform android` | exit 0 |

### O que NÃO foi verificado

- ~~**Nada do M2 rodou no aparelho ainda.**~~ **Validado no Android em
  2026-10-11:** cadastro de cartão com a prévia de fatura, compra parcelada
  em 3x, fatura listando a parcela 1/3 como aberta, rótulo "cartão · 1/3" na
  lista de lançamentos, e o saldo da conta **intacto** depois da compra —
  o caso em que um erro de modelagem tiraria o dinheiro duas vezes.
  Falta ver o pagamento, que só libera depois do fechamento.
- **Pagar fatura no celular exige esperar um dia.** A tela de lançamento
  ainda não deixa escolher a data, e só fatura fechada pode ser paga. Para
  testar: cadastrar o cartão com **fechamento no dia de hoje**, lançar uma
  compra (no dia do fechamento ela ainda entra), e pagar amanhã. A data
  escolhível no S06 resolve isso.
- **O `schema.sql` do Postgres continua nunca executado**, agora com a
  constraint nova.

## 2026-10-11 — Grupo 1: o que travava o uso diário

| tela | estado | falta |
|---|---|---|
| S07 Lançamento (ver, editar, excluir) | **feito** | escolher "só esta parcela" ao excluir (grupo 2) |
| S06 Novo lançamento | **feito no essencial** | recorrência (grupo 2) |
| S08 Contas | **feito** | editar e arquivar conta |
| S09 Nova conta | **feito** | — |
| S13 Categorias | **feito** | editar, excluir, subcategoria |
| S14 Nova categoria | **parcial** | ícone por categoria |

O S06 ganhou: transferência como terceiro tipo, data (hoje e ontem a um toque,
o resto pelo seletor nativo), descrição opcional e "+ Nova categoria" sem
abandonar o lançamento.

Paridade: **46,4 / 100** (era 34,4) · must-haves **13 de 23** (eram 10).

### Decisões

- **O `ledger.ts` virou repositório injetável** (`src/data/ledger-repo.ts`),
  no mesmo padrão do cartão. As telas importam os mesmos nomes de antes; o
  `ledger.ts` só liga o repositório ao banco do aparelho. É o que permite
  testar editar e excluir contra SQLite real, que é onde um erro corrompe
  saldo.
- **Excluir uma parcela apaga a compra inteira.** Uma parcela solta faria a
  série deixar de somar o valor comprado. Escolher "só esta" é a feature
  "ocorrência versus série" do grupo 2. Recusado se alguma parcela estiver em
  fatura paga.
- **Excluir pagamento de fatura = desfazer.** A fatura volta a ficar em aberto
  na mesma transação, e dá para pagar de novo.
- **Compra no cartão edita só categoria e descrição.** Valor e data definem a
  fatura, gravada na escrita (nota [F]); mudar exige excluir e relançar.
- **Categoria valida tipo** na camada de dados, como o trigger [T] do Postgres:
  gasto não pode ser classificado como "Salário".
- **Data pelo seletor nativo** (`@react-native-community/datetimepicker`, que
  vem no Expo Go) em vez de calendário próprio. A conversão `Date` ↔ data civil
  ganhou `toLocalDate` e teste: é onde o bug de fuso mora.
- **Cor de categoria só dos 8 slots validados**, não seletor livre.
- **Confirmação de exclusão pelo `Alert` nativo**, não pela folha inferior
  especificada em `components.md`. Acessível e nativo nos dois sistemas;
  a folha fica para quando houver mais de duas ações.
- **Modo escuro corrigido na matriz** de `no` para `partial`: o app sempre
  seguiu o tema do sistema; o que falta é a chave manual.

### O que foi mais difícil do que parecia

**Os testes passaram de primeira de novo**, então repeti a prova por mutação
em duas regras: "excluir uma parcela apaga só ela" e "sem checagem de fatura
paga". Os dois mutantes morreram nos testes certos.

**O passo 5 do roteiro do M2 virou teste automático**: pagar a fatura não
aumenta o gasto do mês.

**Contraste da marca de seleção de cor**: o check branco sobre o amarelo
`#eda100` ficaria em ~2:1. Foi para dentro de um círculo na cor da superfície.

### Verificação

| portão | resultado |
|---|---|
| `npm run verify` | exit 0 — **100 testes**, typecheck do app e dos testes, migração |
| `npx expo export --platform android` | exit 0 |

### O que NÃO foi verificado

- ~~**Nada do grupo 1 rodou no aparelho ainda.**~~ **Validado no Android em
  2026-10-11:** editar valor com o saldo acompanhando, lançar com data passada
  pelo seletor nativo, transferência entre duas contas sem mexer no "Saiu" do
  mês, e excluir uma parcela apagando a compra inteira.
- O pagamento de fatura do M2 também continua sem ser visto no aparelho.

## 2026-10-11 — M1: sync e backup (código pronto, falta o Supabase)

Login por e-mail e senha, fila de alterações no aparelho, `push_changes` e
`pull_changes` no Postgres, tela "Backup e conta". Tudo testado de ponta a
ponta **sem** o Supabase: o lado do servidor roda num Postgres de verdade em
memória (PGlite, Postgres compilado para WASM), com o `schema.sql` inteiro.

### O schema.sql rodou pela primeira vez

Aplicado no PGlite com um stub do `auth` do Supabase (`auth.users`,
`auth.uid()` lendo o `sub` do JWT, papéis `anon`/`authenticated` com os grants
padrão). Os pontos de risco listados no SETUP passaram como estavam: os dois
`DO $$`, o `alerts_dedupe` e as constraints da nota [G]. Mudou:

- **`create extension pgcrypto` removido.** `gen_random_uuid()` é nativo desde
  o Postgres 13, e o PGlite não traz a extensão.
- **Bug: o trigger de `updated_at` só rodava no update.** No insert, a linha
  ficava com o relógio do celular, e o cursor do pull (relógio do servidor)
  podia pulá-la. Agora é `before insert or update`.
- **Bug: a FK `invoices.pagamento_tx_id` não era adiável.** Fatura paga e
  pagamento apontam um para o outro e sobem no mesmo lote; qualquer ordem
  violava uma das duas. Agora é `deferrable initially deferred`.

### Decisões

- **O `user_id` local continua fixo; o servidor carimba o `auth.uid()`** no
  push (nota [Y]). Os repositórios não mudaram uma linha, os dados de antes do
  login sobem sem reescrita, e um app adulterado não grava em nome de outro.
- **Triggers do SQLite alimentam a fila** (migração 0002), não os
  repositórios. Nenhuma escrita escapa por esquecimento. Durante o pull,
  `sync_state.aplicando = 1` desliga os triggers, senão cada linha baixada
  voltaria no push seguinte.
- **O push lê a linha na hora do envio**, não guarda cópia na fila: dez
  edições viram um upsert. Só limpa a fila até o `seq` lido; o que foi editado
  durante o envio fica para o próximo.
- **O pull não sobrescreve linha com alteração na fila.** A versão do aparelho
  é mais nova e sobe no próximo push.
- **O pull relê um minuto antes do cursor.** `now()` é o início da transação,
  não o commit: um push concorrente poderia gravar `updated_at` menor que o
  cursor e ficar invisível. Reaplicar é idempotente.
- **Primeiro login decide a origem dos dados:** aparelho vazio baixa, nuvem
  vazia sobe, os dois vazios semeia, **os dois com dados recusa** e oferece
  ficar com a nuvem. Juntar duplicaria categorias padrão e misturaria
  históricos.
- **Aparelho tem dono** (`sync_state.dono`). Outra conta não entra sem apagar
  os dados locais, e o motor recusa sincronizar com uma sessão que não seja a
  do dono — senão o carimbo do servidor subiria os dados para a conta errada.
- **Com dono, o app abre sem sessão e sem rede.** O login só é exigido no
  primeiro uso. Se dependesse da sessão, token vencido + offline = app
  inutilizável.
- **Sair apaga os dados do aparelho**, avisando quantas alterações não subiram.
- **Sem Supabase configurado, o app roda só local**, como antes. A atualização
  não trava o celular enquanto o projeto não existe.

### Verificação

| portão | resultado |
|---|---|
| `npm run verify` | exit 0 — **114 testes** (14 novos, contra SQLite + Postgres reais) |
| `npx expo export --platform android` | exit 0; migrações 0001/0002 no bundle |
| mutação | 7 de 7 mutantes mortos: RLS desligada, touch só no update, FK não adiada, sem carimbo, trigger sem supressão, pull atropelando a fila, push limpando a fila no erro |

### O que NÃO foi verificado

- ~~Nada rodou no Supabase de verdade.~~ ~~Nada do M1 rodou no aparelho.~~
  **Validado em 2026-10-11** — ver a seção seguinte.

## 2026-10-11 — M1 validado, e o app virou APK

Paridade: **55,7 / 100** (era 46,4) · must-haves **16 de 23** (eram 13).
Cadastro, isolamento, backup e edição offline viraram `yes` na matriz.

**Validado com o Supabase e as duas contas reais:**

- o `schema.sql` rodou no SQL Editor sem erro;
- cadastro pelo app, e os dados de antes do login subiram;
- limpar os dados do Expo Go, entrar de novo e tudo voltar;
- trocar do Expo Go para o APK (banco novo, vazio) e baixar tudo da nuvem;
- conta da segunda pessoa (criada pelo painel do Supabase), app vazio só com
  as categorias padrão;
- teste de isolamento no SQL Editor: logado como ela, 0 lançamentos do outro.

**O que apareceu no caminho:**

- **"Automatically expose new tables" desmarcado**, como o Supabase
  recomenda na criação do projeto, deixaria o schema sem grant nenhum e o sync
  em "permission denied". Virou a nota [A]: grants explícitos (select, insert e
  update para `authenticated`, sem DELETE; nada para `anon`). O stub dos
  testes passou a imitar esse pior caso: 13 testes falharam antes da correção.
- **Login falhando com "E-mail ou senha incorretos"** depois de reinstalar.
  Resolvido redefinindo a senha pelo SQL; causa provável, erro de digitação
  no cadastro ou preenchimento automático do Android. A tela de entrar ganhou
  "Mostrar senha" e passou a mandar o e-mail em minúsculas.
- **O "Connect" do Supabase mostra os nomes do Next.js**
  (`NEXT_PUBLIC_...`); o app lê `EXPO_PUBLIC_...`.

**APK pelo EAS:** perfil `preview`, identificador `com.miguelangelo.moneylog`,
projeto `@miguelangelo-eng/money-log`. As variáveis do Supabase ficam no
ambiente `preview` do EAS, porque o `.env.local` não sobe. A aba Design só
existe em `__DEV__`. Instalado nos dois celulares.

### O que NÃO foi verificado

- Pagar fatura continua sem ser visto no aparelho (a regra está testada).
- O sync em segundo plano com as duas pessoas usando no dia a dia: o que foi
  visto é o primeiro envio e o primeiro download.
