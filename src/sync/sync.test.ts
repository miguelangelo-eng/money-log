/** Sync de ponta a ponta: SQLite real do lado do aparelho (node:sqlite, com
 *  as migrações do app) e Postgres real do lado do servidor (PGlite, com o
 *  replica/schema.sql inteiro, RLS incluída). Nada aqui é dublê, exceto o
 *  stub do `auth` do Supabase — ver src/test-support/postgres.ts.
 *
 *  Os primeiros testes são os da RLS: se um deles falhar, nada mais importa.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createCardsRepo } from '@/data/cards';
import { createLedgerRepo } from '@/data/ledger-repo';
import { bancoDeTeste, TS } from '@/test-support/sqlite';
import {
  comoUsuario,
  criarUsuario,
  servidorDeTeste,
  transportePg,
  type Pg,
} from '@/test-support/postgres';

import { createSync, ErroDeSync, instanteParaIso, type Transporte } from './engine';

const LOCAL = '00000000-0000-4000-8000-000000000001';
const HOJE = '2026-11-05';
const MES = '2026-10-01';

const TABELAS = [
  'profiles',
  'accounts',
  'credit_cards',
  'invoices',
  'categories',
  'import_batches',
  'transactions',
  'budgets',
  'alerts',
  'push_tokens',
];

async function servidor() {
  const pg = await servidorDeTeste();
  const ana = randomUUID();
  const bia = randomUUID();
  await criarUsuario(pg, ana);
  await criarUsuario(pg, bia);
  return { pg, ana, bia };
}

/** Um celular: banco local migrado, repositórios do app e o motor de sync
 *  falando com o servidor como `uid`. */
function aparelho(pg: Pg, uid: string, transporte: Transporte = transportePg(pg, uid)) {
  const { db, contar } = bancoDeTeste();
  const deps = { db, newId: randomUUID, nowIso: () => TS, userId: LOCAL };
  const repo = createLedgerRepo({ ...deps, hoje: () => HOJE });
  const cartoes = createCardsRepo(deps);
  const sync = createSync({ db, transporte, localUserId: LOCAL, nowIso: () => TS });
  const fila = () => contar('select count(*) as n from outbox');
  const sincronizar = () => sync.sincronizar(uid);
  return { db, repo, cartoes, sync, sincronizar, contar, fila };
}

/** Usa o app como alguém usaria: semeia, lança despesa, receita,
 *  transferência, compra parcelada no cartão, paga a fatura e exclui um
 *  lançamento. Cobre o ciclo fatura paga <-> pagamento. */
async function usarOApp(a: ReturnType<typeof aparelho>) {
  await a.repo.ensureSeed();
  const conta = (await a.repo.listAccounts())[0].id;
  const poupanca = await a.repo.addAccount({ nome: 'Poupança', tipo: 'poupanca', saldoInicialCents: 50000 });
  const [mercado] = await a.repo.listCategories('despesa');
  const [salario] = await a.repo.listCategories('receita');

  await a.repo.addIncome({ amountCents: 500000, competencia: '2026-10-01', categoryId: salario.id, accountId: conta });
  await a.repo.addExpense({ amountCents: 12345, competencia: '2026-10-03', categoryId: mercado.id, accountId: conta });
  const apagar = await a.repo.addExpense({ amountCents: 999, competencia: '2026-10-04', accountId: conta });
  await a.repo.addTransfer({ amountCents: 20000, competencia: '2026-10-06', deContaId: conta, paraContaId: poupanca });

  const card = await a.cartoes.addCard({
    nome: 'Cartão',
    limiteCents: 500000,
    diaFechamento: 28,
    diaVencimento: 10,
    contaPagamentoId: conta,
  });
  await a.cartoes.addCardPurchase({
    cardId: card,
    amountCents: 30000,
    competencia: '2026-10-05',
    parcelas: 3,
    categoryId: mercado.id,
  });
  const [primeira] = (await a.cartoes.invoices(card, HOJE)).filter((f) => f.status === 'fechada');
  await a.cartoes.payInvoice({ invoiceId: primeira.id!, accountId: conta, data: HOJE });

  await a.repo.deleteTransaction(apagar);
  return { card };
}

/** O que a pessoa vê no app. Se isto bate entre dois aparelhos, o sync
 *  preservou o que importa. */
async function retrato(a: ReturnType<typeof aparelho>, card: string) {
  return {
    saldos: (await a.repo.accountBalances()).map((c) => [c.nome, c.saldoCents]).sort(),
    mes: await a.repo.monthTotals(MES),
    porCategoria: await a.repo.expensesByCategory(MES),
    lancamentos: (await a.repo.listByMonth(MES)).map((t) => [t.id, t.amountCents, t.kind]).sort(),
    faturas: (await a.cartoes.invoices(card, HOJE)).map((f) => [f.mesReferencia, f.totalCents, f.status]),
  };
}

// ------------------------------------------------------------------ RLS

test('RLS: uma pessoa não enxerga NENHUMA linha da outra, em nenhuma tabela', async () => {
  const { pg, ana, bia } = await servidor();
  const celAna = aparelho(pg, ana);
  await celAna.sync.prepararAparelho(ana);
  await usarOApp(celAna);
  await celAna.sincronizar();

  const total = (uid: string | null, t: string) =>
    comoUsuario(pg, uid, async (tx) => Number((await tx.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n));

  // Sanidade: a Ana vê os próprios dados — senão "vazio" abaixo não provaria nada.
  assert.ok((await total(ana, 'transactions')) > 0);
  assert.ok((await total(ana, 'invoices')) > 0);

  for (const t of TABELAS) {
    assert.equal(await total(bia, t), 0, `bia enxergou linhas de ${t}`);
    // Sem login não há nem consulta: o anon não tem grant em tabela nenhuma.
    await assert.rejects(total(null, t), /permission denied/, `anônimo consultou ${t}`);
  }

  // Logado, ninguém apaga linha fisicamente, nem a própria: só soft delete.
  await assert.rejects(
    comoUsuario(pg, ana, (tx) => tx.query('delete from transactions')),
    /permission denied/,
  );

  const pullDaBia = await transportePg(pg, bia).pull(null);
  for (const t of TABELAS) assert.deepEqual(pullDaBia.tabelas[t], [], `pull da bia trouxe ${t}`);
});

test('RLS: sem login, as funções de sync recusam', async () => {
  const { pg } = await servidor();
  await assert.rejects(transportePg(pg, null).pull(null), /permission denied|autenticado/);
  await assert.rejects(transportePg(pg, null).push([]), /permission denied|autenticado/);
});

test('RLS: a Bia não sobrescreve uma linha da Ana sabendo o id', async () => {
  const { pg, ana, bia } = await servidor();
  const celAna = aparelho(pg, ana);
  await celAna.sync.prepararAparelho(ana);
  await celAna.repo.ensureSeed();
  await celAna.sincronizar();
  const conta = (await celAna.repo.listAccounts())[0];

  const ataque = transportePg(pg, bia).push([
    { tabela: 'profiles', linha: { id: bia, nome: 'Bia', currency: 'BRL', created_at: TS, updated_at: TS } },
    {
      tabela: 'accounts',
      linha: { ...conta, nome: 'invadida', saldo_inicial_cents: 1, user_id: ana, created_at: TS, updated_at: TS, tipo: 'dinheiro', icone: 'wallet', arquivada: false },
    },
  ]);
  await assert.rejects(ataque, /row-level security|policy/);

  const nome = await comoUsuario(pg, ana, async (tx) =>
    (await tx.query<{ nome: string }>('select nome from accounts where id = $1', [conta.id])).rows[0].nome,
  );
  assert.equal(nome, conta.nome);
});

test('o servidor carimba o dono pelo token, não pelo user_id que o aparelho manda', async () => {
  const { pg, ana, bia } = await servidor();
  const id = randomUUID();
  await transportePg(pg, bia).push([
    { tabela: 'profiles', linha: { id: ana, nome: 'Bia', currency: 'BRL', created_at: TS, updated_at: TS } },
    {
      tabela: 'accounts',
      linha: { id, user_id: ana, nome: 'X', tipo: 'dinheiro', icone: 'wallet', saldo_inicial_cents: 0, arquivada: false, created_at: TS, updated_at: TS },
    },
  ]);
  const dono = (await pg.query<{ user_id: string }>('select user_id from accounts where id = $1', [id])).rows[0].user_id;
  assert.equal(dono, bia);
  assert.equal((await pg.query('select 1 from profiles where id = $1', [ana])).rows.length, 0);
});

test('updated_at é o relógio do servidor também no insert', async () => {
  const { pg, bia } = await servidor();
  await transportePg(pg, bia).push([
    { tabela: 'profiles', linha: { id: bia, nome: 'Bia', currency: 'BRL', created_at: TS, updated_at: '2001-01-01T00:00:00Z' } },
  ]);
  const r = await pg.query<{ u: Date }>('select updated_at as u from profiles where id = $1', [bia]);
  assert.ok(r.rows[0].u.getUTCFullYear() > 2001);
});

// ---------------------------------------------------------- ponta a ponta

test('reinstalar e logar traz tudo de volta, igual ao que estava na tela', async () => {
  const { pg, ana } = await servidor();
  const antes = aparelho(pg, ana);
  assert.equal(await antes.sync.prepararAparelho(ana), 'novo');
  const { card } = await usarOApp(antes);
  await antes.sincronizar();
  assert.equal(antes.fila(), 0, 'push deixou fila');

  const depois = aparelho(pg, ana); // app reinstalado: banco vazio
  assert.equal(await depois.sync.prepararAparelho(ana), 'baixou_da_nuvem');

  assert.deepEqual(await retrato(depois, card), await retrato(antes, card));
  assert.equal(depois.fila(), 0, 'aplicar o pull não pode reenfileirar o que veio do servidor');
});

test('o eco do próprio push não volta para a fila', async () => {
  const { pg, ana } = await servidor();
  const cel = aparelho(pg, ana);
  await cel.sync.prepararAparelho(ana);
  await usarOApp(cel);
  const r = await cel.sincronizar();
  assert.ok(r.enviadas > 0);
  assert.ok(r.recebidas > 0, 'o pull relê o que acabou de subir');
  assert.equal(cel.fila(), 0);
  assert.deepEqual(await cel.sincronizar(), { enviadas: 0, recebidas: r.recebidas });
});

test('dados de antes do login sobem no primeiro login', async () => {
  const { pg, ana } = await servidor();
  const cel = aparelho(pg, ana);
  const { card } = await usarOApp(cel);
  // Banco de antes do M1: as linhas existiam, a fila não.
  cel.db.run(sql`delete from outbox`);

  assert.equal(await cel.sync.prepararAparelho(ana), 'subiu_dados_locais');
  await cel.sincronizar();

  const outro = aparelho(pg, ana);
  await outro.sync.prepararAparelho(ana);
  assert.deepEqual(await retrato(outro, card), await retrato(cel, card));
});

test('o pull não atropela uma edição local que ainda não subiu', async () => {
  const { pg, ana } = await servidor();
  const a = aparelho(pg, ana);
  await a.sync.prepararAparelho(ana);
  await a.repo.ensureSeed();
  const conta = (await a.repo.listAccounts())[0].id;
  const tx = await a.repo.addExpense({ amountCents: 1000, competencia: '2026-10-10', accountId: conta, descricao: 'original' });
  await a.sincronizar();

  const b = aparelho(pg, ana);
  await b.sync.prepararAparelho(ana);

  await a.repo.updateTransaction(tx, { descricao: 'editada no A' });
  await a.sincronizar();

  await b.repo.updateTransaction(tx, { descricao: 'editada no B, offline' });
  await b.sync.pull();
  assert.equal((await b.repo.getTransaction(tx))!.descricao, 'editada no B, offline');

  await b.sincronizar();
  await a.sincronizar();
  assert.equal((await a.repo.getTransaction(tx))!.descricao, 'editada no B, offline');
});

test('exclusão sobe como soft delete e some do outro aparelho', async () => {
  const { pg, ana } = await servidor();
  const a = aparelho(pg, ana);
  await a.sync.prepararAparelho(ana);
  await a.repo.ensureSeed();
  const conta = (await a.repo.listAccounts())[0].id;
  const tx = await a.repo.addExpense({ amountCents: 1000, competencia: '2026-10-10', accountId: conta });
  await a.sincronizar();

  const b = aparelho(pg, ana);
  await b.sync.prepararAparelho(ana);
  assert.ok(await b.repo.getTransaction(tx));

  await a.repo.deleteTransaction(tx);
  await a.sincronizar();
  await b.sincronizar();
  assert.equal(await b.repo.getTransaction(tx), null);
});

test('primeiro login com dados no aparelho E na nuvem é recusado, sem mexer em nada', async () => {
  const { pg, ana } = await servidor();
  const a = aparelho(pg, ana);
  await a.sync.prepararAparelho(ana);
  await a.repo.ensureSeed();
  await a.sincronizar();

  const b = aparelho(pg, ana);
  await b.repo.ensureSeed(); // usou o app antes de logar
  const filaAntes = b.fila();
  await assert.rejects(
    b.sync.prepararAparelho(ana),
    (e) => e instanceof ErroDeSync && e.codigo === 'conflito_primeiro_login',
  );
  assert.equal(b.fila(), filaAntes);
  assert.equal(b.sync.estado().dono, null);

  // A saída oferecida: ficar com a nuvem.
  b.sync.apagarDadosLocais();
  assert.equal(await b.sync.prepararAparelho(ana), 'baixou_da_nuvem');
  assert.equal(b.contar('select count(*) as n from categories'), a.contar('select count(*) as n from categories'));
});

test('outra pessoa não entra num aparelho que já tem dono', async () => {
  const { pg, ana, bia } = await servidor();
  const cel = aparelho(pg, ana);
  await cel.sync.prepararAparelho(ana);
  await cel.repo.ensureSeed();

  await assert.rejects(
    cel.sync.prepararAparelho(bia),
    (e) => e instanceof ErroDeSync && e.codigo === 'outro_usuario',
  );

  // Logado como a Bia, o sync deste aparelho não pode subir os dados da Ana.
  await assert.rejects(
    cel.sync.sincronizar(bia),
    (e) => e instanceof ErroDeSync && e.codigo === 'outro_usuario',
  );
  assert.ok(cel.fila() > 0, 'a fila da Ana continua intacta');
  const daBia = await transportePg(pg, bia).pull(null);
  assert.deepEqual(daBia.tabelas.accounts, []);

  cel.sync.apagarDadosLocais();
  assert.equal(cel.contar('select count(*) as n from accounts'), 0);
  assert.equal(await cel.sync.prepararAparelho(bia), 'novo');
});

test('push que falha mantém a fila inteira para a próxima tentativa', async () => {
  const { pg, ana } = await servidor();
  let fora = true;
  const real = transportePg(pg, ana);
  const instavel: Transporte = {
    push: (m) => (fora ? Promise.reject(new Error('sem rede')) : real.push(m)),
    pull: (d) => real.pull(d),
  };
  const cel = aparelho(pg, ana, instavel);
  await cel.sync.prepararAparelho(ana);
  await cel.repo.ensureSeed();
  const fila = cel.fila();
  assert.ok(fila > 0);

  await assert.rejects(cel.sincronizar(), /sem rede/);
  assert.equal(cel.fila(), fila);
  assert.equal(cel.contar('select min(tentativas) as n from outbox'), 1);

  fora = false;
  await cel.sincronizar();
  assert.equal(cel.fila(), 0);
});

test('recorrência baixada em outro aparelho não é duplicada ao renovar', async () => {
  const { pg, ana } = await servidor();
  const a = aparelho(pg, ana);
  await a.sync.prepararAparelho(ana);
  await a.repo.ensureSeed();
  const conta = (await a.repo.listAccounts())[0].id;
  await a.repo.addExpense({ amountCents: 150000, accountId: conta, repeticao: { tipo: 'mensal' } });
  await a.sincronizar();

  const b = aparelho(pg, ana);
  await b.sync.prepararAparelho(ana);
  const contarSerie = (x: ReturnType<typeof aparelho>) =>
    x.contar('select count(*) as n from transactions where series_id is not null and deleted_at is null');
  assert.equal(contarSerie(b), 13);
  assert.equal(await b.repo.estenderRecorrencias(), 0, 'o outro aparelho já gerou até o horizonte');
  assert.equal(b.fila(), 0);
});

test('instante do Postgres vira o ISO que o app grava', () => {
  assert.equal(instanteParaIso('2026-10-11T12:00:00.123456+00:00'), '2026-10-11T12:00:00.123Z');
  assert.equal(instanteParaIso('2026-10-11 09:00:00-03'), '2026-10-11T12:00:00.000Z');
  assert.equal(instanteParaIso('2026-10-11T12:00:00Z'), '2026-10-11T12:00:00.000Z');
});
