/** O leitor de mensagens do bot. O código mora em supabase/functions/_shared
 *  (é o mesmo arquivo que a Edge Function usa); o teste fica aqui para rodar
 *  junto com os outros. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lerMensagem,
  reais,
  respostaDoLancamento,
  valorEmCentavos,
} from '../../supabase/functions/_shared/mensagem';

const HOJE = '2026-10-11';

test('valores à brasileira e com ponto decimal', () => {
  assert.equal(valorEmCentavos('42'), 4200);
  assert.equal(valorEmCentavos('42,90'), 4290);
  assert.equal(valorEmCentavos('42,9'), 4290);
  assert.equal(valorEmCentavos('42.90'), 4290);
  assert.equal(valorEmCentavos('1.234,56'), 123456);
  assert.equal(valorEmCentavos('1.234'), 123400, 'ponto com 3 casas é milhar');
  assert.equal(valorEmCentavos('R$42'), 4200);
  assert.equal(valorEmCentavos('abc'), null);
  assert.equal(valorEmCentavos('4,2,1'), null);
});

test('despesa simples: valor, palavras e descrição', () => {
  assert.deepEqual(lerMensagem('mercado 42,90', HOJE), {
    tipo: 'lancar',
    kind: 'despesa',
    valorCents: 4290,
    data: HOJE,
    palavras: ['mercado'],
    descricao: 'Mercado',
  });
});

test('o valor é o último número; R$ separado também vale', () => {
  const r = lerMensagem('2 pizzas R$ 50', HOJE);
  assert.equal(r.tipo, 'lancar');
  if (r.tipo !== 'lancar') return;
  assert.equal(r.valorCents, 5000);
  assert.equal(r.descricao, '2 pizzas');
});

test('receita por palavra-chave, que sai da descrição', () => {
  const r = lerMensagem('Recebi salário 5.000,00', HOJE);
  assert.equal(r.tipo, 'lancar');
  if (r.tipo !== 'lancar') return;
  assert.equal(r.kind, 'receita');
  assert.equal(r.valorCents, 500000);
  assert.deepEqual(r.palavras, ['salário']);
});

test('data: ontem, dd/mm, e dd/mm no futuro vira o ano passado', () => {
  const ontem = lerMensagem('uber 18 ontem', HOJE);
  assert.equal(ontem.tipo === 'lancar' && ontem.data, '2026-10-10');
  const d = lerMensagem('farmácia 35 05/10', HOJE);
  assert.equal(d.tipo === 'lancar' && d.data, '2026-10-05');
  const futuro = lerMensagem('presente 100 20/12', HOJE);
  assert.equal(futuro.tipo === 'lancar' && futuro.data, '2025-12-20');
  // 31/02 não é data: vira palavra, e o valor continua sendo o último número.
  const invalida = lerMensagem('x 31/02 10', HOJE);
  assert.equal(invalida.tipo === 'lancar' && invalida.data, HOJE);
});

test('comandos', () => {
  assert.deepEqual(lerMensagem('vincular 123456', HOJE), { tipo: 'vincular', codigo: '123456' });
  assert.deepEqual(lerMensagem('  Vincular   004211 ', HOJE), { tipo: 'vincular', codigo: '004211' });
  assert.deepEqual(lerMensagem('Desfazer', HOJE), { tipo: 'desfazer' });
  assert.deepEqual(lerMensagem('oi', HOJE), { tipo: 'ajuda' });
  assert.deepEqual(lerMensagem('vincular 12345', HOJE).tipo, 'nao_entendi');
});

test('sem valor, ou valor zero, não lança', () => {
  assert.deepEqual(lerMensagem('comprei pão', HOJE), { tipo: 'nao_entendi' });
  assert.deepEqual(lerMensagem('nada 0', HOJE), { tipo: 'nao_entendi' });
});

test('resposta em reais e com a data relativa', () => {
  assert.equal(reais(123456), 'R$ 1.234,56');
  assert.equal(reais(5), 'R$ 0,05');
  assert.match(
    respostaDoLancamento(
      { tipo: 'despesa', valor: 4290, data: HOJE, categoria: 'Mercado', conta: 'Carteira' },
      HOJE,
    ),
    /Despesa de R\$ 42,90 em Mercado, hoje, na conta Carteira/,
  );
});
