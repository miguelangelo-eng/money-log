import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closingDate,
  dueDate,
  invoiceForPurchase,
  invoicesForInstallments,
  isClosed,
  type CardCycle,
} from './invoice';
import { clampDay, daysInMonth } from './civil-date';

/** O ciclo mais comum no Brasil: fecha dia 28, vence dia 10 do mês seguinte. */
const comum: CardCycle = { diaFechamento: 28, diaVencimento: 10 };

test('compra antes do fechamento entra na fatura do mês', () => {
  assert.equal(invoiceForPurchase('2026-10-27', comum).mesReferencia, '2026-10-01');
});

test('compra NO dia do fechamento ainda entra na fatura que fecha', () => {
  // Regra fixada em invoice.ts. É a borda que mais gera divergência entre telas.
  assert.equal(invoiceForPurchase('2026-10-28', comum).mesReferencia, '2026-10-01');
});

test('compra um dia depois do fechamento vai para a fatura seguinte', () => {
  assert.equal(invoiceForPurchase('2026-10-29', comum).mesReferencia, '2026-11-01');
});

test('vencimento menor que fechamento vence no mês seguinte', () => {
  assert.equal(invoiceForPurchase('2026-10-27', comum).dataVencimento, '2026-11-10');
});

test('vencimento maior que fechamento vence no mesmo mês', () => {
  const cedo: CardCycle = { diaFechamento: 5, diaVencimento: 15 };
  assert.equal(dueDate(2026, 10, cedo), '2026-10-15');
});

test('fechamento dia 31 é grampeado em fevereiro', () => {
  const dia31: CardCycle = { diaFechamento: 31, diaVencimento: 10 };
  assert.equal(closingDate(2026, 2, dia31), '2026-02-28');
  assert.equal(closingDate(2028, 2, dia31), '2028-02-29'); // bissexto
  assert.equal(closingDate(2026, 4, dia31), '2026-04-30'); // abril tem 30
  assert.equal(closingDate(2100, 2, dia31), '2100-02-28'); // século não bissexto
});

test('fechamento dia 31: compra em 28/02 entra na fatura de fevereiro', () => {
  const dia31: CardCycle = { diaFechamento: 31, diaVencimento: 10 };
  // O fechamento de fevereiro é 28/02, e a compra é NO dia: entra.
  assert.equal(invoiceForPurchase('2026-02-28', dia31).mesReferencia, '2026-02-01');
});

test('compra em dezembro depois do fechamento vira o ano', () => {
  assert.equal(invoiceForPurchase('2026-12-29', comum).mesReferencia, '2027-01-01');
  assert.equal(invoiceForPurchase('2026-12-29', comum).dataVencimento, '2027-02-10');
});

test('parcelamento distribui nas faturas consecutivas', () => {
  const refs = invoicesForInstallments('2026-10-29', comum, 3).map((f) => f.mesReferencia);
  assert.deepEqual(refs, ['2026-11-01', '2026-12-01', '2027-01-01']);
});

test('parcelamento longo atravessa o ano sem buraco', () => {
  const refs = invoicesForInstallments('2026-10-01', comum, 15).map((f) => f.mesReferencia);
  assert.equal(refs.length, 15);
  assert.equal(refs[0], '2026-10-01');
  assert.equal(refs[14], '2027-12-01');
  // nenhum mês repetido e todos em ordem crescente
  assert.equal(new Set(refs).size, 15);
  assert.deepEqual([...refs].sort(), refs);
});

test('fatura fechada quando hoje passou do fechamento', () => {
  const f = invoiceForPurchase('2026-10-10', comum);
  assert.equal(isClosed(f, '2026-10-27'), false);
  assert.equal(isClosed(f, '2026-10-28'), false); // no dia ainda está aberta
  assert.equal(isClosed(f, '2026-10-29'), true);
});

test('ciclo inválido é rejeitado, não silenciosamente corrigido', () => {
  assert.throws(() => invoiceForPurchase('2026-10-10', { diaFechamento: 0, diaVencimento: 10 }));
  assert.throws(() => invoiceForPurchase('2026-10-10', { diaFechamento: 32, diaVencimento: 10 }));
  assert.throws(() => invoiceForPurchase('2026-10-10', { diaFechamento: 28, diaVencimento: 0 }));
});

test('data civil inválida é rejeitada', () => {
  assert.throws(() => invoiceForPurchase('2026-02-30', comum)); // 30 de fevereiro
  assert.throws(() => invoiceForPurchase('2026-13-01', comum));
  assert.throws(() => invoiceForPurchase('10/10/2026', comum));
});

test('invariante: todo dia do ano cai em exatamente uma fatura, sem buraco', () => {
  // Varre 2026 inteiro em vários ciclos e confere que a referência só avança.
  for (const ciclo of [
    comum,
    { diaFechamento: 1, diaVencimento: 10 },
    { diaFechamento: 31, diaVencimento: 10 },
    { diaFechamento: 15, diaVencimento: 25 },
  ] as CardCycle[]) {
    let anterior = '';
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= daysInMonth(2026, m); d++) {
        const dia = clampDay(2026, m, d);
        const ref = invoiceForPurchase(dia, ciclo).mesReferencia;
        assert.ok(ref >= anterior, `${dia} regrediu de ${anterior} para ${ref}`);
        anterior = ref;
      }
    }
  }
});
