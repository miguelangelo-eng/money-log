/** Bot do WhatsApp: o SQL de supabase/whatsapp.sql contra Postgres real
 *  (PGlite), com o dono das tabelas SEM superusuário e o service_role com
 *  BYPASSRLS — como no Supabase. Ver src/test-support/postgres.ts. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createLedgerRepo } from '@/data/ledger-repo';
import { bancoDeTeste, TS } from '@/test-support/sqlite';
import {
  comoServico,
  comoUsuario,
  criarUsuario,
  servidorDeTeste,
  transportePg,
  type Pg,
} from '@/test-support/postgres';

import { createSync } from './engine';

const LOCAL = '00000000-0000-4000-8000-000000000001';
const TEL_ANA = '5511999990001';
const TEL_BIA = '5511999990002';

/** Um celular já preparado e sincronizado (perfil, categorias e Carteira na
 *  nuvem), como depois do primeiro login. */
async function aparelho(pg: Pg, uid: string) {
  const { db, contar } = bancoDeTeste();
  const repo = createLedgerRepo({ db, newId: randomUUID, nowIso: () => TS, userId: LOCAL, hoje: () => '2026-10-11' });
  const sync = createSync({ db, transporte: transportePg(pg, uid), localUserId: LOCAL, nowIso: () => TS });
  await sync.prepararAparelho(uid);
  await repo.ensureSeed();
  await sync.sincronizar(uid);
  const carteira = (await repo.listAccounts())[0].id;
  return { repo, sync, contar, carteira, sincronizar: () => sync.sincronizar(uid) };
}

async function cenario() {
  const pg = await servidorDeTeste();
  const ana = randomUUID();
  const bia = randomUUID();
  await criarUsuario(pg, ana);
  await criarUsuario(pg, bia);
  const celAna = await aparelho(pg, ana);
  const celBia = await aparelho(pg, bia);
  return { pg, ana, bia, celAna, celBia };
}

const codigo = (pg: Pg, uid: string, conta: string) =>
  comoUsuario(pg, uid, async (tx) =>
    (await tx.query<{ c: string }>('select whatsapp_gerar_codigo($1) as c', [conta])).rows[0].c,
  );

const vincular = (pg: Pg, tel: string, cod: string) =>
  comoServico(pg, async (tx) =>
    (await tx.query<{ r: string }>('select whatsapp_vincular($1, $2) as r', [tel, cod])).rows[0].r,
  );

type Lancado = { ok: boolean; erro?: string; tx_id?: string; categoria?: string | null; conta?: string };
const lancar = (pg: Pg, tel: string, palavras: string[], valor = 4290, kind = 'despesa', data: string | null = null) =>
  comoServico(pg, async (tx) =>
    JSON.parse(
      (
        await tx.query<{ r: string }>(
          'select whatsapp_lancar($1, $2, $3, $4::date, $5, $6)::text as r',
          [tel, kind, valor, data, palavras, palavras.join(' ')],
        )
      ).rows[0].r,
    ) as Lancado,
  );

const desfazer = (pg: Pg, tel: string) =>
  comoServico(pg, async (tx) =>
    JSON.parse((await tx.query<{ r: string }>('select whatsapp_desfazer($1)::text as r', [tel])).rows[0].r),
  );

test('código: 6 dígitos, só para conta própria, só logado', async () => {
  const { pg, ana, celAna, celBia } = await cenario();
  assert.match(await codigo(pg, ana, celAna.carteira), /^\d{6}$/);
  await assert.rejects(codigo(pg, ana, celBia.carteira), /conta não encontrada/);
  await assert.rejects(
    comoUsuario(pg, null, (tx) => tx.query('select whatsapp_gerar_codigo($1)', [celAna.carteira])),
    /permission denied/,
  );
});

test('vincular: código certo liga; é de uso único; código errado conta tentativa', async () => {
  const { pg, ana, celAna } = await cenario();
  const cod = await codigo(pg, ana, celAna.carteira);
  const errado = cod === '000000' ? '111111' : '000000';
  assert.equal(await vincular(pg, TEL_ANA, errado), 'codigo_invalido');
  assert.equal(await vincular(pg, TEL_ANA, cod), 'vinculado');
  assert.equal(await vincular(pg, '5511888887777', cod), 'codigo_invalido', 'uso único');
});

test('vincular: cinco erros em uma hora bloqueiam o número, mesmo com o código certo', async () => {
  const { pg, ana, celAna } = await cenario();
  const cod = await codigo(pg, ana, celAna.carteira);
  const errado = cod === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(await vincular(pg, TEL_ANA, errado), 'codigo_invalido');
  assert.equal(await vincular(pg, TEL_ANA, cod), 'bloqueado');
});

test('lançar pelo bot: casa a categoria sem acento e chega ao celular no pull', async () => {
  const { pg, ana, celAna } = await cenario();
  assert.equal(await vincular(pg, TEL_ANA, await codigo(pg, ana, celAna.carteira)), 'vinculado');

  const r = await lancar(pg, TEL_ANA, ['saude', 'farmacia'], 3500);
  assert.equal(r.ok, true);
  assert.equal(r.categoria, 'Saúde');
  assert.equal(r.conta, 'Carteira');

  const semCasar = await lancar(pg, TEL_ANA, ['uber'], 1800);
  assert.equal(semCasar.ok, true);
  assert.equal(semCasar.categoria, null, 'sem casamento entra sem categoria');

  await celAna.sincronizar();
  const tx = await celAna.repo.getTransaction(r.tx_id!);
  assert.equal(tx?.amountCents, 3500);
  assert.equal(tx?.kind, 'despesa');
  assert.ok(tx?.pago, 'data de hoje: pago');
  assert.equal(celAna.contar('select count(*) as n from outbox'), 0, 'o que veio do bot não volta no push');
});

test('receita casa só categoria de receita; data futura entra pendente', async () => {
  const { pg, ana, celAna } = await cenario();
  await vincular(pg, TEL_ANA, await codigo(pg, ana, celAna.carteira));
  const r = await lancar(pg, TEL_ANA, ['salário'], 500000, 'receita');
  assert.equal(r.categoria, 'Salário');
  const despesaComNomeDeReceita = await lancar(pg, TEL_ANA, ['salário'], 100, 'despesa');
  assert.equal(despesaComNomeDeReceita.categoria, null);

  const futuro = await lancar(pg, TEL_ANA, ['mercado'], 100, 'despesa', '2099-01-01');
  const pago = await comoUsuario(pg, ana, async (tx) =>
    (await tx.query<{ pago: boolean }>('select pago from transactions where id = $1', [futuro.tx_id])).rows[0].pago,
  );
  assert.equal(pago, false);
});

test('desfazer apaga só o último do bot, e a exclusão chega ao celular', async () => {
  const { pg, ana, celAna } = await cenario();
  await vincular(pg, TEL_ANA, await codigo(pg, ana, celAna.carteira));
  const r = await lancar(pg, TEL_ANA, ['mercado'], 4290);
  await celAna.sincronizar();
  assert.ok(await celAna.repo.getTransaction(r.tx_id!));

  assert.equal((await desfazer(pg, TEL_ANA)).ok, true);
  assert.deepEqual(await desfazer(pg, TEL_ANA), { ok: false, erro: 'nada_a_desfazer' });
  await celAna.sincronizar();
  assert.equal(await celAna.repo.getTransaction(r.tx_id!), null);
});

test('isolamento: cada número escreve só na sua conta; número de outra conta é recusado', async () => {
  const { pg, ana, bia, celAna, celBia } = await cenario();
  await vincular(pg, TEL_ANA, await codigo(pg, ana, celAna.carteira));
  await vincular(pg, TEL_BIA, await codigo(pg, bia, celBia.carteira));

  const daBia = await lancar(pg, TEL_BIA, ['mercado'], 999);
  const linha = (
    await pg.query<{ user_id: string; cat_dono: string }>(
      `select t.user_id, c.user_id as cat_dono
         from transactions t join categories c on c.id = t.category_id
        where t.id = $1`,
      [daBia.tx_id],
    )
  ).rows[0];
  assert.equal(linha.user_id, bia);
  assert.equal(linha.cat_dono, bia, 'a categoria casada é da Bia, não a "Mercado" da Ana');

  // A Bia tenta ligar o número da Ana à conta dela.
  assert.equal(await vincular(pg, TEL_ANA, await codigo(pg, bia, celBia.carteira)), 'numero_em_uso');

  assert.deepEqual(await lancar(pg, '5511000000000', ['mercado']), { ok: false, erro: 'nao_vinculado' });
});

test('o app não chama as funções do bot nem lê vínculo alheio', async () => {
  const { pg, ana, bia, celAna } = await cenario();
  await vincular(pg, TEL_ANA, await codigo(pg, ana, celAna.carteira));

  await assert.rejects(
    comoUsuario(pg, ana, (tx) =>
      tx.query('select whatsapp_lancar($1, $2, $3, null, $4, $5)', [TEL_ANA, 'despesa', 1, ['x'], 'x']),
    ),
    // Exatamente o EXECUTE negado — não uma permissão de tabela mais adiante.
    /permission denied for function whatsapp_lancar/,
  );
  const meu = await comoUsuario(pg, ana, async (tx) => (await tx.query('select telefone from whatsapp_vinculos')).rows);
  assert.deepEqual(meu, [{ telefone: TEL_ANA }]);
  const alheio = await comoUsuario(pg, bia, async (tx) => (await tx.query('select * from whatsapp_vinculos')).rows);
  assert.deepEqual(alheio, []);
  await assert.rejects(
    comoUsuario(pg, ana, (tx) => tx.query('select * from whatsapp_codigos')),
    /permission denied/,
  );
});

test('a mesma mensagem reenviada pela Meta é registrada uma vez só', async () => {
  const { pg } = await cenario();
  const reg = (id: string) =>
    comoServico(pg, async (tx) => (await tx.query<{ r: boolean }>('select whatsapp_registrar_mensagem($1) as r', [id])).rows[0].r);
  assert.equal(await reg('wamid.1'), true);
  assert.equal(await reg('wamid.1'), false);
  assert.equal(await reg('wamid.2'), true);
});
