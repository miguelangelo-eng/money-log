import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dataDaOcorrencia,
  horizonte,
  indiceDaOcorrencia,
  ocorrenciasAte,
  tipoDaSerie,
} from './serie';

test('ocorrência k sempre a partir da primeira data: 31 não vira 28 para sempre', () => {
  assert.equal(dataDaOcorrencia('2027-01-31', 1), '2027-02-28');
  assert.equal(dataDaOcorrencia('2027-01-31', 2), '2027-03-31');
  assert.equal(dataDaOcorrencia('2027-11-15', 2), '2028-01-15');
});

test('ocorrências até uma data, a partir de um índice', () => {
  assert.deepEqual(ocorrenciasAte('2026-10-10', 0, '2026-12-10'), [0, 1, 2]);
  assert.deepEqual(ocorrenciasAte('2026-10-10', 3, '2026-12-31'), []);
  assert.deepEqual(ocorrenciasAte('2026-10-10', 1, '2026-12-09'), [1]);
});

test('índice de uma ocorrência pelo mês, atravessando o ano', () => {
  assert.equal(indiceDaOcorrencia('2026-10-31', '2027-02-28'), 4);
  assert.equal(indiceDaOcorrencia('2026-10-10', '2026-10-25'), 0);
});

test('horizonte: 12 meses à frente', () => {
  assert.equal(horizonte('2026-10-10'), '2027-10-10');
});

test('tipo da série pelos campos de parcela', () => {
  assert.equal(tipoDaSerie({ seriesId: null, parcelaN: null }), null);
  assert.equal(tipoDaSerie({ seriesId: 's', parcelaN: 2 }), 'parcelado');
  assert.equal(tipoDaSerie({ seriesId: 's', parcelaN: null }), 'recorrente');
});
