/** Orçamento contra SQLite real, com a migração real. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { bancoDeTeste, TS } from '@/test-support/sqlite';

import { createBudgetsRepo } from './budgets';
import { createCardsRepo } from './cards';
import { createLedgerRepo } from './ledger-repo';

const U1 = 'usuario-1';
const U2 = 'usuario-2';

function ambiente() {
  const { raw, db, contar, conta } = bancoDeTeste();
  const deps = { db, newId: randomUUID, nowIso: () => TS, userId: U1 };
  const repo = createLedgerRepo({ ...deps, hoje: () => '2026-10-10' });
  const orc = createBudgetsRepo(deps);
  const cartoes = createCardsRepo(deps);
  conta('a', U1, 100000);
  const cat = (id: string, tipo: 'despesa' | 'receita', userId = U1) =>
    raw
      .prepare(
        `insert into categories (id,user_id,nome,tipo,icone,cor,created_at,updated_at) values (?,?,?,?,?,?,?,?)`,
      )
      .run(id, userId, `Cat ${id}`, tipo, 'tag', '#2a78d6', TS, TS);
  cat('mercado', 'despesa');
  cat('lazer', 'despesa');
  cat('salario', 'receita');
  cat('outro', 'despesa', U2);
  const doMes = async (mes: string, categoria: string) =>
    (await orc.doMes(mes)).find((l) => l.categoria.id === categoria)!;
  return { raw, repo, orc, cartoes, contar, doMes };
}

test('gasto do mês por categoria: conta e cartão, pago e previsto; receita não entra', async () => {
  const amb = ambiente();
  await amb.repo.addExpense({ amountCents: 30000, accountId: 'a', categoryId: 'mercado' });
  await amb.repo.addExpense({ amountCents: 5000, accountId: 'a', categoryId: 'mercado', competencia: '2026-10-25' });
  await amb.repo.addExpense({ amountCents: 9999, accountId: 'a', categoryId: 'mercado', competencia: '2026-11-01' });
  const card = await amb.cartoes.addCard({
    nome: 'C', limiteCents: 100000, diaFechamento: 28, diaVencimento: 10, contaPagamentoId: 'a',
  });
  await amb.cartoes.addCardPurchase({
    cardId: card, amountCents: 20000, competencia: '2026-10-05', parcelas: 2, categoryId: 'mercado',
  });
  await amb.repo.addIncome({ amountCents: 500000, accountId: 'a', categoryId: 'salario' });

  // 300 + 50 (previsto) + 100 (1ª parcela do cartão); novembro e receita fora.
  assert.equal((await amb.doMes('2026-10-15', 'mercado')).gastoCents, 45000);
  assert.ok(!(await amb.orc.doMes('2026-10-01')).some((l) => l.categoria.id === 'salario'));
});

test('limite recorrente vale todo mês; o do mês tem prioridade só nele', async () => {
  const amb = ambiente();
  await amb.orc.definir({ categoryId: 'mercado', limiteCents: 100000, mes: null });
  await amb.orc.definir({ categoryId: 'mercado', limiteCents: 150000, mes: '2026-12-20' });

  assert.deepEqual(
    [(await amb.doMes('2026-10-01', 'mercado')).limiteCents, (await amb.doMes('2026-10-01', 'mercado')).origem],
    [100000, 'recorrente'],
  );
  const dez = await amb.doMes('2026-12-01', 'mercado');
  assert.deepEqual([dez.limiteCents, dez.origem], [150000, 'mes']);
  assert.equal((await amb.doMes('2027-01-01', 'mercado')).limiteCents, 100000, 'o mês virou');
  assert.equal((await amb.doMes('2026-10-01', 'lazer')).limiteCents, null);
});

test('remover o limite do mês faz o recorrente voltar; definir de novo reaproveita a linha', async () => {
  const amb = ambiente();
  await amb.orc.definir({ categoryId: 'mercado', limiteCents: 100000, mes: null });
  const id = await amb.orc.definir({ categoryId: 'mercado', limiteCents: 150000, mes: '2026-12-01' });

  await amb.orc.remover({ categoryId: 'mercado', mes: '2026-12-01' });
  assert.equal((await amb.doMes('2026-12-01', 'mercado')).limiteCents, 100000);

  // O índice único do SQLite não ignora linha excluída: inserir outra quebraria.
  const denovo = await amb.orc.definir({ categoryId: 'mercado', limiteCents: 120000, mes: '2026-12-01' });
  assert.equal(denovo, id);
  assert.equal((await amb.doMes('2026-12-01', 'mercado')).limiteCents, 120000);

  await amb.orc.remover({ categoryId: 'mercado', mes: null });
  await amb.orc.definir({ categoryId: 'mercado', limiteCents: 90000, mes: null });
  assert.equal(amb.contar('select count(*) as n from budgets'), 2);
});

test('limite: só despesa, só do usuário, só maior que zero', async () => {
  const amb = ambiente();
  await assert.rejects(amb.orc.definir({ categoryId: 'salario', limiteCents: 1000, mes: null }), /só para categoria de despesa/);
  await assert.rejects(amb.orc.definir({ categoryId: 'outro', limiteCents: 1000, mes: null }), /não encontrada/);
  await assert.rejects(amb.orc.definir({ categoryId: 'mercado', limiteCents: 0, mes: null }), /maior que zero/);
  await assert.rejects(amb.orc.definir({ categoryId: 'mercado', limiteCents: 10.5, mes: null }), /maior que zero/);
  assert.ok(!(await amb.orc.doMes('2026-10-01')).some((l) => l.categoria.id === 'outro'));
});
