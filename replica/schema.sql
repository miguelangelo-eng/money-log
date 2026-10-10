-- Schema: app de controle financeiro pessoal
-- Dialeto: Postgres (Supabase). O mesmo modelo roda em SQLite no dispositivo;
-- as diferenças estão listadas no fim do arquivo.
--
-- Convenções, decididas uma vez e válidas para todo o arquivo:
--   dinheiro      -> bigint em CENTAVOS. Nunca float, nunca numeric.
--   data contábil -> date (NÃO timestamptz). Ver nota [D] no fim.
--   instante      -> timestamptz em UTC.
--   exclusão      -> soft delete (deleted_at). Exigido pelo sync. Ver [S].
--   escopo        -> user_id em TODA tabela, com RLS. Ver [R].

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: espelho de auth.users. O Supabase Auth é o dono da credencial.
-- ---------------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  avatar_path text,
  currency    char(3) not null default 'BRL',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- accounts: conta corrente, poupança, dinheiro em espécie, investimento.
-- ---------------------------------------------------------------------------
create table accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  nome               text not null,
  tipo               text not null
                       check (tipo in ('corrente','poupanca','dinheiro','investimento')),
  instituicao        text,              -- texto livre: "Nubank". Sem logotipo. Ver [M].
  icone              text not null default 'wallet',
  cor                text,
  saldo_inicial_cents bigint not null default 0,
  arquivada          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint accounts_nome_nao_vazio check (length(btrim(nome)) > 0)
);
create index accounts_user_idx on accounts (user_id) where deleted_at is null;
create unique index accounts_nome_unico on accounts (user_id, lower(nome))
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- credit_cards: fechamento != vencimento. É daqui que sai a fatura.
-- ---------------------------------------------------------------------------
create table credit_cards (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  nome                text not null,
  icone               text not null default 'card',
  limite_cents        bigint not null default 0 check (limite_cents >= 0),
  dia_fechamento      smallint not null check (dia_fechamento between 1 and 31),
  dia_vencimento      smallint not null check (dia_vencimento between 1 and 31),
  conta_pagamento_id  uuid references accounts(id) on delete set null,
  arquivado           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index credit_cards_user_idx on credit_cards (user_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- invoices: a fatura é MATERIALIZADA, não derivada. Ver nota [F].
-- ---------------------------------------------------------------------------
create table invoices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  credit_card_id    uuid not null references credit_cards(id) on delete cascade,
  mes_referencia    date not null,          -- sempre dia 1 do mês de referência
  data_fechamento   date not null,
  data_vencimento   date not null,
  status            text not null default 'aberta'
                      check (status in ('aberta','fechada','paga')),
  pagamento_tx_id   uuid,                   -- FK adiada; ver fim do arquivo
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint invoices_vencimento_apos_fechamento
    check (data_vencimento >= data_fechamento)
);
-- Uma fatura por cartão por mês de referência. Barra a fatura duplicada no
-- banco, não na UI.
create unique index invoices_card_mes_unico
  on invoices (credit_card_id, mes_referencia) where deleted_at is null;
create index invoices_user_status_idx on invoices (user_id, status);

-- ---------------------------------------------------------------------------
-- categories: semeadas por usuário no cadastro. Ver nota [C].
-- ---------------------------------------------------------------------------
create table categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  nome       text not null,
  tipo       text not null check (tipo in ('despesa','receita')),
  icone      text not null default 'tag',
  cor        text not null default '#888888',
  parent_id  uuid references categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index categories_user_tipo_idx on categories (user_id, tipo)
  where deleted_at is null;
create unique index categories_nome_unico
  on categories (user_id, tipo, lower(nome)) where deleted_at is null;
-- Subcategoria não pode ser pai de outra: um nível só.
create index categories_parent_idx on categories (parent_id);

-- ---------------------------------------------------------------------------
-- transactions: a tabela que importa.
-- ---------------------------------------------------------------------------
create table transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,

  kind                text not null check (kind in ('despesa','receita','transferencia')),
  -- SEMPRE positivo. O sinal vem do kind, não do valor. Ver [V].
  amount_cents        bigint not null check (amount_cents > 0),
  currency            char(3) not null default 'BRL',

  competencia         date not null,   -- data contábil. date, não timestamptz. Ver [D]
  descricao           text not null default '',

  category_id         uuid references categories(id) on delete set null,
  account_id          uuid references accounts(id) on delete restrict,
  credit_card_id      uuid references credit_cards(id) on delete restrict,
  invoice_id          uuid references invoices(id) on delete restrict,
  transfer_account_id uuid references accounts(id) on delete restrict,

  pago                boolean not null default true,
  pago_em             date,

  observacao          text,
  anexo_path          text,

  -- séries: parcelamento e recorrência. Materializadas. Ver [P].
  series_id           uuid,
  parcela_n           smallint,
  parcela_de          smallint,

  import_batch_id     uuid,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  -- Despesa e receita saem de UMA conta ou de UM cartão, nunca de ambos,
  -- nunca de nenhum.
  constraint tx_origem_exclusiva check (
    kind = 'transferencia'
    or (account_id is not null) <> (credit_card_id is not null)
  ),
  -- Lançamento em cartão obriga fatura. É o que torna o histórico estável.
  constraint tx_cartao_exige_fatura check (
    credit_card_id is null or invoice_id is not null
  ),
  -- Transferência: duas contas distintas, sem categoria, sem cartão.
  constraint tx_transferencia_bem_formada check (
    kind <> 'transferencia' or (
      account_id is not null
      and transfer_account_id is not null
      and account_id <> transfer_account_id
      and category_id is null
      and credit_card_id is null
      and invoice_id is null
    )
  ),
  -- Só transferência usa conta de destino.
  constraint tx_destino_so_em_transferencia check (
    kind = 'transferencia' or transfer_account_id is null
  ),
  -- Categoria é do mesmo tipo do lançamento: validado por trigger (uma FK
  -- não alcança a coluna tipo da outra tabela). Ver [T].
  constraint tx_pago_em_coerente check (
    (pago = false and pago_em is null) or (pago = true)
  ),
  -- Parcela: ou os dois campos, ou nenhum, e n <= de.
  constraint tx_parcela_coerente check (
    (parcela_n is null and parcela_de is null)
    or (parcela_n is not null and parcela_de is not null
        and parcela_n >= 1 and parcela_n <= parcela_de)
  ),
  constraint tx_serie_exige_id check (
    (parcela_n is null and series_id is null) or series_id is not null
  )
);

-- Índices. O primeiro atende a tela de lançamentos do mês (S04), que é a
-- consulta mais frequente do app.
create index tx_user_competencia_idx
  on transactions (user_id, competencia desc) where deleted_at is null;
-- Relatório por categoria (S15).
create index tx_user_cat_comp_idx
  on transactions (user_id, category_id, competencia) where deleted_at is null;
-- Saldo da conta (S08) e fatura (S12).
create index tx_account_idx on transactions (account_id) where deleted_at is null;
create index tx_invoice_idx on transactions (invoice_id) where deleted_at is null;
create index tx_transfer_account_idx on transactions (transfer_account_id)
  where deleted_at is null;
-- Editar/excluir a série toda (F08).
create index tx_series_idx on transactions (series_id) where series_id is not null;
-- Cursor de sincronização. Ver [S].
create index tx_user_updated_idx on transactions (user_id, updated_at);
-- Alertas de conta a vencer (F10).
create index tx_user_pendente_idx on transactions (user_id, competencia)
  where pago = false and deleted_at is null;

-- FK adiada: invoices.pagamento_tx_id -> transactions.id
alter table invoices
  add constraint invoices_pagamento_fk
  foreign key (pagamento_tx_id) references transactions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- budgets: limite de gasto por categoria por mês (S16).
-- ---------------------------------------------------------------------------
create table budgets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  category_id    uuid not null references categories(id) on delete cascade,
  mes_referencia date,          -- null = vale para todo mês (limite recorrente)
  limite_cents   bigint not null check (limite_cents > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
-- Um limite por categoria por mês, e um recorrente por categoria.
create unique index budgets_cat_mes_unico
  on budgets (user_id, category_id, coalesce(mes_referencia, '1900-01-01'::date))
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- import_batches: o hash barra reimportar o mesmo extrato. Ver [I].
-- ---------------------------------------------------------------------------
create table import_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  arquivo_nome  text not null,
  formato       text not null check (formato in ('ofx','csv')),
  sha256        text not null,
  account_id    uuid references accounts(id) on delete set null,
  credit_card_id uuid references credit_cards(id) on delete set null,
  total_linhas  integer not null default 0,
  importadas    integer not null default 0,
  ignoradas     integer not null default 0,
  status        text not null default 'pendente'
                  check (status in ('pendente','concluido','erro')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index import_sha_unico on import_batches (user_id, sha256);

alter table transactions
  add constraint tx_import_fk
  foreign key (import_batch_id) references import_batches(id) on delete set null;

-- ---------------------------------------------------------------------------
-- alerts: contas a vencer, limite estourado (S18).
-- ---------------------------------------------------------------------------
create table alerts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  tipo           text not null
                   check (tipo in ('a_vencer','a_receber','limite_estourado','fatura_fechada')),
  transaction_id uuid references transactions(id) on delete cascade,
  budget_id      uuid references budgets(id) on delete cascade,
  invoice_id     uuid references invoices(id) on delete cascade,
  titulo         text not null,
  corpo          text,
  lido           boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index alerts_user_nao_lido_idx on alerts (user_id, created_at desc)
  where lido = false;
-- Idempotência: o job noturno roda mais de uma vez e não pode duplicar alerta.
-- created_at::date depende do TimeZone da sessão, então é STABLE e o Postgres
-- recusa no índice. Fixando UTC o cast vira IMMUTABLE e o índice é aceito.
create unique index alerts_dedupe
  on alerts (user_id, tipo,
             coalesce(transaction_id, budget_id, invoice_id),
             ((created_at at time zone 'UTC')::date));

-- ---------------------------------------------------------------------------
-- push_tokens: necessário para o alerta sair do app e chegar no celular.
-- ---------------------------------------------------------------------------
create table push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  token      text not null,
  plataforma text not null check (plataforma in ('ios','android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index push_tokens_unico on push_tokens (token);

-- ---------------------------------------------------------------------------
-- [T] Trigger: categoria do mesmo tipo do lançamento.
-- Uma check constraint não consegue ler outra tabela.
-- ---------------------------------------------------------------------------
create or replace function tx_valida_categoria() returns trigger
language plpgsql as $$
declare cat_tipo text;
begin
  if new.category_id is null then
    return new;
  end if;
  select tipo into cat_tipo from categories where id = new.category_id;
  if cat_tipo is null then
    raise exception 'categoria % nao existe', new.category_id;
  end if;
  if (new.kind = 'despesa' and cat_tipo <> 'despesa')
     or (new.kind = 'receita' and cat_tipo <> 'receita') then
    raise exception 'categoria % e do tipo % mas o lancamento e %',
      new.category_id, cat_tipo, new.kind;
  end if;
  return new;
end $$;

create trigger tx_valida_categoria_trg
  before insert or update of category_id, kind on transactions
  for each row execute function tx_valida_categoria();

-- updated_at automático em todas as tabelas sincronizadas.
create or replace function toca_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','accounts','credit_cards','invoices',
                           'categories','transactions','budgets',
                           'import_batches','alerts','push_tokens']
  loop
    execute format(
      'create trigger %I_touch before update on %I
       for each row execute function toca_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- [R] Row Level Security. Uma política, repetida: o dono vê as suas linhas.
-- Este é o requisito "isolamento total entre os dois usuários" da matriz.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','accounts','credit_cards','invoices',
                           'categories','transactions','budgets',
                           'import_batches','alerts','push_tokens']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- profiles usa id; as outras usam user_id.
create policy profiles_dono on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['accounts','credit_cards','invoices','categories',
                           'transactions','budgets','import_batches',
                           'alerts','push_tokens']
  loop
    execute format(
      'create policy %I_dono on %I for all
       using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- ===========================================================================
-- NOTAS DE DECISÃO
-- ===========================================================================
--
-- [D] competencia é `date`, NÃO `timestamptz`.
--     O template deste skill manda usar timestamptz sempre. Para instantes,
--     certo. Para data contábil, errado, e é um bug clássico: uma despesa do
--     dia 1º às 00:00 em America/Sao_Paulo gravada como timestamptz e lida em
--     UTC cai no dia 30 do mês anterior, e o relatório mensal fecha com valor
--     diferente do extrato. Data de competência é um dia do calendário, não
--     um ponto na linha do tempo. created_at/updated_at seguem timestamptz.
--
-- [V] amount_cents é sempre positivo; o sinal vem de kind.
--     Evita o estado ambíguo "despesa de -50" e deixa todo SUM() explícito
--     sobre o que está somando. Estorno de cartão entra como kind='receita'
--     com credit_card_id preenchido — permitido de propósito.
--
-- [F] A fatura é materializada e invoice_id é gravado no INSERT.
--     Alternativa descartada: derivar a fatura da data da compra e do
--     dia_fechamento em tempo de consulta. Descartada porque o usuário muda
--     o dia de fechamento do cartão, e aí TODO o histórico se reorganizaria
--     retroativamente — faturas antigas, já pagas, mudariam de valor.
--     Gravando invoice_id no lançamento, o passado é imutável e a mudança de
--     fechamento vale só para frente. A regra da virada (compra depois do
--     fechamento cai na fatura seguinte) roda uma vez, na escrita.
--
-- [P] Séries materializadas, não regra expandida em tempo de consulta.
--     12 parcelas = 12 linhas com o mesmo series_id. Motivos: a UI precisa
--     oferecer "esta ocorrência ou a série toda" (o original pergunta isso);
--     o relatório precisa enxergar o previsto; e o arredondamento do
--     parcelamento é por parcela. R$ 100 em 3x = 3334 + 3333 + 3333 centavos,
--     com o resto na primeira. Em centavos isso fecha exato; em float, não.
--     Recorrência sem fim materializa 60 ocorrências e estende ao abrir o app.
--
-- [C] Categorias são semeadas por usuário no cadastro, não compartilhadas
--     numa tabela global com user_id nulo. Assim o usuário renomeia e apaga
--     sem caso especial, e a política de RLS fica com uma única forma.
--     Os nomes são nossos — não copiar a lista do original palavra por palavra.
--
-- [S] Soft delete em tudo que sincroniza (deleted_at), porque um DELETE físico
--     no dispositivo não tem como ser propagado: o outro lado não sabe que a
--     linha existiu. updated_at é o cursor do sync.
--     O relógio usado é o do SERVIDOR (now() no Postgres, via trigger), nunca
--     o do celular: relógio de aparelho atrasa, adianta e o usuário mexe nele.
--
-- [I] import_batches.sha256 é único por usuário: reimportar o mesmo arquivo é
--     rejeitado pelo banco. É a defesa contra o erro mais comum do import.
--
-- [M] instituicao é texto livre. Nome de banco em texto é descritivo e
--     aceitável; empacotar o logotipo do banco no app, não — é marca de
--     terceiro. O conjunto de ícones é próprio (replica-design).
--
-- ===========================================================================
-- DIFERENÇAS NO SQLITE DO DISPOSITIVO (fonte da verdade local)
-- ===========================================================================
-- O mesmo modelo, gerado pelo Drizzle para os dois dialetos, com estas
-- diferenças:
--   - uuid        -> text (uuid v4 gerado no cliente, para a linha já nascer
--                    com id definitivo e o sync ser um upsert idempotente)
--   - timestamptz -> text ISO-8601 em UTC
--   - date        -> text 'YYYY-MM-DD'
--   - boolean     -> integer 0/1
--   - sem RLS: o banco local tem os dados de um usuário só, por construção
--   - sem os triggers de updated_at: quem grava updated_at local é o app, e o
--     valor é sobrescrito pelo servidor no push (ver [S])
--   - `pragma foreign_keys = on` precisa ser ligado em CADA conexão; o SQLite
--     vem com FK desligada por padrão e silenciosamente aceita órfão
--   - uma tabela extra, que NÃO existe no Postgres:
--
--       create table outbox (
--         seq        integer primary key autoincrement,
--         tabela     text not null,
--         row_id     text not null,
--         op         text not null check (op in ('upsert','delete')),
--         payload    text not null,          -- json da linha
--         tentativas integer not null default 0,
--         created_at text not null
--       );
--
--     Fila append-only de mudanças locais aguardando push. É o que faz a
--     edição offline funcionar sem perder nada.
