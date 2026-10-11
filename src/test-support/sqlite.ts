/** Banco de teste: SQLite REAL em memória, com a migração gerada aplicada.
 *
 *  O app usa o driver do expo-sqlite, que não carrega no Node. Aqui os
 *  repositórios rodam sobre o node:sqlite do Node 24 — o mesmo motor do
 *  aparelho —, então índice único, chave estrangeira e atomicidade de
 *  transação são exercitados, e não imaginados.
 *
 *  O adaptador dá ao node:sqlite a interface que o driver better-sqlite3 do
 *  Drizzle espera (prepare/transaction e run/all/get/raw). A sessão é montada
 *  direto do session.js, sem o driver.js, que importa o pacote nativo
 *  better-sqlite3 (não instalado). Conferido que a sessão do expo-sqlite tem
 *  a mesma semântica de transação: begin, callback síncrono, commit, e
 *  rollback + relançar em falha.
 *
 *  Fora do typecheck do app (tsconfig.json exclui src/test-support).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';

import type { SyncDb } from '@/data/cards';

export type Param = string | number | bigint | null | Uint8Array;

function statement(s: StatementSync) {
  const modo = (arrays: boolean) => ({
    run: (...p: Param[]) => {
      s.setReturnArrays(false);
      return s.run(...p);
    },
    all: (...p: Param[]) => {
      s.setReturnArrays(arrays);
      return s.all(...p);
    },
    get: (...p: Param[]) => {
      s.setReturnArrays(arrays);
      return s.get(...p);
    },
  });
  return { ...modo(false), raw: () => modo(true) };
}

function clienteNodeSqlite(raw: DatabaseSync) {
  return {
    prepare: (q: string) => statement(raw.prepare(q)),
    transaction<A, R>(fn: (arg: A) => R) {
      const em = (modo: string) => (arg: A): R => {
        raw.exec(`begin ${modo}`);
        try {
          const r = fn(arg);
          raw.exec('commit');
          return r;
        } catch (e) {
          raw.exec('rollback');
          throw e;
        }
      };
      return { deferred: em('deferred'), immediate: em('immediate'), exclusive: em('exclusive') };
    },
  };
}

export const TS = '2026-10-10T12:00:00.000Z';

/** Banco novo, migrado, com foreign keys ligadas. */
export function bancoDeTeste() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('pragma foreign_keys = on;');

  for (const f of readdirSync('drizzle').filter((x) => x.endsWith('.sql')).sort()) {
    const stmts = readFileSync(join('drizzle', f), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) raw.exec(s);
  }

  const dialect = new SQLiteSyncDialect();
  const session = new BetterSQLiteSession(clienteNodeSqlite(raw), dialect, undefined, {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new (BaseSQLiteDatabase as any)('sync', dialect, session, undefined) as SyncDb;

  const contar = (sqlText: string, ...p: Param[]) =>
    Number((raw.prepare(sqlText).get(...p) as { n: number }).n);

  /** Insere uma conta direto, para montar cenário. */
  const conta = (id: string, userId: string, saldoInicialCents = 0) =>
    raw
      .prepare(
        `insert into accounts (id,user_id,nome,tipo,icone,saldo_inicial_cents,arquivada,created_at,updated_at)
         values (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, userId, `Conta ${id}`, 'corrente', 'wallet', saldoInicialCents, 0, TS, TS);

  return { raw, db, contar, conta };
}
