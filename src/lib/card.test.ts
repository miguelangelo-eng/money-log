import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limiteDisponivel,
  planoDeCompra,
  statusDaFatura,
  totalDaFatura,
  PARCELAS_MAX,
} from './card';
import { sum } from './money';

const comum = { diaFechamento: 28, diaVencimento: 10 };

test('compra à vista: uma parcela, na fatura do mês', () => {
  const p = planoDeCompra('2026-10-10', comum, 4290, 1);
  assert.equal(p.length, 1);
  assert.equal(p[0].amountCents, 4290);
  assert.equal(p[0].competencia, '2026-10-10');
  assert.equal(p[0].fatura.mesReferencia, '2026-10-01');
  assert.equal(p[0].n, 1);
  assert.equal(p[0].de, 1);
});

test('parcelada: soma das parcelas é exatamente o total', () => {
  const p = planoDeCompra('2026-10-10', comum, 10000, 3);
  assert.deepEqual(p.map((x) => x.amountCents), [3334, 3333, 3333]);
  assert.equal(sum(p.map((x) => x.amountCents)), 10000);
});

test('parcelada: cada parcela em uma fatura consecutiva', () => {
  const p = planoDeCompra('2026-10-10', comum, 30000, 3);
  assert.deepEqual(
    p.map((x) => x.fatura.mesReferencia),
    ['2026-10-01', '2026-11-01', '2026-12-01'],
  );
});

test('parcelada depois do fechamento: a primeira já cai na fatura seguinte', () => {
  const p = planoDeCompra('2026-10-29', comum, 30000, 3);
  assert.deepEqual(
    p.map((x) => x.fatura.mesReferencia),
    ['2026-11-01', '2026-12-01', '2027-01-01'],
  );
});

test('competência avança um mês por parcela, com dia grampeado', () => {
  const p = planoDeCompra('2026-01-31', comum, 30000, 3);
  assert.deepEqual(
    p.map((x) => x.competencia),
    ['2026-01-31', '2026-02-28', '2026-03-31'],
  );
});

test('numeração n/de é coerente', () => {
  const p = planoDeCompra('2026-10-10', comum, 12000, 12);
  assert.deepEqual(p.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(p.every((x) => x.de === 12));
});

test('compra inválida é rejeitada', () => {
  assert.throws(() => planoDeCompra('2026-10-10', comum, 0, 1), RangeError);
  assert.throws(() => planoDeCompra('2026-10-10', comum, -100, 1), RangeError);
  assert.throws(() => planoDeCompra('2026-10-10', comum, 10.5, 1), RangeError);
  assert.throws(() => planoDeCompra('2026-10-10', comum, 1000, 0), RangeError);
  assert.throws(() => planoDeCompra('2026-10-10', comum, 1000, PARCELAS_MAX + 1), RangeError);
});

test('status: aberta até o dia do fechamento, inclusive', () => {
  assert.equal(statusDaFatura('2026-10-28', false, '2026-10-27'), 'aberta');
  assert.equal(statusDaFatura('2026-10-28', false, '2026-10-28'), 'aberta');
  assert.equal(statusDaFatura('2026-10-28', false, '2026-10-29'), 'fechada');
});

test('status: paga vence qualquer data', () => {
  assert.equal(statusDaFatura('2026-10-28', true, '2026-10-01'), 'paga');
  assert.equal(statusDaFatura('2026-10-28', true, '2027-01-01'), 'paga');
});

test('total: compras somam, estorno abate', () => {
  assert.equal(
    totalDaFatura([
      { kind: 'despesa', amountCents: 10000 },
      { kind: 'despesa', amountCents: 4290 },
      { kind: 'receita', amountCents: 1000 },
    ]),
    13290,
  );
});

test('total: o pagamento da fatura não é item da fatura', () => {
  // Se contasse, toda fatura paga apareceria com total zero.
  assert.equal(
    totalDaFatura([
      { kind: 'despesa', amountCents: 10000 },
      { kind: 'pagamento_fatura', amountCents: 10000 },
    ]),
    10000,
  );
});

test('total de fatura vazia é zero', () => {
  assert.equal(totalDaFatura([]), 0);
});

test('limite disponível desconta as faturas não pagas', () => {
  assert.equal(limiteDisponivel(500000, [12000, 3333, 3333]), 500000 - 18666);
});

test('limite estourado fica negativo, com sinal preservado', () => {
  assert.equal(limiteDisponivel(10000, [15000]), -5000);
});
