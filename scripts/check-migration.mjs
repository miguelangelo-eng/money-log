/** Aplica a migração gerada num SQLite em memória e verifica as invariantes.
 *
 *  Existe porque duas falhas de migração chegaram ao aparelho antes de serem
 *  notadas, e nenhuma das duas aparecia no typecheck nem no bundle: SQL
 *  inválido só falha quando o SQLite tenta executá-lo. O `node:sqlite` do
 *  Node 24 é o mesmo motor do dispositivo, então rodar aqui é barato e pega
 *  exatamente essa classe de erro.
 *
 *      node scripts/check-migration.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'drizzle';
const sqlFiles = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (sqlFiles.length === 0) {
  console.error('nenhuma migração em drizzle/ — rode `npm run db:generate`');
  process.exit(2);
}

const db = new DatabaseSync(':memory:');
db.exec('pragma foreign_keys = on;');

let aplicados = 0;
for (const f of sqlFiles) {
  const bruto = readFileSync(join(DIR, f), 'utf8');
  // O drizzle-kit separa os comandos com este marcador.
  const stmts = bruto
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of stmts) {
    try {
      db.exec(stmt);
      aplicados++;
    } catch (e) {
      console.error(`\nFALHOU em ${f}:\n`);
      console.error(stmt);
      console.error(`\n  -> ${e.message}\n`);
      process.exit(1);
    }
  }
}

console.log(`migração aplicada: ${aplicados} comandos, ${sqlFiles.length} arquivo(s)`);

// --- invariantes que o schema promete -------------------------------------

const tabelas = db
  .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
  .all()
  .map((r) => r.name);
console.log(`tabelas (${tabelas.length}): ${tabelas.join(', ')}`);

const indices = db
  .prepare("select count(*) as n from sqlite_master where type='index' and name not like 'sqlite_%'")
  .get().n;
console.log(`índices: ${indices}`);

const falhas = [];
const checa = (nome, fn) => {
  try {
    fn();
    console.log(`  ok    ${nome}`);
  } catch (e) {
    console.log(`  FALHA ${nome}: ${e.message}`);
    falhas.push(nome);
  }
};
const deveFalhar = (nome, fn) => {
  try {
    fn();
    console.log(`  FALHA ${nome}: deveria ter sido rejeitado e passou`);
    falhas.push(nome);
  } catch {
    console.log(`  ok    ${nome} (rejeitado como esperado)`);
  }
};

const ts = '2026-10-10T00:00:00.000Z';
const U = 'user-1';

console.log('\ninvariantes:');

checa('insere profile', () =>
  db.prepare('insert into profiles (id,nome,currency,created_at,updated_at) values (?,?,?,?,?)')
    .run(U, 'Eu', 'BRL', ts, ts),
);

checa('insere conta', () =>
  db.prepare(
    'insert into accounts (id,user_id,nome,tipo,icone,saldo_inicial_cents,arquivada,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)',
  ).run('acc-1', U, 'Carteira', 'dinheiro', 'wallet', 0, 0, ts, ts),
);

deveFalhar('conta com nome duplicado', () =>
  db.prepare(
    'insert into accounts (id,user_id,nome,tipo,icone,saldo_inicial_cents,arquivada,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)',
  ).run('acc-2', U, 'Carteira', 'dinheiro', 'wallet', 0, 0, ts, ts),
);

checa('insere categoria', () =>
  db.prepare(
    'insert into categories (id,user_id,nome,tipo,icone,cor,created_at,updated_at) values (?,?,?,?,?,?,?,?)',
  ).run('cat-1', U, 'Mercado', 'despesa', 'cart', '#2a78d6', ts, ts),
);

checa('insere despesa', () =>
  db.prepare(
    'insert into transactions (id,user_id,kind,amount_cents,currency,competencia,descricao,category_id,account_id,pago,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run('tx-1', U, 'despesa', 32000, 'BRL', '2026-10-10', 'Mercado', 'cat-1', 'acc-1', 1, ts, ts),
);

deveFalhar('lançamento com conta inexistente (FK)', () =>
  db.prepare(
    'insert into transactions (id,user_id,kind,amount_cents,currency,competencia,pago,account_id,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?)',
  ).run('tx-2', U, 'despesa', 100, 'BRL', '2026-10-10', 1, 'acc-inexistente', ts, ts),
);

// O par de índices parciais de budgets é a razão deste script existir.
checa('limite mensal', () =>
  db.prepare(
    'insert into budgets (id,user_id,category_id,mes_referencia,limite_cents,created_at,updated_at) values (?,?,?,?,?,?,?)',
  ).run('b-1', U, 'cat-1', '2026-10-01', 100000, ts, ts),
);
deveFalhar('segundo limite no MESMO mês', () =>
  db.prepare(
    'insert into budgets (id,user_id,category_id,mes_referencia,limite_cents,created_at,updated_at) values (?,?,?,?,?,?,?)',
  ).run('b-2', U, 'cat-1', '2026-10-01', 50000, ts, ts),
);
checa('limite em outro mês', () =>
  db.prepare(
    'insert into budgets (id,user_id,category_id,mes_referencia,limite_cents,created_at,updated_at) values (?,?,?,?,?,?,?)',
  ).run('b-3', U, 'cat-1', '2026-11-01', 100000, ts, ts),
);
checa('limite recorrente (mes nulo)', () =>
  db.prepare(
    'insert into budgets (id,user_id,category_id,mes_referencia,limite_cents,created_at,updated_at) values (?,?,?,?,?,?,?)',
  ).run('b-4', U, 'cat-1', null, 80000, ts, ts),
);
deveFalhar('segundo limite recorrente', () =>
  db.prepare(
    'insert into budgets (id,user_id,category_id,mes_referencia,limite_cents,created_at,updated_at) values (?,?,?,?,?,?,?)',
  ).run('b-5', U, 'cat-1', null, 70000, ts, ts),
);

checa('fatura por cartão e mês', () => {
  db.prepare(
    'insert into credit_cards (id,user_id,nome,icone,limite_cents,dia_fechamento,dia_vencimento,arquivado,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?)',
  ).run('cc-1', U, 'Cartao', 'card', 500000, 28, 10, 0, ts, ts);
  db.prepare(
    'insert into invoices (id,user_id,credit_card_id,mes_referencia,data_fechamento,data_vencimento,status,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)',
  ).run('inv-1', U, 'cc-1', '2026-10-01', '2026-10-28', '2026-11-10', 'aberta', ts, ts);
});
deveFalhar('fatura duplicada no mesmo mês', () =>
  db.prepare(
    'insert into invoices (id,user_id,credit_card_id,mes_referencia,data_fechamento,data_vencimento,status,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)',
  ).run('inv-2', U, 'cc-1', '2026-10-01', '2026-10-28', '2026-11-10', 'aberta', ts, ts),
);

deveFalhar('reimportar o mesmo arquivo (hash)', () => {
  db.prepare(
    'insert into import_batches (id,user_id,arquivo_nome,formato,sha256,total_linhas,importadas,ignoradas,status,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)',
  ).run('imp-1', U, 'extrato.ofx', 'ofx', 'abc123', 0, 0, 0, 'pendente', ts, ts);
  db.prepare(
    'insert into import_batches (id,user_id,arquivo_nome,formato,sha256,total_linhas,importadas,ignoradas,status,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)',
  ).run('imp-2', U, 'copia.ofx', 'ofx', 'abc123', 0, 0, 0, 'pendente', ts, ts);
});

db.close();

if (falhas.length > 0) {
  console.error(`\n${falhas.length} invariante(s) falhando: ${falhas.join(', ')}`);
  process.exit(1);
}
console.log('\ntodas as invariantes do schema passaram');
