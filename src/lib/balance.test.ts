import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saldoDaConta, type LinhaAgregada } from './balance';

const CARTEIRA = 'conta-carteira';
const NUBANK = 'conta-nubank';

const despesa = (accountId: string | null, total: number, pago = true): LinhaAgregada => ({
  accountId,
  transferAccountId: null,
  kind: 'despesa',
  pago,
  total,
});

const receita = (accountId: string | null, total: number, pago = true): LinhaAgregada => ({
  accountId,
  transferAccountId: null,
  kind: 'receita',
  pago,
  total,
});

const transferencia = (de: string, para: string, total: number, pago = true): LinhaAgregada => ({
  accountId: de,
  transferAccountId: para,
  kind: 'transferencia',
  pago,
  total,
});

test('sem movimento, o saldo é o inicial', () => {
  assert.equal(saldoDaConta(CARTEIRA, 5000, []), 5000);
});

test('despesa diminui o saldo', () => {
  assert.equal(saldoDaConta(CARTEIRA, 0, [despesa(CARTEIRA, 4290)]), -4290);
});

test('receita aumenta o saldo', () => {
  assert.equal(saldoDaConta(CARTEIRA, 0, [receita(CARTEIRA, 100000)]), 100000);
});

test('soma de vários lançamentos da mesma conta', () => {
  const linhas = [receita(CARTEIRA, 300000), despesa(CARTEIRA, 4290), despesa(CARTEIRA, 10000)];
  assert.equal(saldoDaConta(CARTEIRA, 0, linhas), 300000 - 4290 - 10000);
});

test('transferência sai da origem e entra no destino', () => {
  const linhas = [transferencia(CARTEIRA, NUBANK, 20000)];
  assert.equal(saldoDaConta(CARTEIRA, 50000, linhas), 30000);
  assert.equal(saldoDaConta(NUBANK, 0, linhas), 20000);
});

test('transferência conserva o dinheiro: a soma das contas não muda', () => {
  // O erro clássico: uma transferência contada como receita E despesa, ou só
  // num lado, cria ou destrói dinheiro. A soma tem que ser invariante.
  const linhas = [transferencia(CARTEIRA, NUBANK, 77777)];
  const antes = 100000 + 0;
  const depois = saldoDaConta(CARTEIRA, 100000, linhas) + saldoDaConta(NUBANK, 0, linhas);
  assert.equal(depois, antes);
});

test('transferência não conta como despesa nem receita da conta de destino', () => {
  const linhas = [transferencia(CARTEIRA, NUBANK, 20000)];
  // Se a transferência fosse tratada como despesa no destino, daria -20000.
  assert.equal(saldoDaConta(NUBANK, 0, linhas), 20000);
});

test('lançamento não pago não entra no saldo', () => {
  const linhas = [despesa(CARTEIRA, 9999, false), receita(CARTEIRA, 500, false)];
  assert.equal(saldoDaConta(CARTEIRA, 1000, linhas), 1000);
});

test('não pago não afeta transferência também', () => {
  const linhas = [transferencia(CARTEIRA, NUBANK, 20000, false)];
  assert.equal(saldoDaConta(CARTEIRA, 50000, linhas), 50000);
  assert.equal(saldoDaConta(NUBANK, 0, linhas), 0);
});

test('linhas de outra conta são ignoradas', () => {
  const linhas = [despesa(NUBANK, 4290), receita(NUBANK, 100)];
  assert.equal(saldoDaConta(CARTEIRA, 1000, linhas), 1000);
});

test('despesa sem conta (cartão) não move conta corrente', () => {
  // Lançamento de cartão tem accountId nulo; quem move o dinheiro é o
  // pagamento da fatura, que é uma transação própria.
  assert.equal(saldoDaConta(CARTEIRA, 1000, [despesa(null, 50000)]), 1000);
});

test('pagamento de fatura sai da conta que pagou', () => {
  const pagamento: LinhaAgregada = {
    accountId: CARTEIRA,
    transferAccountId: null,
    kind: 'pagamento_fatura',
    pago: true,
    total: 30000,
  };
  assert.equal(saldoDaConta(CARTEIRA, 100000, [pagamento]), 70000);
  assert.equal(saldoDaConta(NUBANK, 0, [pagamento]), 0);
});

test('compra no cartão + pagamento da fatura: o dinheiro sai uma vez só', () => {
  // A compra (accountId nulo) não mexe na conta; o pagamento mexe. Se a compra
  // também mexesse, o saldo cairia duas vezes pelo mesmo gasto.
  const linhas: LinhaAgregada[] = [
    despesa(null, 30000),
    { accountId: CARTEIRA, transferAccountId: null, kind: 'pagamento_fatura', pago: true, total: 30000 },
  ];
  assert.equal(saldoDaConta(CARTEIRA, 100000, linhas), 70000);
});

test('saldo pode ficar negativo e o sinal é preservado', () => {
  assert.equal(saldoDaConta(CARTEIRA, 0, [despesa(CARTEIRA, 42900)]), -42900);
});

test('saldo inicial negativo (conta no cheque especial) é respeitado', () => {
  assert.equal(saldoDaConta(CARTEIRA, -15000, [receita(CARTEIRA, 5000)]), -10000);
});
