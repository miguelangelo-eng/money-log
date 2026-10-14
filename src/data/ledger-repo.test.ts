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
  /** O mesmo banco visto num outro dia — para testar o que acontece quando
   *  o app é aberto meses depois. */
  const repoEm = (hoje: string) => createLedgerRepo({ ...deps, hoje: () => hoje });
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

  return { raw, repo, repoEm, cartoes, contar, saldo };
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

test('excluir parcela do cartão: só esta, esta e as próximas, ou a compra inteira', async () => {
  const vivas = (amb: ReturnType<typeof ambiente>) =>
    amb.contar('select count(*) as n from transactions where deleted_at is null');

  const a = ambiente();
  const { ids: ia } = await cartaoComCompra(a, 3);
  assert.deepEqual(await a.repo.deleteTransaction(ia[1], 'esta'), { tipo: 'serie', removidos: 1 });
  assert.equal(await a.repo.getTransaction(ia[1]), null);
  assert.equal(vivas(a), 2);

  const b = ambiente();
  const { ids: ib } = await cartaoComCompra(b, 3);
  assert.deepEqual(await b.repo.deleteTransaction(ib[1], 'proximas'), { tipo: 'serie', removidos: 2 });
  assert.ok(await b.repo.getTransaction(ib[0]));
  assert.equal(vivas(b), 1);

  const c = ambiente();
  const { ids: ic } = await cartaoComCompra(c, 3);
  assert.deepEqual(await c.repo.deleteTransaction(ic[1], 'todas'), { tipo: 'serie', removidos: 3 });
  assert.equal(vivas(c), 0);
});

test('compra em fatura paga não é excluída, e nada é apagado', async () => {
  const amb = ambiente();
  const { card, ids } = await cartaoComCompra(amb, 3);
  const [out] = await amb.cartoes.invoices(card, '2026-10-29');
  await amb.cartoes.payInvoice({ invoiceId: out.id!, accountId: 'a', data: '2026-10-29' });

  const vivosAntes = amb.contar('select count(*) as n from transactions where deleted_at is null');
  await assert.rejects(amb.repo.deleteTransaction(ids[2], 'todas'), /fatura de outubro já foi paga/);
  await assert.rejects(amb.repo.deleteTransaction(ids[0], 'esta'), /fatura de outubro já foi paga/);
  assert.equal(amb.contar('select count(*) as n from transactions where deleted_at is null'), vivosAntes);

  // A parcela de dezembro está numa fatura em aberto: essa sai.
  assert.deepEqual(await amb.repo.deleteTransaction(ids[2], 'esta'), { tipo: 'serie', removidos: 1 });
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
  await assert.rejects(repo.updateTransaction(id, { amountCents: 1 }, 'esta', U2), /não encontrado/);
  await assert.rejects(repo.deleteTransaction(id, 'esta', U2), /não encontrado/);
  await assert.rejects(repo.marcarPago(id, false, U2), /não encontrado/);
  assert.equal((await repo.getTransaction(id))?.amountCents, 1000);
});

// ------------------------------------------------------------ grupo 2: séries

const vivasDaSerie = (amb: ReturnType<typeof ambiente>, id: string) =>
  amb.contar(
    `select count(*) as n from transactions
      where series_id = (select series_id from transactions where id = ?) and deleted_at is null`,
    id,
  );

const linhasDaSerie = (amb: ReturnType<typeof ambiente>, id: string) =>
  amb.raw
    .prepare(
      `select competencia, amount_cents as v, pago, parcela_n as n, deleted_at as del
         from transactions
        where series_id = (select series_id from transactions where id = ?)
        order by competencia`,
    )
    .all(id) as Array<{ competencia: string; v: number; pago: number; n: number | null; del: string | null }>;

test('parcelado em conta: valor dividido, um mês cada, só a de hoje paga', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({
    amountCents: 10000,
    accountId: 'a',
    categoryId: 'mercado',
    repeticao: { tipo: 'parcelado', parcelas: 3 },
  });
  const l = linhasDaSerie(amb, id);
  assert.deepEqual(
    l.map((x) => [x.competencia, x.v, x.pago, x.n]),
    [
      ['2026-10-10', 3334, 1, 1],
      ['2026-11-10', 3333, 0, 2],
      ['2026-12-10', 3333, 0, 3],
    ],
  );
  // Saldo só sente a parcela paga; o mês só vê a parcela dele.
  assert.equal(await amb.saldo('a'), 100000 - 3334);
  assert.equal((await amb.repo.monthTotals('2026-10-01')).despesaCents, 3334);
  assert.equal((await amb.repo.monthTotals('2026-12-01')).despesaCents, 3333);
});

test('parcelado: de 2 a 24 parcelas', async () => {
  const { repo } = ambiente();
  for (const parcelas of [1, 25, 2.5]) {
    await assert.rejects(
      repo.addExpense({ amountCents: 1000, accountId: 'a', repeticao: { tipo: 'parcelado', parcelas } }),
      /de 2 a 24/,
    );
  }
});

test('recorrente: valor cheio todo mês até 12 meses à frente, futuro pendente', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({
    amountCents: 150000,
    accountId: 'a',
    descricao: 'Aluguel',
    repeticao: { tipo: 'mensal' },
  });
  const l = linhasDaSerie(amb, id);
  assert.equal(l.length, 13); // outubro/2026 a outubro/2027
  assert.equal(l[0].competencia, '2026-10-10');
  assert.equal(l[12].competencia, '2027-10-10');
  assert.ok(l.every((x) => x.v === 150000 && x.n === null));
  assert.deepEqual(l.map((x) => x.pago), [1, ...Array(12).fill(0)]);
  assert.equal((await amb.repo.monthTotals('2027-03-01')).despesaCents, 150000);
});

test('recorrente no dia 31: fevereiro grampeia, março volta a 31', async () => {
  const amb = ambiente();
  const id = await amb.repo.addIncome({
    amountCents: 500000,
    accountId: 'a',
    competencia: '2026-10-31',
    repeticao: { tipo: 'mensal' },
  });
  const datas = linhasDaSerie(amb, id).map((x) => x.competencia);
  assert.deepEqual(datas.slice(0, 6), [
    '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31',
  ]);
});

test('renovar recorrências: idempotente hoje, completa o que falta meses depois', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({ amountCents: 5000, accountId: 'a', repeticao: { tipo: 'mensal' } });
  assert.equal(await amb.repo.estenderRecorrencias(), 0);
  assert.equal(await amb.repo.estenderRecorrencias(), 0);

  // Aberto três meses depois: o horizonte andou três meses.
  const depois = amb.repoEm('2027-01-15');
  assert.equal(await depois.estenderRecorrencias(), 3);
  assert.equal(await depois.estenderRecorrencias(), 0);
  const l = linhasDaSerie(amb, id);
  assert.equal(l[l.length - 1].competencia, '2028-01-10');
});

test('excluir "esta e as próximas" encerra a recorrência para sempre', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({ amountCents: 5000, accountId: 'a', repeticao: { tipo: 'mensal' } });
  const terceira = (await amb.repo.listByMonth('2026-12-01'))[0].id;

  assert.deepEqual(await amb.repo.escoposDaSerie(terceira), { esta: 1, proximas: 11, todas: 13 });
  assert.deepEqual(await amb.repo.deleteTransaction(terceira, 'proximas'), { tipo: 'serie', removidos: 11 });
  assert.equal(vivasDaSerie(amb, id), 2);

  assert.equal(await amb.repoEm('2028-06-01').estenderRecorrencias(), 0);
  assert.equal(vivasDaSerie(amb, id), 2);
});

test('excluir só a última ocorrência gerada NÃO encerra a recorrência', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({ amountCents: 5000, accountId: 'a', repeticao: { tipo: 'mensal' } });
  const ultima = (await amb.repo.listByMonth('2027-10-01'))[0].id;

  await amb.repo.deleteTransaction(ultima, 'esta');
  assert.equal(await amb.repo.getTransaction(ultima), null);
  assert.equal((await amb.repo.listByMonth('2027-11-01')).length, 1, 'a seguinte foi gerada');

  // Três meses depois: dezembro/2027 e janeiro/2028 entram.
  assert.equal(await amb.repoEm('2027-01-15').estenderRecorrencias(), 2);
  assert.equal(vivasDaSerie(amb, id), 12 + 1 + 2); // originais vivas + a gerada na exclusão + 2
});

test('editar "esta e as próximas": as anteriores ficam, e a renovação copia o novo valor', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({ amountCents: 150000, accountId: 'a', repeticao: { tipo: 'mensal' } });
  const janeiro = (await amb.repo.listByMonth('2027-01-01'))[0].id;

  await amb.repo.updateTransaction(janeiro, { amountCents: 165000, descricao: 'Aluguel reajustado' }, 'proximas');
  const v = linhasDaSerie(amb, id).map((x) => x.v);
  assert.deepEqual(v.slice(0, 3), [150000, 150000, 150000]);
  assert.ok(v.slice(3).every((x) => x === 165000));

  await amb.repoEm('2027-02-01').estenderRecorrencias();
  // Horizonte em 01/02/2028: a ocorrência nova é a de janeiro.
  const novo = (await amb.repo.listByMonth('2028-01-01'))[0];
  assert.equal(novo.amountCents, 165000);
  assert.equal(novo.descricao, 'Aluguel reajustado');
});

test('editar "todas" muda a categoria das parcelas do cartão', async () => {
  const amb = ambiente();
  const { ids } = await cartaoComCompra(amb, 3);
  await amb.repo.updateTransaction(ids[2], { categoryId: 'lazer' }, 'todas');
  for (const id of ids) assert.equal((await amb.repo.getTransaction(id))?.categoryId, 'lazer');
});

test('data numa série: uma ocorrência por vez, e dentro do mesmo mês', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({ amountCents: 5000, accountId: 'a', repeticao: { tipo: 'mensal' } });
  await assert.rejects(amb.repo.updateTransaction(id, { competencia: '2026-10-12' }, 'todas'), /só esta/);
  await assert.rejects(amb.repo.updateTransaction(id, { competencia: '2026-11-02' }, 'esta'), /mesmo mês/);

  await amb.repo.updateTransaction(id, { competencia: '2026-10-12' }, 'esta');
  assert.equal((await amb.repo.getTransaction(id))?.competencia, '2026-10-12');
  // As outras não andaram.
  assert.equal((await amb.repo.listByMonth('2026-11-01'))[0].competencia, '2026-11-10');
});

test('marcar como pago e pendente move o saldo; cartão não tem esse estado', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({ amountCents: 2000, accountId: 'a', pago: false });
  assert.equal(await amb.saldo('a'), 100000, 'pendente não sai do saldo');

  await amb.repo.marcarPago(id, true);
  const pago = await amb.repo.getTransaction(id);
  assert.equal(pago?.pago, true);
  assert.equal(pago?.pagoEm, HOJE);
  assert.equal(await amb.saldo('a'), 98000);

  await amb.repo.marcarPago(id, false);
  assert.equal((await amb.repo.getTransaction(id))?.pagoEm, null);
  assert.equal(await amb.saldo('a'), 100000);

  const { ids } = await cartaoComCompra(amb, 1);
  await assert.rejects(amb.repo.marcarPago(ids[0], false), /pela fatura/);
});

test('conta futura paga antes da data: o pago vale para a primeira ocorrência', async () => {
  const amb = ambiente();
  const id = await amb.repo.addExpense({
    amountCents: 9000,
    accountId: 'a',
    competencia: '2026-10-20',
    pago: true,
    repeticao: { tipo: 'mensal' },
  });
  const l = linhasDaSerie(amb, id);
  assert.deepEqual(l.slice(0, 3).map((x) => x.pago), [1, 0, 0]);
  assert.equal((await amb.repo.getTransaction(id))?.pagoEm, HOJE, 'pago hoje, não na data futura');
});

test('categoria nova guarda o ícone escolhido; fora do catálogo é recusado', async () => {
  const { repo } = ambiente();
  const id = await repo.addCategory({ nome: 'Pet', tipo: 'despesa', cor: '#1baf7a', icone: 'paw' });
  assert.equal((await repo.listCategories('despesa')).find((c) => c.id === id)?.icone, 'paw');
  await assert.rejects(
    repo.addCategory({ nome: 'X', tipo: 'despesa', cor: '#1baf7a', icone: 'nao-existe' }),
    /Ícone inválido/,
  );
  const semIcone = await repo.addCategory({ nome: 'Y', tipo: 'despesa', cor: '#1baf7a' });
  assert.equal((await repo.listCategories('despesa')).find((c) => c.id === semIcone)?.icone, 'tag');
});

test('transferência de conta não acompanhada vira receita na conta que recebeu, com os iguais', async () => {
  // Caso real: o salário cai no Santander (sem extrato no app) e vem por Pix
  // para o Nubank. Como transferência, não contava como entrada.
  const amb = ambiente();
  const pix = (competencia: string, de = 'b') =>
    amb.repo.addTransfer({ amountCents: 500000, competencia, deContaId: de, paraContaId: 'a', descricao: 'FULANO DE TAL' });
  const agosto = await pix('2026-08-05');
  await pix('2026-09-05');
  await pix('2026-10-05');
  await amb.repo.addTransfer({ amountCents: 1000, competencia: '2026-09-06', deContaId: 'b', paraContaId: 'a', descricao: 'OUTRA' });

  assert.equal(await amb.repo.contarTransferenciasIguais(agosto), 3);
  assert.equal(await amb.repo.converterTransferencia(agosto, 'receita', 'salario', true), 3);

  const t = await amb.repo.monthTotals('2026-09-01');
  assert.equal(t.receitaCents, 500000, 'o Pix do salário é entrada; a outra transferência, não');
  const set = (await amb.repo.listByMonth('2026-09-01')).find((x) => x.descricao === 'FULANO DE TAL')!;
  assert.deepEqual([set.kind, set.accountId, set.transferAccountId, set.categoryId], ['receita', 'a', null, 'salario']);
  assert.equal(await amb.saldo('a'), 100000 + 1500000 + 1000, 'a conta que recebeu continua com o dinheiro');
});

test('converter: só transferência, categoria do tipo certo, só esta quando pedido', async () => {
  const amb = ambiente();
  const id = await amb.repo.addTransfer({ amountCents: 2000, competencia: '2026-09-05', deContaId: 'a', paraContaId: 'b', descricao: 'LOJA' });
  await amb.repo.addTransfer({ amountCents: 3000, competencia: '2026-10-05', deContaId: 'a', paraContaId: 'b', descricao: 'LOJA' });
  await assert.rejects(amb.repo.converterTransferencia(id, 'despesa', 'salario'), /categoria é de receita/);

  assert.equal(await amb.repo.converterTransferencia(id, 'despesa', 'mercado'), 1);
  const gasto = await amb.repo.getTransaction(id);
  assert.deepEqual([gasto!.kind, gasto!.accountId], ['despesa', 'a'], 'gasto fica na conta que pagou');
  await assert.rejects(amb.repo.converterTransferencia(id, 'receita', 'salario'), /Só transferência/);
  assert.equal(await amb.saldo('a'), 100000 - 2000 - 3000);
});
