import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, toLocalDate, today } from './civil-date';

test('ida e volta Date <-> data civil preserva o dia', () => {
  for (const d of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-10-01', '2026-12-31']) {
    assert.equal(today(toLocalDate(d)), d);
  }
});

test('toLocalDate cai na meia-noite LOCAL, não UTC', () => {
  const d = toLocalDate('2026-10-01');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 0);
});

test('o dia do usuário vem dos getters locais, mesmo perto da meia-noite', () => {
  // 23h59 locais do dia 30 ainda é dia 30 para quem está lançando.
  const quaseMeiaNoite = new Date(2026, 8, 30, 23, 59);
  assert.equal(today(quaseMeiaNoite), '2026-09-30');
});

test('ontem atravessa virada de mês e de ano', () => {
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});
