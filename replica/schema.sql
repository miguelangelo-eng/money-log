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

-- gen_random_uuid() é nativo desde o Postgres 13: não precisa de pgcrypto.

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

  kind                text not null
                        check (kind in ('despesa','receita','transferencia','pagamento_fatura')),
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
  -- Id da linha no extrato do banco. Único por usuário, inclusive em linha
  -- excluída: o que foi apagado de propósito não volta. Ver [I].
  id_externo          text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  -- Despesa e receita saem de UMA conta ou de UM cartão, nunca de ambos,
  -- nunca de nenhum.
  constraint tx_origem_exclusiva check (
    kind in ('transferencia','pagamento_fatura')
    or (account_id is not null) <> (credit_card_id is not null)
  ),
  -- Pagamento de fatura: sai de UMA conta, quita UMA fatura de UM cartão.
  -- Leva conta e cartão ao mesmo tempo, por isso é exceção à regra acima.
  -- Não tem categoria: não é gasto (a compra já foi), e nenhum relatório o
  -- soma como despesa. Ver nota [G].
  constraint tx_pagamento_fatura_bem_formado check (
    kind <> 'pagamento_fatura' or (
      account_id is not null
      and credit_card_id is not null
      and invoice_id is not null
      and category_id is null
      and transfer_account_id is null
      and series_id is null
    )
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
-- Importação de extrato: a mesma linha do banco entra uma vez só. Ver [I].
create unique index tx_id_externo_unico on transactions (user_id, id_externo)
  where id_externo is not null;

-- FK adiada: invoices.pagamento_tx_id -> transactions.id
-- Criada depois de transactions E verificada só no commit (deferrable). A
-- fatura paga aponta para o pagamento, e o pagamento aponta para a fatura:
-- no mesmo lote do sync, qualquer ordem de inserção violaria uma das duas.
alter table invoices
  add constraint invoices_pagamento_fk
  foreign key (pagamento_tx_id) references transactions(id) on delete set null
  deferrable initially deferred;

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

-- updated_at automático em todas as tabelas sincronizadas, NO INSERT TAMBÉM.
-- Só no update, a linha nova chegaria com o updated_at do celular, e o cursor
-- do pull (que é o relógio do servidor) poderia pulá-la. Ver [S].
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
      'create trigger %I_touch before insert or update on %I
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

-- ---------------------------------------------------------------------------
-- [Y] Sincronização. Duas funções, chamadas pelo app via /rest/v1/rpc.
--
-- O SQLite do aparelho é a fonte da verdade e cada conjunto de dados tem um
-- escritor só, então não há resolução de conflito: o push é upsert por id e o
-- pull devolve o que mudou desde o cursor.
--
-- As duas são SECURITY INVOKER (o padrão): rodam como o usuário logado, e a
-- RLS acima vale dentro delas. Não há caminho por aqui que leia ou grave a
-- linha de outra pessoa.
-- ---------------------------------------------------------------------------

-- Ordem de dependência: quem é referenciado vem antes de quem referencia. O
-- push grava nesta ordem; o app aplica o pull nesta ordem. O único ciclo
-- (fatura paga <-> pagamento) é resolvido pela FK adiada.
create or replace function sync_tabelas() returns text[]
language sql immutable as $$
  select array['profiles','accounts','credit_cards','invoices','categories',
               'import_batches','transactions','budgets','alerts','push_tokens']
$$;

-- Recebe [{"tabela": "...", "linha": {...}}, ...] e grava tudo numa transação
-- só (a da chamada): ou o lote inteiro entra, ou nada entra, e o app reenvia.
-- Reenviar é seguro, porque é upsert sobre o id gerado no aparelho.
create or replace function push_changes(mudancas jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  uid   uuid := auth.uid();
  m     jsonb;
  t     text;
  linha jsonb;
  cols  text;
  upd   text;
  n     integer := 0;
begin
  if uid is null then
    raise exception 'push_changes exige usuário autenticado' using errcode = '28000';
  end if;

  for m in select value from jsonb_array_elements(mudancas) loop
    t := m ->> 'tabela';
    if t is null or not (t = any (sync_tabelas())) then
      raise exception 'tabela % não sincroniza', t using errcode = '22023';
    end if;

    -- De quem é a linha quem diz é o token, não o aparelho. O app grava um
    -- user_id local fixo; aqui ele vira o auth.uid() de quem está logado.
    linha := m -> 'linha'
          || case when t = 'profiles' then jsonb_build_object('id', uid)
                  else jsonb_build_object('user_id', uid) end;

    -- Colunas que existem no servidor. Chave a mais no json (colunas só do
    -- SQLite) é ignorada pelo jsonb_populate_record.
    select string_agg(format('%I', column_name), ', ' order by ordinal_position),
           string_agg(format('%I = excluded.%I', column_name, column_name), ', '
                      order by ordinal_position)
             filter (where column_name not in ('id', 'user_id', 'created_at'))
      into cols, upd
      from information_schema.columns
     where table_schema = 'public' and table_name = t;

    -- Se o id existir e for de outra pessoa, o DO UPDATE esbarra na RLS e a
    -- chamada inteira falha. Não sobrescreve, não revela que a linha existe.
    execute format(
      'insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1)
       on conflict (id) do update set %s',
      t, cols, cols, t, upd)
    using linha;
    n := n + 1;
  end loop;

  return jsonb_build_object('aplicadas', n, 'server_time', now());
end $$;

-- Devolve, por tabela, as linhas do usuário com updated_at depois do cursor,
-- e o próximo cursor. Cursor nulo = tudo (primeira sincronização do aparelho).
--
-- O cursor devolvido é o now() do servidor, e a próxima chamada relê um
-- minuto antes dele. Motivo: now() é o início da transação, não o commit. Um
-- push que começou antes deste pull e terminou depois grava updated_at menor
-- que o cursor e ficaria invisível para sempre. Reler um minuto custa
-- algumas linhas repetidas, e aplicar de novo é idempotente.
create or replace function pull_changes(desde timestamptz default null)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  t       text;
  linhas  jsonb;
  tabelas jsonb := '{}';
begin
  if auth.uid() is null then
    raise exception 'pull_changes exige usuário autenticado' using errcode = '28000';
  end if;

  foreach t in array sync_tabelas() loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %I x
        where $1 is null or x.updated_at > $1 - interval ''1 minute''', t)
      into linhas
      using desde;
    tabelas := tabelas || jsonb_build_object(t, linhas);
  end loop;

  return jsonb_build_object('tabelas', tabelas, 'cursor', now());
end $$;

-- Só quem está logado. O anon recebe EXECUTE por padrão no Supabase; as
-- funções já recusam sem uid, isto fecha a porta antes.
revoke execute on function push_changes(jsonb) from public, anon;
revoke execute on function pull_changes(timestamptz) from public, anon;
grant execute on function push_changes(jsonb) to authenticated;
grant execute on function pull_changes(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- [A] Privilégios: explícitos, não herdados.
--
-- O projeto é criado com "Automatically expose new tables" DESMARCADO, como o
-- Supabase recomenda. Então nada aqui depende de grant automático: o que o
-- app precisa está listado abaixo, e o resto é negado. Os testes rodam no
-- pior caso (sem grant automático nenhum) para provar que isto basta.
--
-- A RLS decide QUAIS linhas; estes grants decidem QUAIS operações.
--   authenticated: select, insert, update. Sem DELETE: o app só faz soft
--                  delete, então um token vazado não apaga histórico.
--   anon:          nada. Sem login não há o que ler.
-- O revoke primeiro deixa o resultado igual com a opção marcada ou não.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array sync_tabelas() loop
    execute format('grant select, insert, update on %I to authenticated', t);
  end loop;
end $$;

-- Funções chamadas por dentro do push/pull e dos triggers rodam como o
-- usuário logado (security invoker) e precisam de EXECUTE.
revoke execute on function sync_tabelas() from public, anon;
grant execute on function sync_tabelas() to authenticated;
revoke execute on function toca_updated_at() from public, anon;
grant execute on function toca_updated_at() to authenticated;
revoke execute on function tx_valida_categoria() from public, anon;
grant execute on function tx_valida_categoria() to authenticated;

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
-- [G] Pagamento de fatura é um tipo próprio, `pagamento_fatura`.
--     A compra no cartão já é a despesa, na data dela. Se o pagamento também
--     fosse `despesa`, cada compra contaria duas vezes no relatório. Se fosse
--     `transferencia`, faltaria a conta de destino — cartão não é conta.
--     O tipo próprio tira o dinheiro da conta (saldo) sem entrar em nenhum
--     total de gasto, e fica ligado à fatura que quita. No SQLite do aparelho
--     a regra é aplicada na camada de dados (src/data/cards.ts), com testes.
--
-- [I] import_batches.sha256 é único por usuário: reimportar o mesmo arquivo é
--     rejeitado pelo banco. É a defesa contra o erro mais comum do import.
--     Mas o hash do arquivo não basta: extratos com períodos sobrepostos têm
--     hashes diferentes e as mesmas transações. A defesa por LINHA é
--     transactions.id_externo, único por usuário (excluídas incluídas).
--
-- [M] instituicao é texto livre. Nome de banco em texto é descritivo e
--     aceitável; empacotar o logotipo do banco no app, não — é marca de
--     terceiro. O conjunto de ícones é próprio (replica-design).
--
-- [Y] O aparelho grava um user_id fixo; o servidor carimba auth.uid().
--     O banco local tem os dados de UMA pessoa, por construção, então o
--     user_id local é só um marcador. Quem decide de quem é a linha é o token
--     da sessão, no push_changes. Efeitos: os repositórios do app não
--     dependem de quem está logado, os dados de antes do login sobem sem
--     reescrita, e um app adulterado não consegue gravar em nome de outro.
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
