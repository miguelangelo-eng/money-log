# Architecture: app de controle financeiro pessoal

Reconstrução do núcleo manual do Organizze/Mobills. Dois usuários, finanças
totalmente separadas. Base: [`recon.md`](recon.md) e [`features.csv`](features.csv).
Data: 2026-10-10

## A decisão que estava pendente: local-first

**Resolvido: local-first.** O SQLite no celular é a fonte da verdade. O
Postgres no Supabase é réplica, backup e autenticação.

O motivo é uma consequência direta do seu escopo. O que torna local-first
difícil é resolver conflito entre dois editores do mesmo dado — e com finanças
separadas **existe exatamente um escritor por conjunto de dados**. A parte
difícil desaparece de graça. Sem isso eu teria recomendado o contrário.

O que se ganha:

- Lançar uma despesa é um INSERT local: responde instantâneo, sem *spinner*,
  sem estado de erro de rede. O fluxo F02 roda dez vezes por dia, na fila do
  mercado, e é onde o app é julgado.
- Funciona offline por construção, não por retrofit. Enfiar offline depois
  num app que fala com servidor a cada tela é reescrever a camada de dados.
- Custo zero de servidor em repouso. Dois usuários não justificam nada maior.

O que se paga:

- Existe código de sincronização. Com um escritor só, são ~200 linhas: fila
  append-only, upsert idempotente, cursor por `updated_at`. Não é um CRDT.
- O relatório é calculado no dispositivo, em SQL local. Para o volume de um
  app pessoal (poucos milhares de linhas por ano), isso é irrelevante.
- Se um dia quiser cliente web, ele vai ler do Postgres e precisa que o sync
  esteja correto. Está previsto, não implementado.

**Plano B registrado:** se o código de sync der mais trabalho do que o
estimado, a saída é o PowerSync (Postgres↔SQLite, tem SDK de Expo e regras de
sync baseadas em RLS) em vez de continuar remendando. Trocar para PowerSync no
meio é viável porque o schema já é o mesmo nos dois lados. Trocar para
"servidor é a verdade" no meio, não — isso é reescrever as telas.

## Stack

| camada | escolha | por quê |
| --- | --- | --- |
| app | Expo (React Native) + TypeScript | você escolheu mobile; Expo entrega build de Android e iOS sem Xcode local, por EAS |
| banco local (verdade) | SQLite via `expo-sqlite` + Drizzle ORM | Drizzle gera o mesmo schema para SQLite e Postgres a partir de uma definição só — é o que mantém os dois lados iguais |
| banco remoto (réplica) | Postgres no Supabase | RLS no banco, PostgREST de graça, e o *free tier* cobre dois usuários com folga |
| auth | Supabase Auth (e-mail/senha + Google) | integra com o RLS por `auth.uid()`; não preciso escrever sessão nem recuperação de senha |
| estado | TanStack Query sobre as consultas locais + Zustand para UI | as consultas são locais, então o Query serve de cache/invalidção, não de camada de rede |
| navegação | Expo Router | rotas por arquivo, com *tab bar* das 5 abas do recon |
| gráficos | Victory Native XL (Skia) | S15 precisa de rosca e barras; Skia desenha a 60fps, o que SVG em RN não garante |
| arquivos | Supabase Storage | só os anexos de comprovante (S06) |
| jobs | pg_cron + Edge Function | duas tarefas noturnas; não justifica Inngest nem worker |
| push | Expo Notifications | alertas de conta a vencer (F10) precisam sair do app |
| pagamentos | **nenhum** | uso próprio, sem cobrança. O `replica-backend` não vai tocar em Stripe |
| hosting | nenhum servidor próprio | Supabase gerenciado + app nas lojas |

Um banco. Sem microsserviço. Sem backend próprio — o Supabase é o backend.

## Schema

Ver [`schema.sql`](schema.sql). **10 tabelas** sincronizadas (`profiles`,
`accounts`, `credit_cards`, `invoices`, `categories`, `transactions`,
`budgets`, `import_batches`, `alerts`, `push_tokens`) mais uma local
(`outbox`, só no SQLite).

Regras de acesso: **RLS no Postgres**, uma política por tabela, todas na mesma
forma (`user_id = auth.uid()`), com `force row level security` para que nem o
dono da tabela escape. Essa política é a implementação do requisito
"isolamento total entre os dois usuários" da matriz de features — e é
testável: logar como um e tentar `select` numa linha do outro tem que voltar
vazio, não filtrado na UI. No SQLite não há RLS porque o banco local contém
os dados de um usuário só, por construção.

Convenções que valem para o arquivo inteiro:

- **Dinheiro em centavos** (`bigint`). Nunca float.
- **Data contábil é `date`, não `timestamptz`.** Aqui eu divergi do template
  do skill, que manda `timestamptz` sempre. Para instante, ele está certo;
  para data de competência, está errado, e o bug é clássico: despesa do dia 1º
  gravada como timestamptz e lida em UTC cai no dia 30 do mês anterior, e o
  relatório mensal fecha diferente do extrato. `created_at`/`updated_at`
  seguem `timestamptz`.
- **Valor sempre positivo**; o sinal vem de `kind`. Elimina o estado ambíguo
  "despesa de −50".
- **Soft delete** (`deleted_at`) em tudo que sincroniza: um DELETE físico no
  celular não tem como ser propagado, porque o outro lado não sabe que a linha
  existiu.
- **O relógio do cursor é o do servidor**, nunca o do aparelho. Relógio de
  celular atrasa, adianta, e o usuário mexe nele.

As quatro decisões de modelagem que custaram pensamento estão anotadas como
notas `[F]`, `[P]`, `[V]` e `[D]` no fim do `schema.sql`. As duas que mais
importam:

- **A fatura é materializada e `invoice_id` é gravado na escrita.** Derivar a
  fatura em tempo de consulta, a partir da data da compra e do dia de
  fechamento, parece mais limpo e é uma armadilha: quando o usuário muda o dia
  de fechamento do cartão, todo o histórico se reorganiza retroativamente e
  faturas antigas, já pagas, mudam de valor. Gravando na escrita, o passado
  fica imutável e a mudança vale só para frente.
- **Séries materializadas.** 12 parcelas são 12 linhas com o mesmo
  `series_id`. A UI precisa oferecer "esta ocorrência ou a série toda", o
  relatório precisa ver o previsto, e o arredondamento é por parcela: R$ 100
  em 3× = 3334 + 3333 + 3333 centavos, com o resto na primeira.

> **O schema não foi executado.** Não há Postgres nem Docker nesta máquina.
> Ele está revisado, mas "revisado" não é "roda". O primeiro passo do M0 é
> aplicá-lo num projeto Supabase novo e corrigir o que aparecer — em especial
> os dois blocos `DO $$` que criam trigger e política em laço, e o índice
> parcial com `at time zone`.

## API

Não há API própria de CRUD, e isso é de propósito: com SQLite local, escrever
um lançamento não passa por rede. O que existe é autenticação, dois
procedimentos de sincronização, um procedimento transacional e *storage*.

| method path | faz | quem | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/v1/signup` | cria usuário e semeia categorias por trigger | público | email, senha, nome | sessão | F01 |
| `POST /auth/v1/token` | login e refresh | público | credencial | sessão | F01 |
| `POST /rest/v1/rpc/pull_changes` | devolve tudo que mudou desde o cursor, em todas as tabelas, com o `now()` do servidor como próximo cursor | dono | `cursor timestamptz` | linhas por tabela + `next_cursor` | sync |
| `POST /rest/v1/rpc/push_changes` | aplica o lote do outbox numa transação; upsert por `id`, idempotente | dono | array de `{tabela, op, linha}` | ids aplicados + `server_time` | sync |
| `POST /rest/v1/rpc/pagar_fatura` | cria a transação de pagamento, debita a conta e marca a fatura como paga — **atômico** | dono | `invoice_id, account_id, valor_cents, data` | `transaction_id` | F03 |
| `POST /storage/v1/object/anexos/{user_id}/{id}` | sobe o comprovante | dono | arquivo | path | S06 |
| `POST /rest/v1/push_tokens` | registra o token do Expo | dono | token, plataforma | — | F10 |

Por que `pull_changes`/`push_changes` como RPC em vez de bater em cada tabela
pelo PostgREST: um cursor só para o conjunto todo e **uma transação** no push.
Sincronizar tabela por tabela cria o estado intermediário em que o lançamento
já chegou mas a fatura dele não.

Webhooks de entrada: nenhum (sem Stripe, sem Open Finance).
Webhooks de saída: nenhum.

Jobs:

| job | agenda | faz |
| --- | --- | --- |
| `fechar_faturas` | pg_cron, diário 03:00 UTC | fatura cujo `data_fechamento` passou vai de `aberta` para `fechada` e abre a do mês seguinte |
| `alertas_diarios` | pg_cron, diário 11:00 UTC (08:00 BRT) | cria `alerts` de conta a vencer e de limite estourado, e dispara o push pela Edge Function |
| `estender_recorrencias` | local, ao abrir o app | materializa mais ocorrências das séries sem fim quando faltam menos de 12 |

## As partes que machucam

- **Fuso e horário de verão.** O Brasil não tem mais horário de verão, mas o
  `date` de competência já blinda o relatório. O cuidado que sobra: os jobs
  rodam em UTC e precisam acordar no horário certo em BRT.
- **Virada do fechamento do cartão.** Compra no dia do fechamento entra na
  fatura que fecha ou na seguinte? Regra fixada: `competencia >
  data_fechamento` vai para a próxima. O dia do fechamento ainda entra na
  fatura que fecha. Decidido aqui para não virar inconsistência depois.
- **Dia de fechamento 29, 30 ou 31.** Fevereiro não tem. A geração de fatura
  precisa fazer `min(dia, último dia do mês)`. É o bug que só aparece em
  fevereiro, seis meses depois do lançamento.
- **Idempotência do push.** O lote sobe, a rede cai antes da resposta, o app
  reenvia. Como o `id` é uuid gerado no cliente, o reenvio é um upsert sobre a
  mesma linha e não duplica. É por isso que o id nasce no cliente.
- **Corrida entre dispositivos.** Quase inexistente por escopo (um escritor),
  mas o caso real é trocar de celular e os dois ficarem instalados. Mitigação:
  `updated_at` do servidor decide, e o aparelho que perder registra no log em
  vez de descartar em silêncio.
- **Transferência contada duas vezes.** O erro mais comum desta classe de app.
  Blindado em dois lugares: `kind='transferencia'` tem `category_id`
  obrigatoriamente nulo (check constraint), e toda consulta de relatório
  filtra `kind <> 'transferencia'`.
- **Encoding e separador no import.** OFX brasileiro vem em cp1252, e CSV de
  banco usa vírgula decimal com vírgula de separador. O parser tem que
  detectar os dois, e o `sha256` único barra o reimport do mesmo arquivo.
- **Conciliação do import** contra o que já foi digitado à mão: casar por
  (valor, data ± 3 dias, conta) e **sempre** pedir confirmação. Importar em
  silêncio sobre um lançamento manual é como se perde a confiança no app.
- **Exclusão de conta com lançamento.** `on delete restrict` de propósito:
  apagar uma conta não pode evaporar o histórico. A UI arquiva (`arquivada`),
  não apaga.
- **Limite do Storage.** *Free tier* do Supabase é 1 GB. Comprovante
  fotografado em 4 MB chega lá em 250 fotos. Comprimir antes de subir.
- **LGPD.** São os seus próprios dados e de mais uma pessoa, com
  consentimento óbvio, então o peso é baixo — mas dado financeiro é sensível:
  TLS em trânsito (padrão), criptografia em repouso (padrão do Supabase), e um
  "apagar minha conta" que faça `delete` em cascata de verdade. Se um dia
  virar produto, isso muda de patamar.
- **Biometria não é segurança de dados.** Está na matriz como `could`, e vale
  saber que ela protege a tela, não o arquivo: o SQLite no dispositivo fica em
  claro. Se isso incomodar, a resposta é SQLCipher, não `expo-local-auth`.

## Ordem de build

**M0 — fatia vertical (prova a stack).**
Cadastrar, criar uma conta, lançar uma despesa, vê-la no relatório do mês.
Feio, sem cartão, sem sync.
Telas S02, S03, S08, S09, S05, S06, S04, S15 · tabelas `profiles`,
`accounts`, `categories`, `transactions` · rotas: signup, token.
Critério de pronto: `F02` em 5 toques, offline, no seu celular.

**M1 — sync e backup.**
`outbox`, `pull_changes`, `push_changes`, RLS aplicada e testada com as duas
contas reais. Critério de pronto: desinstalar, reinstalar, logar e os dados
voltarem; e uma conta não conseguir ler nada da outra.

**M2 — cartão de crédito.** A parte mais densa.
Telas S10, S11, S12 · tabelas `credit_cards`, `invoices` · rota
`pagar_fatura` · job `fechar_faturas`.

**M3 — séries.** Parcelado e recorrente, com "ocorrência ou série toda".
Sem tela nova; muda S06 e S07 e o job `estender_recorrencias`.

**M4 — orçamento e alertas.**
Telas S16, S18 · tabelas `budgets`, `alerts`, `push_tokens` · job
`alertas_diarios`.

**M5 — import OFX/CSV e conciliação.**
Tela S19 · tabela `import_batches`.

**M6 — should e could de `features.csv`**, pela ordem da matriz: login Google,
busca e filtro, anexo, modo escuro, export CSV, subcategorias, offline
refinado, depois os `could`.

**Sem M7 de "fixes do replica-entrepreneur".** Com finanças separadas o app
não tem ângulo de posicionamento, e aquele skill não vai achar nada que já não
esteja na matriz. Pular é o certo.

Restam **23 obrigatórias**, 13 `should`, 8 `could`. Próximo passo:
`/replica-design`.
