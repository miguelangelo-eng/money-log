/** Testes de contas, categorias e lançamentos contra SQLite REAL, com a
 *  migração gerada. Banco e adaptador em src/test-support/sqlite.ts. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { bancoDeTeste, TS } from '@/test-support/sqlite';

import { createCardsRepo } from './cards';
import { createLedgerRepo } from './ledger-repo';

const U1 = 'usuario-1';
const U2 = 'usuario-2';
const HOJE = '2026-10-10';

function ambiente() {
  const { raw, db, contar, conta } = bancoDeTeste();
  const deps = { db, newId: randomUUID, nowIso: () => TS, userId: U1 };
  const repo = createLedgerRepo({ ...deps, hoje: () => HOJE });
  const cartoes = createCardsRepo(deps);
  conta('a', U1, 100000); // R$ 1.000
  conta('b', U1, 0);
  conta('x', U2, 0);

  const cat = (id: string, tipo: 'despesa' | 'receita', userId = U1) =>
    raw
      .prepare(
        `insert into categories (id,user_id,nome,tipo,icone,cor,created_at,updated_at) values (?,?,?,?,?,?,?,?)`,
      )
      .run(id, userId, `Cat ${id}`, tipo, 'tag', '#2a78d6', TS, TS);
  cat('mercado', 'despesa');
  cat('lazer', 'despesa');
  cat('salario', 'receita');

  const saldo = async (contaId: string) =>
    (await repo.accountBalances()).find((c) => c.id === contaId)!.saldoCents;

  return { raw, repo, cartoes, contar, saldo };
}

/** Cartão fechando dia 28, com uma compra parcelada já lançada. */
async function cartaoComCompra(amb: ReturnType<typeof ambiente>, parcelas = 3) {
  const card = await amb.cartoes.addCard({
    nome: 'Cartão',
    limiteCents: 500000,
    diaFechamento: 28,
    diaVencimento: 10,
    contaPagamentoId: 'a',
  });
  const ids = await amb.cartoes.addCardPurchase({
    cardId: card,
    amountCents: 30000,
    competencia: '2026-10-05',
    parcelas,
    categoryId: 'mercado',
  });
  return { card, ids };
}

// ---------------------------------------------------------------- semente

test('semente é idempotente', async () => {
  const { repo, contar } = ambiente();
  await repo.ensureSeed(U2);
  await repo.ensureSeed(U2);
  assert.equal(contar('select count(*) as n from profiles where id = ?', U2), 1);
  assert.equal(contar('select count(*) as n from categories where user_id = ?', U2), 10);
  // U2 já tinha a conta 'x' do cenário: a semente não cria Carteira por cima.
  assert.equal(contar('select count(*) as n from accounts where user_id = ?', U2), 1);
});

// ------------------------------------------------------------------ contas

test('cria conta e ela aparece com o saldo inicial', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addAccount({ nome: 'Nubank', tipo: 'corrente', saldoInicialCents: 25000 });
  assert.equal(await saldo(id), 25000);
});

test('saldo inicial negativo (cheque especial) é aceito', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addAccount({ nome: 'Especial', tipo: 'corrente', saldoInicialCents: -5000 });
  assert.equal(await saldo(id), -5000);
});

test('conta com nome repetido é recusada, sem diferenciar maiúsculas', async () => {
  const { repo } = ambiente();
  await repo.addAccount({ nome: 'Nubank', tipo: 'corrente', saldoInicialCents: 0 });
  await assert.rejects(
    repo.addAccount({ nome: '  nubank ', tipo: 'poupanca', saldoInicialCents: 0 }),
    /Já existe uma conta/,
  );
});

test('conta sem nome ou com tipo inválido é recusada', async () => {
  const { repo } = ambiente();
  await assert.rejects(repo.addAccount({ nome: ' ', tipo: 'corrente', saldoInicialCents: 0 }), /nome/);
  await assert.rejects(
    // @ts-expect-error tipo fora da lista, de propósito
    repo.addAccount({ nome: 'X', tipo: 'cripto', saldoInicialCents: 0 }),
    /Tipo de conta/,
  );
});

// -------------------------------------------------------------- categorias

test('cria categoria; mesmo nome é permitido em outro tipo', async () => {
  const { repo } = ambiente();
  await repo.addCategory({ nome: 'Freelas', tipo: 'receita', cor: '#008300' });
  await repo.addCategory({ nome: 'Freelas', tipo: 'despesa', cor: '#008300' });
  await assert.rejects(
    repo.addCategory({ nome: 'freelas', tipo: 'receita', cor: '#2a78d6' }),
    /Já existe uma categoria de receita/,
  );
});

test('categoria com cor inválida é recusada', async () => {
  const { repo } = ambiente();
  await assert.rejects(repo.addCategory({ nome: 'X', tipo: 'despesa', cor: 'azul' }), /Cor/);
});

// ------------------------------------------------------------- lançamentos

test('despesa com categoria de receita é recusada', async () => {
  const { repo } = ambiente();
  await assert.rejects(
    repo.addExpense({ amountCents: 1000, accountId: 'a', categoryId: 'salario' }),
    /é de receita/,
  );
});

test('lançamento em conta de outro usuário é recusado', async () => {
  const { repo } = ambiente();
  await assert.rejects(repo.addExpense({ amountCents: 1000, accountId: 'x' }), /Conta não encontrada/);
});

test('data passada entra como pago e no mês certo', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addExpense({ amountCents: 4290, accountId: 'a', competencia: '2026-10-09' });
  const tx = await repo.getTransaction(id);
  assert.equal(tx?.pago, true);
  assert.equal(tx?.competencia, '2026-10-09');
  assert.equal(await saldo('a'), 100000 - 4290);
  assert.equal((await repo.listByMonth('2026-10-01')).length, 1);
});

test('data futura entra como previsto e não mexe no saldo', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addExpense({ amountCents: 4290, accountId: 'a', competencia: '2026-10-20' });
  assert.equal((await repo.getTransaction(id))?.pago, false);
  assert.equal(await saldo('a'), 100000);
});

// ----------------------------------------------------------- transferência

test('transferência: sai de uma, entra na outra, total conservado', async () => {
  const { repo, saldo } = ambiente();
  await repo.addTransfer({ amountCents: 30000, deContaId: 'a', paraContaId: 'b' });
  assert.equal(await saldo('a'), 70000);
  assert.equal(await saldo('b'), 30000);
  assert.equal((await saldo('a')) + (await saldo('b')), 100000);
});

test('transferência não conta como gasto nem como entrada do mês', async () => {
  const { repo } = ambiente();
  await repo.addTransfer({ amountCents: 30000, deContaId: 'a', paraContaId: 'b' });
  assert.deepEqual(await repo.monthTotals('2026-10-01'), { receitaCents: 0, despesaCents: 0 });
});

test('transferência para a mesma conta ou de outro usuário é recusada', async () => {
  const { repo } = ambiente();
  await assert.rejects(repo.addTransfer({ amountCents: 100, deContaId: 'a', paraContaId: 'a' }), /diferentes/);
  await assert.rejects(repo.addTransfer({ amountCents: 100, deContaId: 'a', paraContaId: 'x' }), /Conta não encontrada/);
});

// ------------------------------------------------------------------ edição

test('editar valor e categoria reflete no saldo e no relatório', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addExpense({ amountCents: 1000, accountId: 'a', categoryId: 'mercado' });
  await repo.updateTransaction(id, { amountCents: 2500, categoryId: 'lazer', descricao: '  cinema ' });

  const tx = await repo.getTransaction(id);
  assert.equal(tx?.amountCents, 2500);
  assert.equal(tx?.categoryId, 'lazer');
  assert.equal(tx?.descricao, 'cinema');
  assert.equal(await saldo('a'), 100000 - 2500);
  const [fatia] = await repo.expensesByCategory('2026-10-01');
  assert.equal(fatia.categoryId, 'lazer');
});

test('mudar a data para o futuro vira previsto e devolve o saldo', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addExpense({ amountCents: 1000, accountId: 'a' });
  assert.equal(await saldo('a'), 99000);
  await repo.updateTransaction(id, { competencia: '2026-11-01' });
  assert.equal((await repo.getTransaction(id))?.pago, false);
  assert.equal(await saldo('a'), 100000);
});

test('trocar conta de despesa move o débito', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addExpense({ amountCents: 1000, accountId: 'a' });
  await repo.updateTransaction(id, { accountId: 'b' });
  assert.equal(await saldo('a'), 100000);
  assert.equal(await saldo('b'), -1000);
});

test('editar transferência: trocar destino', async () => {
  const { repo, saldo } = ambiente();
  const novo = await repo.addAccount({ nome: 'Poupança', tipo: 'poupanca', saldoInicialCents: 0 });
  const id = await repo.addTransfer({ amountCents: 30000, deContaId: 'a', paraContaId: 'b' });
  await repo.updateTransaction(id, { transferAccountId: novo });
  assert.equal(await saldo('b'), 0);
  assert.equal(await saldo(novo), 30000);
  await assert.rejects(repo.updateTransaction(id, { transferAccountId: 'a' }), /diferentes/);
});

test('editar categoria para uma de outro tipo é recusado', async () => {
  const { repo } = ambiente();
  const id = await repo.addExpense({ amountCents: 1000, accountId: 'a', categoryId: 'mercado' });
  await assert.rejects(repo.updateTransaction(id, { categoryId: 'salario' }), /é de receita/);
});

test('compra no cartão: muda categoria, mas não valor nem data', async () => {
  const amb = ambiente();
  const { ids } = await cartaoComCompra(amb, 1);
  await amb.repo.updateTransaction(ids[0], { categoryId: 'lazer' });
  assert.equal((await amb.repo.getTransaction(ids[0]))?.categoryId, 'lazer');
  await assert.rejects(amb.repo.updateTransaction(ids[0], { amountCents: 1 }), /exclua a compra/);
  await assert.rejects(amb.repo.updateTransaction(ids[0], { competencia: '2026-10-01' }), /exclua a compra/);
});

test('pagamento de fatura não se edita', async () => {
  const amb = ambiente();
  const { card } = await cartaoComCompra(amb, 1);
  const [f] = await amb.cartoes.invoices(card, '2026-10-29');
  const pag = await amb.cartoes.payInvoice({ invoiceId: f.id!, accountId: 'a', data: '2026-10-29' });
  await assert.rejects(amb.repo.updateTransaction(pag, { amountCents: 1 }), /Desfaça o pagamento/);
});

// ----------------------------------------------------------------- exclusão

test('excluir lançamento comum: some da lista, do saldo e do total', async () => {
  const { repo, saldo } = ambiente();
  const id = await repo.addExpense({ amountCents: 4290, accountId: 'a' });
  assert.deepEqual(await repo.deleteTransaction(id), { tipo: 'simples' });
  assert.equal(await saldo('a'), 100000);
  assert.equal((await repo.listByMonth('2026-10-01')).length, 0);
  assert.equal((await repo.monthTotals('2026-10-01')).despesaCents, 0);
  assert.equal(await repo.getTransaction(id), null);
});

test('excluir uma parcela apaga a compra inteira', async () => {
  const amb = ambiente();
  const { ids } = await cartaoComCompra(amb, 3);
  assert.deepEqual(await amb.repo.deleteTransaction(ids[1]), { tipo: 'compra', parcelas: 3 });
  for (const id of ids) assert.equal(await amb.repo.getTransaction(id), null);
  assert.equal(amb.contar('select count(*) as n from transactions where deleted_at is null'), 0);
});

test('compra em fatura paga não é excluída, e nada é apagado', async () => {
  const amb = ambiente();
  const { card, ids } = await cartaoComCompra(amb, 3);
  const [out] = await amb.cartoes.invoices(card, '2026-10-29');
  await amb.cartoes.payInvoice({ invoiceId: out.id!, accountId: 'a', data: '2026-10-29' });

  const vivosAntes = amb.contar('select count(*) as n from transactions where deleted_at is null');
  await assert.rejects(amb.repo.deleteTransaction(ids[2]), /fatura de outubro já foi paga/);
  assert.equal(amb.contar('select count(*) as n from transactions where deleted_at is null'), vivosAntes);
});

test('desfazer pagamento: fatura reabre, saldo volta, e dá para pagar de novo', async () => {
  const amb = ambiente();
  const { card, ids } = await cartaoComCompra(amb, 1);
  const [f] = await amb.cartoes.invoices(card, '2026-10-29');
  const pag = await amb.cartoes.payInvoice({ invoiceId: f.id!, accountId: 'a', data: '2026-10-29' });
  assert.equal(await amb.saldo('a'), 70000);

  assert.deepEqual(await amb.repo.deleteTransaction(pag), { tipo: 'pagamento_desfeito' });
  assert.equal(await amb.saldo('a'), 100000);
  const [reaberta] = await amb.cartoes.invoices(card, '2026-10-29');
  assert.equal(reaberta.status, 'fechada'); // não está mais paga; a data já passou do fechamento

  // Com o pagamento desfeito, a compra pode ser excluída...
  // ...mas antes, pagar de novo funciona e paga uma vez só.
  await amb.cartoes.payInvoice({ invoiceId: f.id!, accountId: 'b', data: '2026-10-30' });
  assert.equal(await amb.saldo('b'), -30000);
  assert.equal(
    amb.contar("select count(*) as n from transactions where kind = 'pagamento_fatura' and deleted_at is null"),
    1,
  );
  await assert.rejects(amb.repo.deleteTransaction(ids[0]), /já foi paga/);
});

test('pagar a fatura não aumenta o gasto do mês', async () => {
  // O "passo 5" do roteiro no aparelho, agora automático: a compra já contou
  // como despesa na data dela; o pagamento só tira o dinheiro da conta.
  const amb = ambiente();
  const { card } = await cartaoComCompra(amb, 1);
  const antes = await amb.repo.monthTotals('2026-10-01');
  const [f] = await amb.cartoes.invoices(card, '2026-10-29');
  await amb.cartoes.payInvoice({ invoiceId: f.id!, accountId: 'a', data: '2026-10-29' });
  assert.deepEqual(await amb.repo.monthTotals('2026-10-01'), antes);
  assert.equal(antes.despesaCents, 30000);
});

// --------------------------------------------------------------- isolamento

test('isolamento: outro usuário não lê, não edita e não exclui', async () => {
  const { repo } = ambiente();
  const id = await repo.addExpense({ amountCents: 1000, accountId: 'a' });
  assert.equal(await repo.getTransaction(id, U2), null);
  assert.deepEqual(await repo.listByMonth('2026-10-01', U2), []);
  await assert.rejects(repo.updateTransaction(id, { amountCents: 1 }, U2), /não encontrado/);
  await assert.rejects(repo.deleteTransaction(id, U2), /não encontrado/);
  assert.equal((await repo.getTransaction(id))?.amountCents, 1000);
});
