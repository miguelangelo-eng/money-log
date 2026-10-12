import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agruparParaRosca, arcos, ID_OUTRAS, pathDoSetor, percentuaisInteiros } from './rosca';

const f = (id: string, totalCents: number) => ({ id, totalCents });

test('até 6 categorias, todas viram fatia, da maior para a menor', () => {
  const r = agruparParaRosca([f('a', 100), f('b', 300), f('c', 200)]);
  assert.deepEqual(r.map((x) => x.id), ['b', 'c', 'a']);
});

test('mais de 6: as 5 maiores + "Outras" com a soma do resto', () => {
  const r = agruparParaRosca([1, 2, 3, 4, 5, 6, 7, 8].map((v) => f(`c${v}`, v * 100)));
  assert.equal(r.length, 6);
  assert.deepEqual(r.slice(0, 5).map((x) => x.id), ['c8', 'c7', 'c6', 'c5', 'c4']);
  assert.deepEqual(r[5], { id: ID_OUTRAS, totalCents: 600, agrupadas: 3 });
});

test('categoria sem gasto não vira fatia', () => {
  assert.deepEqual(agruparParaRosca([f('a', 0), f('b', 10)]).map((x) => x.id), ['b']);
});

test('arcos cobrem a volta inteira, proporcionais, começando às 12h', () => {
  const a = arcos([1, 1, 2]);
  assert.equal(a[0].inicio, 0);
  assert.ok(Math.abs(a[0].fim - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(a[2].fim - Math.PI * 2) < 1e-9);
});

test('setor de 360° vira dois arcos (um arco SVG fechado não desenha)', () => {
  const p = pathDoSetor(50, 50, 30, 40, { inicio: 0, fim: Math.PI * 2 });
  assert.equal((p.match(/M /g) ?? []).length, 2);
  // Setor > 180° usa a flag de arco grande.
  assert.match(pathDoSetor(50, 50, 30, 40, { inicio: 0, fim: Math.PI * 1.5 }), /A 40 40 0 1 1/);
});

test('percentuais inteiros somam exatamente 100', () => {
  assert.deepEqual(percentuaisInteiros([1, 1, 1]), [34, 33, 33]);
  for (const vs of [[333, 333, 334], [1, 2, 3, 4, 5, 6], [7, 7, 7, 7, 7, 7, 7]]) {
    assert.equal(percentuaisInteiros(vs).reduce((s, v) => s + v, 0), 100);
  }
  assert.deepEqual(percentuaisInteiros([0, 0]), [0, 0]);
});
