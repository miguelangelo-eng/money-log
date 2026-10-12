import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoDoLimite, fracaoGasta, percentual } from './orcamento';

test('estado do limite: ok abaixo de 80%, atenção até 100%, estourado acima', () => {
  assert.equal(estadoDoLimite(0, 100000), 'ok');
  assert.equal(estadoDoLimite(79999, 100000), 'ok');
  assert.equal(estadoDoLimite(80000, 100000), 'atencao');
  assert.equal(estadoDoLimite(100000, 100000), 'atencao'); // gastar o limite é o combinado
  assert.equal(estadoDoLimite(100001, 100000), 'estourado');
});

test('percentual não mostra 100% antes de atingir o limite', () => {
  assert.equal(percentual(99960, 100000), 99);
  assert.equal(percentual(100000, 100000), 100);
  assert.equal(percentual(150000, 100000), 150);
  assert.equal(percentual(82000, 100000), 82);
});

test('fração não divide por zero', () => {
  assert.equal(fracaoGasta(500, 0), 0);
  assert.equal(fracaoGasta(150, 100), 1.5);
});
