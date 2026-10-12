-- Lançar pelo WhatsApp. Aplicar DEPOIS do replica/schema.sql.
--
-- Fluxo: a pessoa manda "mercado 42,90" para o número do bot; a Meta chama a
-- Edge Function supabase/functions/whatsapp, que confere a assinatura, lê o
-- texto e chama as funções abaixo com a chave de serviço. O lançamento é
-- gravado na nuvem e chega ao celular no próximo pull — o bot só CRIA linhas
-- novas (e desfaz a última que ele mesmo criou), então não disputa nada com o
-- aparelho, que segue sendo o único escritor do resto.
--
-- Segurança, nesta ordem de importância:
--   1. O número do WhatsApp só escreve na conta a que foi VINCULADO, e o
--      vínculo exige um código que só o dono da conta vê, no app logado.
--   2. As funções do bot só o service_role executa (o app, como anon ou
--      authenticated, não chama whatsapp_lancar). Elas rodam COMO QUEM CHAMA
--      (security invoker): o service_role ignora a RLS no Supabase. Não são
--      SECURITY DEFINER de propósito — o dono das funções (postgres) não é
--      superusuário no Supabase, e com a RLS forçada seria barrado.
--   3. Toda escrita usa o user_id do vínculo, nunca um vindo da mensagem.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

-- Um número por conta, uma conta por número.
create table whatsapp_vinculos (
  user_id        uuid primary key references profiles(id) on delete cascade,
  telefone       text not null unique,          -- como a Meta manda: só dígitos, com DDI
  conta_id       uuid not null references accounts(id) on delete cascade,
  ultimo_tx_id   uuid references transactions(id) on delete set null,
  criado_em      timestamptz not null default now()
);

-- Código de vínculo: 6 dígitos, 10 minutos, uso único.
create table whatsapp_codigos (
  user_id   uuid primary key references profiles(id) on delete cascade,
  codigo    text not null,
  conta_id  uuid not null references accounts(id) on delete cascade,
  expira_em timestamptz not null
);

-- Tentativas erradas de código por número: 5 por hora, depois bloqueia.
create table whatsapp_tentativas (
  telefone text not null,
  em       timestamptz not null default now()
);
create index whatsapp_tentativas_idx on whatsapp_tentativas (telefone, em);

-- A Meta reenvia o webhook quando não recebe 200 a tempo. Sem isto, o mesmo
-- "mercado 42,90" viraria dois lançamentos.
create table whatsapp_mensagens (
  id          text primary key,                 -- wamid da Meta
  recebida_em timestamptz not null default now()
);

-- RLS forçada no vínculo, que o app lê. Nas outras três, RLS ligada SEM
-- política e sem grant para anon/authenticated: ninguém do app as alcança.
-- Não forçada nelas porque whatsapp_gerar_codigo (security definer) grava
-- em whatsapp_codigos como dono da tabela.
alter table whatsapp_vinculos   enable row level security;
alter table whatsapp_vinculos   force row level security;
alter table whatsapp_codigos    enable row level security;
alter table whatsapp_tentativas enable row level security;
alter table whatsapp_mensagens  enable row level security;

-- O dono vê e desfaz o próprio vínculo pelo app. O resto só via funções.
create policy whatsapp_vinculos_dono on whatsapp_vinculos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on whatsapp_vinculos, whatsapp_codigos, whatsapp_tentativas, whatsapp_mensagens
  from anon, authenticated;
grant select, delete on whatsapp_vinculos to authenticated;

-- O bot (service_role) precisa destas, e só destas. Explícito: o projeto
-- foi criado sem exposição automática de tabelas (nota [A] do schema.sql).
grant select, insert, update, delete on whatsapp_vinculos, whatsapp_codigos,
  whatsapp_tentativas, whatsapp_mensagens to service_role;
grant select on accounts, categories to service_role;
grant select, insert, update on transactions to service_role;
grant execute on function toca_updated_at(), tx_valida_categoria() to service_role;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------

-- Minúsculas e sem acento, para casar "saude" com "Saúde". translate() em vez
-- da extensão unaccent: existe em qualquer Postgres, inclusive no de teste.
create or replace function whatsapp_normalizar(t text) returns text
language sql immutable as $$
  select translate(lower(t),
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn')
$$;

-- "Hoje" no fuso de quem usa o app. O servidor está em UTC; às 22h de São
-- Paulo já é amanhã em UTC, e o lançamento cairia no dia errado.
create or replace function whatsapp_hoje() returns date
language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- ---------------------------------------------------------------------------
-- App (authenticated): gerar o código de vínculo
-- ---------------------------------------------------------------------------

create or replace function whatsapp_gerar_codigo(p_conta_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cod text;
begin
  if uid is null then
    raise exception 'exige usuário autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from accounts
                  where id = p_conta_id and user_id = uid and deleted_at is null) then
    raise exception 'conta não encontrada' using errcode = '22023';
  end if;
  -- gen_random_uuid usa o gerador forte do Postgres; random() não serve
  -- para segredo.
  cod := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint
               % 1000000)::text, 6, '0');
  insert into whatsapp_codigos (user_id, codigo, conta_id, expira_em)
  values (uid, cod, p_conta_id, now() + interval '10 minutes')
  on conflict (user_id) do update
    set codigo = excluded.codigo, conta_id = excluded.conta_id, expira_em = excluded.expira_em;
  return cod;
end $$;

revoke execute on function whatsapp_gerar_codigo(uuid) from public, anon;
grant execute on function whatsapp_gerar_codigo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bot (service_role): vincular, lançar, desfazer
-- ---------------------------------------------------------------------------

-- true se a mensagem é nova; false se é reenvio da Meta (ignorar).
create or replace function whatsapp_registrar_mensagem(p_id text) returns boolean
language plpgsql set search_path = public as $$
begin
  insert into whatsapp_mensagens (id) values (p_id) on conflict (id) do nothing;
  return found;
end $$;

-- Resultado: 'vinculado' | 'codigo_invalido' | 'bloqueado' | 'numero_em_uso'
create or replace function whatsapp_vincular(p_telefone text, p_codigo text) returns text
language plpgsql set search_path = public as $$
declare
  c whatsapp_codigos;
begin
  if (select count(*) from whatsapp_tentativas
       where telefone = p_telefone and em > now() - interval '1 hour') >= 5 then
    return 'bloqueado';
  end if;

  select * into c from whatsapp_codigos
   where codigo = p_codigo and expira_em > now()
   for update;
  if not found then
    insert into whatsapp_tentativas (telefone) values (p_telefone);
    return 'codigo_invalido';
  end if;

  if exists (select 1 from whatsapp_vinculos
              where telefone = p_telefone and user_id <> c.user_id) then
    return 'numero_em_uso';
  end if;

  insert into whatsapp_vinculos (user_id, telefone, conta_id)
  values (c.user_id, p_telefone, c.conta_id)
  on conflict (user_id) do update
    set telefone = excluded.telefone, conta_id = excluded.conta_id, ultimo_tx_id = null;
  delete from whatsapp_codigos where user_id = c.user_id;   -- uso único
  delete from whatsapp_tentativas where telefone = p_telefone;
  return 'vinculado';
end $$;

-- Grava um lançamento para o dono do número. A categoria vem como palavras
-- soltas da mensagem; casa com o nome da categoria do mesmo tipo (sem acento,
-- palavra inteira). Sem casamento, o lançamento entra sem categoria — melhor
-- registrado sem categoria do que perdido.
--
-- Resultado (jsonb): {ok:false, erro:'nao_vinculado'|'conta_indisponivel'}
--                 ou {ok:true, tx_id, tipo, valor, data, categoria, conta}
create or replace function whatsapp_lancar(
  p_telefone  text,
  p_kind      text,
  p_valor     bigint,
  p_data      date,
  p_palavras  text[],
  p_descricao text
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v       whatsapp_vinculos;
  conta   accounts;
  cat     categories;
  tx_id   uuid := gen_random_uuid();
  dia     date := coalesce(p_data, whatsapp_hoje());
begin
  if p_kind not in ('despesa', 'receita') then
    raise exception 'tipo inválido: %', p_kind using errcode = '22023';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor inválido' using errcode = '22023';
  end if;

  select * into v from whatsapp_vinculos where telefone = p_telefone;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nao_vinculado');
  end if;

  select * into conta from accounts
   where id = v.conta_id and user_id = v.user_id and deleted_at is null and not arquivada;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'conta_indisponivel');
  end if;

  -- Primeira categoria do tipo cujo nome tem uma das palavras como palavra
  -- inteira. Ordem: o nome mais curto primeiro ("Mercado" antes de
  -- "Mercado livre"), depois alfabética, para ser determinístico.
  select c.* into cat from categories c
   where c.user_id = v.user_id and c.tipo = p_kind and c.deleted_at is null
     and exists (
       select 1 from unnest(p_palavras) w
        where length(w) >= 3
          and whatsapp_normalizar(w) = any (
                regexp_split_to_array(whatsapp_normalizar(c.nome), '[^a-z0-9]+')))
   order by length(c.nome), c.nome
   limit 1;

  insert into transactions (id, user_id, kind, amount_cents, competencia, descricao,
                            category_id, account_id, pago, pago_em)
  values (tx_id, v.user_id, p_kind, p_valor, dia, left(coalesce(p_descricao, ''), 80),
          cat.id, conta.id, dia <= whatsapp_hoje(),
          case when dia <= whatsapp_hoje() then dia end);

  update whatsapp_vinculos set ultimo_tx_id = tx_id where user_id = v.user_id;

  return jsonb_build_object(
    'ok', true, 'tx_id', tx_id, 'tipo', p_kind, 'valor', p_valor, 'data', dia,
    'categoria', cat.nome, 'conta', conta.nome);
end $$;

-- Desfaz o último lançamento que o BOT criou para este número, se ainda
-- existir. Soft delete, como no app: a exclusão chega ao celular pelo pull.
-- Resultado: {ok:false, erro:'nao_vinculado'|'nada_a_desfazer'}
--         ou {ok:true, valor, descricao}
create or replace function whatsapp_desfazer(p_telefone text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v whatsapp_vinculos;
  t transactions;
begin
  select * into v from whatsapp_vinculos where telefone = p_telefone;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nao_vinculado');
  end if;
  select * into t from transactions
   where id = v.ultimo_tx_id and user_id = v.user_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nada_a_desfazer');
  end if;
  update transactions set deleted_at = now() where id = t.id;
  update whatsapp_vinculos set ultimo_tx_id = null where user_id = v.user_id;
  return jsonb_build_object('ok', true, 'valor', t.amount_cents, 'descricao', t.descricao);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'whatsapp_registrar_mensagem(text)',
    'whatsapp_vincular(text, text)',
    'whatsapp_lancar(text, text, bigint, date, text[], text)',
    'whatsapp_desfazer(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['whatsapp_normalizar(text)', 'whatsapp_hoje()'] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
