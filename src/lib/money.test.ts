import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCents,
  formatSigned,
  parseAmount,
  popDigit,
  pushDigit,
  splitInstallments,
  sum,
} from './money';

/** O espaço do pt-BR no Intl é U+00A0 (não-quebrável), não o espaço comum.
 *  Normalizar aqui evita um teste que falha por um caractere invisível. */
const nb = (s: string) => s.replace(/ /g, ' ');

test('formata centavos em pt-BR', () => {
  assert.equal(nb(formatCents(0)), 'R$ 0,00');
  assert.equal(nb(formatCents(4290)), 'R$ 42,90');
  assert.equal(nb(formatCents(123456)), 'R$ 1.234,56');
  assert.equal(nb(formatCents(100000000)), 'R$ 1.000.000,00');
});

test('rejeita valor não inteiro', () => {
  // Float em dinheiro é o bug que faz o saldo não fechar com o extrato.
  assert.throws(() => formatCents(42.9), TypeError);
});

test('sinal explícito, nunca só a cor', () => {
  assert.equal(nb(formatSigned(4290, 'despesa')), '− R$ 42,90');
  assert.equal(nb(formatSigned(4290, 'receita')), '+ R$ 42,90');
});

test('parse do que um teclado brasileiro produz', () => {
  assert.equal(parseAmount('42,90'), 4290);
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('R$ 1.234,56'), 123456);
  assert.equal(parseAmount('1234.56'), 123456); // ponto como decimal
  assert.equal(parseAmount('1234'), 123400);
  assert.equal(parseAmount('42,9'), 4290); // um decimal só
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
});

test('parse distingue milhar de decimal pelo tamanho da cauda', () => {
  assert.equal(parseAmount('1.234'), 123400); // 3 dígitos: milhar
  assert.equal(parseAmount('1.23'), 123); // 2 dígitos: decimal
  assert.equal(parseAmount('1.2'), 120); // 1 dígito: decimal
  assert.equal(parseAmount('12.345.678'), 1234567800);
});

test('entrada da direita para a esquerda, como app de banco', () => {
  let v = 0;
  for (const d of ['4', '2', '9', '0']) v = pushDigit(v, d);
  assert.equal(v, 4290); // R$ 42,90
  assert.equal(popDigit(v), 429); // R$ 4,29
  assert.equal(pushDigit(v, 'x'), v); // não-dígito é ignorado
});

test('parcelamento: a soma SEMPRE fecha com o total', () => {
  assert.deepEqual(splitInstallments(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(splitInstallments(10000, 1), [10000]);
  assert.deepEqual(splitInstallments(100, 3), [34, 33, 33]);
  assert.deepEqual(splitInstallments(2, 3), [1, 1, 0]);
  assert.deepEqual(splitInstallments(0, 3), [0, 0, 0]);
});

test('parcelamento: invariante da soma para todo total e todo n', () => {
  // É a propriedade que importa: nenhum centavo aparece nem desaparece.
  for (let total = 0; total <= 2000; total += 7) {
    for (let n = 1; n <= 24; n++) {
      const p = splitInstallments(total, n);
      assert.equal(p.length, n);
      assert.equal(sum(p), total, `total=${total} n=${n}`);
      // o resto vai nas primeiras: a lista nunca cresce
      for (let i = 1; i < p.length; i++) assert.ok(p[i] <= p[i - 1]);
    }
  }
});

test('parcelamento de valor negativo preserva o sinal e a soma', () => {
  const p = splitInstallments(-10000, 3);
  assert.deepEqual(p, [-3334, -3333, -3333]);
  assert.equal(sum(p), -10000);
});

test('número de parcelas inválido é rejeitado', () => {
  assert.throws(() => splitInstallments(1000, 0), RangeError);
  assert.throws(() => splitInstallments(1000, -1), RangeError);
  assert.throws(() => splitInstallments(1000, 1.5), RangeError);
});
