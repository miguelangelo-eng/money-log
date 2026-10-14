/** Testes da camada de dados do cartão contra SQLite REAL.
 *
 *  O app usa o driver do expo-sqlite, que não carrega no Node. Aqui as mesmas
 *  funções rodam sobre o node:sqlite do Node 24 — o mesmo motor do aparelho —
 *  com a migração gerada pelo drizzle-kit aplicada de verdade. Assim índice
 *  único, chave estrangeira e atomicidade de transação são exercitados, e não
 *  imaginados.
 *
 *  O banco de teste e o adaptador estão em src/test-support/sqlite.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { bancoDeTeste, TS } from '@/test-support/sqlite';

import { createCardsRepo } from './cards';

const U1 = 'usuario-1';
const U2 = 'usuario-2';

/** Banco novo por teste, com a migração real e uma conta para cada usuário. */
function ambiente() {
  const { raw, db, contar, conta } = bancoDeTeste();
  const repo = createCardsRepo({ db, newId: randomUUID, nowIso: () => TS, userId: U1 });
  conta('conta-u1', U1);
  conta('conta-u2', U2);
  return { raw, db, repo, contar };
}

/** Cartão "comum": fecha dia 28, vence dia 10, limite R$ 5.000. */
async function cartaoComum(repo: ReturnType<typeof ambiente>['repo'], userId = U1) {
  return repo.addCard(
    {
      nome: 'Cartão',
      limiteCents: 500000,
      diaFechamento: 28,
      diaVencimento: 10,
      contaPagamentoId: userId === U1 ? 'conta-u1' : 'conta-u2',
    },
    userId,
  );
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

test('cadastra cartão e lista só do dono', async () => {
  const { repo } = ambiente();
  await cartaoComum(repo);
  assert.equal((await repo.listCards(U1)).length, 1);
  assert.equal((await repo.listCards(U2)).length, 0);
});

test('cadastro inválido é rejeitado com mensagem para a tela', async () => {
  const { repo } = ambiente();
  const base = {
    nome: 'X',
    limiteCents: 1000,
    diaFechamento: 28,
    diaVencimento: 10,
    contaPagamentoId: null,
  };
  await assert.rejects(repo.addCard({ ...base, nome: '   ' }), /nome/);
  await assert.rejects(repo.addCard({ ...base, diaFechamento: 32 }), /fechamento/);
  await assert.rejects(repo.addCard({ ...base, diaVencimento: 0 }), /vencimento/);
  await assert.rejects(repo.addCard({ ...base, limiteCents: -1 }), /negativo/);
});

test('cartão não pode apontar para conta de pagamento de outro usuário', async () => {
  const { repo } = ambiente();
  await assert.rejects(
    repo.addCard(
      { nome: 'X', limiteCents: 0, diaFechamento: 28, diaVencimento: 10, contaPagamentoId: 'conta-u2' },
      U1,
    ),
    /Conta de pagamento/,
  );
});

// ---------------------------------------------------------------------------
// Compra
// ---------------------------------------------------------------------------

test('compra à vista: uma linha, ligada à fatura certa, sem tocar conta', async () => {
  const { repo, raw } = ambiente();
  const card = await cartaoComum(repo);
  const [id] = await repo.addCardPurchase({
    cardId: card,
    amountCents: 4290,
    competencia: '2026-10-10',
    parcelas: 1,
  });

  const tx = raw.prepare('select * from transactions where id = ?').get(id) as Record<string, unknown>;
  assert.equal(tx.kind, 'despesa');
  assert.equal(tx.account_id, null);
  assert.equal(tx.credit_card_id, card);
  assert.equal(tx.series_id, null);
  assert.equal(tx.parcela_n, null);

  const fatura = raw.prepare('select * from invoices where id = ?').get(tx.invoice_id as string) as Record<
    string,
    unknown
  >;
  assert.equal(fatura.mes_referencia, '2026-10-01');
  assert.equal(fatura.data_fechamento, '2026-10-28');
  assert.equal(fatura.data_vencimento, '2026-11-10');
});

test('parcelada em 3x: 3 linhas, mesma série, faturas consecutivas, soma exata', async () => {
  const { repo, raw } = ambiente();
  const card = await cartaoComum(repo);
  const ids = await repo.addCardPurchase({
    cardId: card,
    amountCents: 10000,
    competencia: '2026-10-29', // depois do fechamento: começa em novembro
    parcelas: 3,
  });
  assert.equal(ids.length, 3);

  const linhas = raw
    .prepare(
      `select t.amount_cents, t.series_id, t.parcela_n, t.parcela_de, t.competencia, i.mes_referencia
       from transactions t join invoices i on i.id = t.invoice_id
       where t.credit_card_id = ? order by t.parcela_n`,
    )
    .all(card) as Array<Record<string, unknown>>;

  assert.deepEqual(linhas.map((l) => l.amount_cents), [3334, 3333, 3333]);
  assert.deepEqual(linhas.map((l) => l.parcela_n), [1, 2, 3]);
  assert.ok(linhas.every((l) => l.parcela_de === 3));
  assert.equal(new Set(linhas.map((l) => l.series_id)).size, 1);
  assert.notEqual(linhas[0].series_id, null);
  assert.deepEqual(
    linhas.map((l) => l.mes_referencia),
    ['2026-11-01', '2026-12-01', '2027-01-01'],
  );
  assert.deepEqual(
    linhas.map((l) => l.competencia),
    ['2026-10-29', '2026-11-29', '2026-12-29'],
  );
});

test('duas compras no mesmo ciclo reutilizam a fatura, não duplicam', async () => {
  const { repo, contar } = ambiente();
  const card = await cartaoComum(repo);
  await repo.addCardPurchase({ cardId: card, amountCents: 1000, competencia: '2026-10-05', parcelas: 1 });
  await repo.addCardPurchase({ cardId: card, amountCents: 2000, competencia: '2026-10-20', parcelas: 1 });
  assert.equal(contar('select count(*) as n from invoices where credit_card_id = ?', card), 1);
});

test('fatura excluída (pelo sync) é reaproveitada no mesmo mês, zerada', async () => {
  // Cenário real: "começar do zero" marcou lançamentos e faturas como
  // excluídos no servidor, e o pull trouxe isso ao aparelho. A compra seguinte
  // do mesmo mês esbarrava na fatura excluída (UNIQUE cartão+mês) e falhava.
  const { raw, repo, contar } = ambiente();
  const card = await cartaoComum(repo);
  await repo.addCardPurchase({ cardId: card, amountCents: 1000, competencia: '2026-10-05', parcelas: 1 });
  const [antiga] = await repo.invoices(card, '2026-11-01');
  await repo.payInvoice({ invoiceId: antiga.id!, accountId: 'conta-u1', data: '2026-11-01' });
  raw.exec(`update transactions set deleted_at = '${TS}'; update invoices set deleted_at = '${TS}'`);

  await repo.addCardPurchase({ cardId: card, amountCents: 2500, competencia: '2026-10-06', parcelas: 1 });
  const faturas = await repo.invoices(card, '2026-10-10');
  assert.equal(faturas.length, 1);
  assert.equal(faturas[0].id, antiga.id, 'mesma linha, revivida');
  assert.equal(faturas[0].totalCents, 2500, 'só a compra nova');
  assert.equal(faturas[0].status, 'aberta', 'não herda o "paga" de antes');
  assert.equal(contar('select count(*) as n from invoices where credit_card_id = ?', card), 1);
  assert.equal(contar('select count(*) as n from invoices where pagamento_tx_id is not null'), 0);
});

test('compra em cartão de outro usuário é recusada', async () => {
  const { repo } = ambiente();
  const card = await cartaoComum(repo, U1);
  await assert.rejects(
    repo.addCardPurchase({ cardId: card, amountCents: 1000, competencia: '2026-10-05', parcelas: 1 }, U2),
    /Cartão não encontrado/,
  );
});

test('atomicidade: se uma parcela falha, nenhuma entra (nem a fatura criada no caminho)', async () => {
  const { repo, contar } = ambiente();
  const card = await cartaoComum(repo);

  // Fatura de outubro com compra, fechada e paga.
  await repo.addCardPurchase({ cardId: card, amountCents: 5000, competencia: '2026-10-10', parcelas: 1 });
  const [out] = await repo.invoices(card, '2026-10-29');
  await repo.payInvoice({ invoiceId: out.id!, accountId: 'conta-u1', data: '2026-10-29' });

  const txAntes = contar('select count(*) as n from transactions');
  const fatAntes = contar('select count(*) as n from invoices');

  // Retroativa de setembro em 2x: a 1ª parcela criaria a fatura de setembro,
  // a 2ª cairia em outubro, que já está paga -> tudo tem que voltar.
  await assert.rejects(
    repo.addCardPurchase({ cardId: card, amountCents: 2000, competencia: '2026-09-10', parcelas: 2 }),
    /já foi paga/,
  );

  assert.equal(contar('select count(*) as n from transactions'), txAntes);
  assert.equal(contar('select count(*) as n from invoices'), fatAntes);
});

// ---------------------------------------------------------------------------
// Faturas
// ---------------------------------------------------------------------------

test('total e status da fatura mudam com a data', async () => {
  const { repo } = ambiente();
  const card = await cartaoComum(repo);
  await repo.addCardPurchase({ cardId: card, amountCents: 10000, competencia: '2026-10-05', parcelas: 1 });
  await repo.addCardPurchase({ cardId: card, amountCents: 4290, competencia: '2026-10-20', parcelas: 1 });

  const [antes] = await repo.invoices(card, '2026-10-28');
  assert.equal(antes.totalCents, 14290);
  assert.equal(antes.status, 'aberta'); // no dia do fechamento ainda está aberta

  const [depois] = await repo.invoices(card, '2026-10-29');
  assert.equal(depois.status, 'fechada');
});

// ---------------------------------------------------------------------------
// Pagamento
// ---------------------------------------------------------------------------

test('não paga fatura aberta', async () => {
  const { repo } = ambiente();
  const card = await cartaoComum(repo);
  await repo.addCardPurchase({ cardId: card, amountCents: 10000, competencia: '2026-10-05', parcelas: 1 });
  const [f] = await repo.invoices(card, '2026-10-20');
  await assert.rejects(
    repo.payInvoice({ invoiceId: f.id!, accountId: 'conta-u1', data: '2026-10-20' }),
    /fecha em 28\/10/,
  );
});

test('paga fatura fechada: debita a conta, marca paga, uma vez só', async () => {
  const { repo, raw, contar } = ambiente();
  const card = await cartaoComum(repo);
  await repo.addCardPurchase({ cardId: card, amountCents: 10000, competencia: '2026-10-05', parcelas: 1 });
  await repo.addCardPurchase({ cardId: card, amountCents: 4290, competencia: '2026-10-20', parcelas: 1 });
  const [f] = await repo.invoices(card, '2026-10-29');

  const pagId = await repo.payInvoice({ invoiceId: f.id!, accountId: 'conta-u1', data: '2026-11-05' });

  const pag = raw.prepare('select * from transactions where id = ?').get(pagId) as Record<string, unknown>;
  assert.equal(pag.kind, 'pagamento_fatura');
  assert.equal(pag.amount_cents, 14290);
  assert.equal(pag.account_id, 'conta-u1');
  assert.equal(pag.invoice_id, f.id);
  assert.equal(pag.competencia, '2026-11-05');

  const fat = raw.prepare('select status, pagamento_tx_id from invoices where id = ?').get(f.id!) as Record<
    string,
    unknown
  >;
  assert.equal(fat.status, 'paga');
  assert.equal(fat.pagamento_tx_id, pagId);

  // O pagamento não vira item da fatura, e o total segue sendo o das compras.
  const itens = await repo.invoiceItems(f.id!);
  assert.equal(itens.length, 2);
  const [depois] = await repo.invoices(card, '2026-11-05');
  assert.equal(depois.status, 'paga');
  assert.equal(depois.totalCents, 14290);

  // Pagar de novo é recusado e não cria segundo pagamento.
  await assert.rejects(
    repo.payInvoice({ invoiceId: f.id!, accountId: 'conta-u1', data: '2026-11-06' }),
    /já foi paga/,
  );
  assert.equal(contar("select count(*) as n from transactions where kind = 'pagamento_fatura'"), 1);
});

test('fatura fechada sem valor não gera pagamento', async () => {
  const { repo, raw, contar } = ambiente();
  const card = await cartaoComum(repo);
  raw
    .prepare(
      `insert into invoices (id,user_id,credit_card_id,mes_referencia,data_fechamento,data_vencimento,status,created_at,updated_at)
       values (?,?,?,?,?,?,?,?,?)`,
    )
    .run('fat-vazia', U1, card, '2026-10-01', '2026-10-28', '2026-11-10', 'aberta', TS, TS);

  await assert.rejects(
    repo.payInvoice({ invoiceId: 'fat-vazia', accountId: 'conta-u1', data: '2026-10-29' }),
    /Não há valor/,
  );
  assert.equal(contar("select count(*) as n from transactions where kind = 'pagamento_fatura'"), 0);
});

test('isolamento: outro usuário não lê nem paga a fatura', async () => {
  const { repo } = ambiente();
  const card = await cartaoComum(repo, U1);
  await repo.addCardPurchase({ cardId: card, amountCents: 10000, competencia: '2026-10-05', parcelas: 1 });
  const [f] = await repo.invoices(card, '2026-10-29');

  assert.deepEqual(await repo.invoices(card, '2026-10-29', U2), []);
  assert.deepEqual(await repo.invoiceItems(f.id!, U2), []);
  assert.equal(await repo.getCard(card, U2), null);

  // Nem com a própria conta, nem com a conta do dono.
  await assert.rejects(
    repo.payInvoice({ invoiceId: f.id!, accountId: 'conta-u2', data: '2026-10-29' }, U2),
    /Fatura não encontrada/,
  );
  await assert.rejects(
    repo.payInvoice({ invoiceId: f.id!, accountId: 'conta-u1', data: '2026-10-29' }, U2),
    /Fatura não encontrada/,
  );
});

test('dono não paga com conta de outro usuário', async () => {
  const { repo } = ambiente();
  const card = await cartaoComum(repo, U1);
  await repo.addCardPurchase({ cardId: card, amountCents: 10000, competencia: '2026-10-05', parcelas: 1 });
  const [f] = await repo.invoices(card, '2026-10-29');
  await assert.rejects(
    repo.payInvoice({ invoiceId: f.id!, accountId: 'conta-u2', data: '2026-10-29' }, U1),
    /Conta de pagamento/,
  );
});

// ---------------------------------------------------------------------------
// Resumo (S10)
// ---------------------------------------------------------------------------

test('resumo: limite usado conta parcelas futuras e libera ao pagar', async () => {
  const { repo } = ambiente();
  const card = await cartaoComum(repo); // limite 500000
  await repo.addCardPurchase({ cardId: card, amountCents: 30000, competencia: '2026-10-05', parcelas: 3 });

  // Em 20/10: as três parcelas comprometem o limite.
  let [r] = await repo.summaries('2026-10-20');
  assert.equal(r.usadoCents, 30000);
  assert.equal(r.disponivelCents, 470000);
  assert.equal(r.faturaAtual.mesReferencia, '2026-10-01');
  assert.equal(r.faturaAtual.totalCents, 10000);
  assert.equal(r.faturaAPagar, null); // nada fechado ainda

  // Em 29/10: outubro fechou e aparece para pagar; a atual passa a novembro.
  [r] = await repo.summaries('2026-10-29');
  assert.equal(r.faturaAPagar?.mesReferencia, '2026-10-01');
  assert.equal(r.faturaAtual.mesReferencia, '2026-11-01');

  await repo.payInvoice({ invoiceId: r.faturaAPagar!.id!, accountId: 'conta-u1', data: '2026-10-29' });

  [r] = await repo.summaries('2026-10-29');
  assert.equal(r.usadoCents, 20000);
  assert.equal(r.disponivelCents, 480000);
  assert.equal(r.faturaAPagar, null);
});

test('resumo de cartão sem compra: fatura atual zerada, sem erro', async () => {
  const { repo } = ambiente();
  await cartaoComum(repo);
  const [r] = await repo.summaries('2026-10-10');
  assert.equal(r.faturaAtual.id, null);
  assert.equal(r.faturaAtual.totalCents, 0);
  assert.equal(r.faturaAtual.mesReferencia, '2026-10-01');
  assert.equal(r.usadoCents, 0);
  assert.equal(r.disponivelCents, 500000);
});
