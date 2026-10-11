/** Servidor de teste: Postgres REAL em memória (PGlite, Postgres em WASM),
 *  com o replica/schema.sql aplicado do jeito que vai para o Supabase.
 *
 *  Não há Postgres nem Docker nesta máquina. Sem isto, o schema do servidor
 *  e a RLS só seriam executados pela primeira vez no projeto do Supabase —
 *  e "a outra pessoa não consegue ler os meus dados" é exatamente o tipo de
 *  coisa que não se descobre em produção.
 *
 *  O que é stub, imitando o Supabase:
 *    - o schema `auth`, com `auth.users` e `auth.uid()` lendo o `sub` do JWT
 *      em `request.jwt.claims`, como o PostgREST faz;
 *    - os papéis `anon` e `authenticated`, com os grants padrão do Supabase.
 *  O resto — tabelas, constraints, triggers, RLS, funções de sync — é o
 *  arquivo real, sem mudança.
 *
 *  Cuidado que vale para os testes: o dono das tabelas é superusuário, e
 *  superusuário IGNORA a RLS mesmo com `force`. Todo acesso que deve passar
 *  pela RLS tem de ir por `comoUsuario`, que troca para `authenticated`.
 */

import { readFileSync } from 'node:fs';

import { PGlite, type Transaction } from '@electric-sql/pglite';

import type { Transporte } from '@/sync/engine';

const STUB_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (
    id    uuid primary key,
    email text unique
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
      ''
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  -- O Supabase dá estes grants por padrão no schema public. Quem protege os
  -- dados é a RLS, não a falta de grant.
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public
    grant all on tables to anon, authenticated;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated;
`;

export const SCHEMA_SQL = readFileSync('replica/schema.sql', 'utf8');

export type Pg = PGlite;

/** Postgres novo com o stub do Supabase e o schema aplicado. */
export async function servidorDeTeste(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(STUB_SUPABASE);
  await pg.exec(SCHEMA_SQL);
  return pg;
}

/** Cria o usuário no auth, como o signup do Supabase faria. */
export async function criarUsuario(pg: PGlite, id: string, email = `${id}@teste`) {
  await pg.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
}

/** O transporte do motor de sync falando com este Postgres como `uid`.
 *  O resultado passa por texto e JSON.parse, para chegar no mesmo formato que
 *  o PostgREST entrega ao app (instantes como string, não Date). */
export function transportePg(pg: PGlite, uid: string | null): Transporte {
  const rpc = (q: string, arg: unknown) =>
    comoUsuario(pg, uid, async (tx) => {
      const r = await tx.query<{ r: string }>(q, [arg]);
      return JSON.parse(r.rows[0].r);
    });
  return {
    push: (mudancas) => rpc('select push_changes($1::jsonb)::text as r', JSON.stringify(mudancas)),
    pull: (desde) => rpc('select pull_changes($1::timestamptz)::text as r', desde),
  };
}

/** Roda `fn` como o usuário logado `uid`: papel `authenticated` e o `sub` do
 *  JWT preenchido. É o caminho que a requisição do app percorre. */
export async function comoUsuario<T>(
  pg: PGlite,
  uid: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return pg.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '',
    ]);
    return fn(tx);
  });
}
