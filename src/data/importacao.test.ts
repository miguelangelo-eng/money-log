/** Importação de extrato contra SQLite REAL, com a migração real.
 *  Extratos inventados, no formato do Nubank (ver src/lib/extrato). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { lerExtrato } from '@/lib/extrato/ler';
import { bancoDeTeste, TS } from '@/test-support/sqlite';

import { createCardsRepo } from './cards';
import { createImportacaoRepo, type Acao, type Previa } from './importacao';
import { createLedgerRepo } from './ledger-repo';

const U1 = 'usuario-1';
const U2 = 'usuario-2';
const HOJE = '2026-10-12';

async function ambiente() {
  const { raw, db, contar, conta } = bancoDeTeste();
  const deps = { db, newId: randomUUID, nowIso: () => TS, userId: U1 };
  const ledger = createLedgerRepo({ ...deps, hoje: () => HOJE });
  const cards = createCardsRepo(deps);
  const imp = createImportacaoRepo({ ...deps, ledger, cards });
  await ledger.ensureSeed(U1);
  await ledger.ensureSeed(U2);
  conta('nubank', U1);
  conta('nubank-u2', U2);
  const cat = async (nome: string, userId = U1) =>
    (await ledger.listCategories(undefined, userId)).find((c) => c.nome === nome)!.id;
  const saldo = async (id: string) => (await ledger.accountBalances()).find((c) => c.id === id)!.saldoCents;
  const contaPorNome = async (nome: string) => (await ledger.listAccounts()).find((c) => c.nome === nome);
  return { raw, db, contar, ledger, cards, imp, cat, saldo, contaPorNome };
}

const csvConta = (...linhas: string[]) => ['Data,Valor,Identificador,Descrição', ...linhas].join('\n');
const pix = (nome: string) => `Transferência enviada pelo Pix - ${nome} - 00.000.000/0001-00 - BANCO X (0001) Agência: 1 Conta: 1-1`;
const pixRecebido = (nome: string) => `Transferência recebida pelo Pix - ${nome} - •••.000.000-•• - BCO Y (0033) Agência: 1 Conta: 2-2`;

const SETEMBRO = csvConta(
  `01/09/2026,150.00,aaa,Valor adicionado na conta por cartão de crédito - Valor adicionado para Pix no Crédito`,
  `01/09/2026,-150.00,aaa,${pix('LOJA FICTICIA')}`,
  `03/09/2026,5000.00,bbb,${pixRecebido('FULANO DE TAL')}`,
  `05/09/2026,-2000.00,ccc,Aplicação RDB`,
  `05/09/2026,-300.00,ddd,Pagamento de fatura`,
  `12/09/2026,-180.00,eee,${pix('ENEL FICTICIA')}`,
  `17/09/2026,-12.34,fff,Compra no débito - DESPENSA DO BAIRRO`,
  `30/09/2026,2000.00,ggg,Resgate RDB`,
);

/** Cartão que fecha dia 25, com uma compra de R$ 300 em agosto: a fatura de
 *  agosto está fechada em 05/09, quando o extrato a paga. */
async function cartaoComFaturaDe300(cards: Awaited<ReturnType<typeof ambiente>>['cards']) {
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 25, diaVencimento: 5, contaPagamentoId: 'nubank' });
  await cards.addCardPurchase({ cardId, amountCents: 30000, competencia: '2026-08-10', parcelas: 1 });
  return cardId;
}

const tipos = (p: Previa) => p.linhas.map((l) => l.acao.tipo);
const trocar = (p: Previa, i: number, acao: Acao): Previa => ({
  ...p,
  linhas: p.linhas.map((l, j) => (j === i ? { ...l, acao } : l)),
});
const arq = (sha: string) => ({ nome: 'extrato.csv', sha256: sha });

// ---------------------------------------------------------------------------

test('extrato da conta: a prévia separa gasto de transferência, fatura e Pix no Crédito', async () => {
  const { imp, cards, cat } = await ambiente();
  await cartaoComFaturaDe300(cards);
  const p = await imp.prever(lerExtrato(SETEMBRO), { tipo: 'conta', contaId: 'nubank' });

  assert.deepEqual(tipos(p), [
    'ignorar', // Pix no Crédito, entrada
    'ignorar', // Pix no Crédito, saída
    'receita', // Pix recebido: sem histórico, ainda não sabe que é seu
    'transferencia', // Aplicação RDB
    'pagamento_fatura',
    'despesa',
    'despesa',
    'transferencia', // Resgate RDB
  ]);
  assert.deepEqual(p.linhas[3].acao, { tipo: 'transferencia', outra: { nova: 'Investimentos', tipo: 'investimento' } });
  assert.equal(p.linhas[5].acao.tipo === 'despesa' && p.linhas[5].acao.categoryId, await cat('Moradia'));
  assert.equal(p.linhas[6].acao.tipo === 'despesa' && p.linhas[6].acao.categoryId, await cat('Mercado'));
  assert.match(p.linhas[4].motivo!, /Roxinho de agosto/);
});

test('importar: transferências não viram gasto, a fatura fica paga e o saldo fecha', async () => {
  const { imp, cards, ledger, saldo, contaPorNome, contar } = await ambiente();
  const cardId = await cartaoComFaturaDe300(cards);
  let p = await imp.prever(lerExtrato(SETEMBRO), { tipo: 'conta', contaId: 'nubank' });
  // O Pix do próprio nome: a pessoa diz que veio da outra conta dela.
  p = trocar(p, 2, { tipo: 'transferencia', outra: { nova: 'Santander', tipo: 'corrente' } });

  const r = await imp.importar(p, arq('sha-set'));
  assert.deepEqual(r, { importadas: 6, conciliadas: 0, ignoradas: 2, jaImportadas: 0, saldo: null });

  // Só ENEL e a despensa são gasto. Aplicação, resgate, fatura e o Pix vindo
  // da outra conta não entram no total do mês.
  const t = await ledger.monthTotals('2026-09-01');
  assert.deepEqual(t, { receitaCents: 0, despesaCents: 18000 + 1234 });

  const inv = await contaPorNome('Investimentos');
  assert.equal(inv?.tipo, 'investimento');
  assert.equal(await saldo(inv!.id), 0, 'guardou 2.000 e resgatou 2.000');
  assert.equal(await saldo((await contaPorNome('Santander'))!.id), -500000);
  assert.equal(await saldo('nubank'), 500000 - 200000 - 30000 - 18000 - 1234 + 200000);

  const [fatura] = await cards.invoices(cardId, HOJE);
  assert.equal(fatura.status, 'paga');
  assert.equal(contar(`select count(*) n from import_batches where status = 'concluido' and importadas = 6`), 1);
  assert.equal(contar(`select count(*) n from accounts where nome = 'Investimentos'`), 1, 'criada uma vez só');
});

test('pagamento parcial: sai da conta e abate da fatura, que segue devendo o resto', async () => {
  const { imp, cards, saldo } = await ambiente();
  const cardId = await cartaoComFaturaDe300(cards);
  const p = await imp.prever(lerExtrato(csvConta('05/09/2026,-250.00,ddd,Pagamento de fatura')), {
    tipo: 'conta',
    contaId: 'nubank',
  });
  assert.deepEqual(p.linhas[0].acao, { tipo: 'pagamento_fatura', cartaoId: cardId });
  assert.match(p.linhas[0].motivo!, /Paga a fatura Roxinho de agosto de 2026/);
  await imp.importar(p, arq('parcial'));

  const [f] = await cards.invoices(cardId, HOJE);
  assert.deepEqual([f.status, f.totalCents, f.pagoCents, f.devidoCents], ['fechada', 30000, 25000, 5000]);
  assert.equal(await saldo('nubank'), -25000, 'o saldo da conta é o do banco');
  const [r] = await cards.summaries(HOJE);
  assert.equal(r.usadoCents, 5000, 'o limite volta com o que foi pago');
  assert.equal(r.faturaAPagar?.devidoCents, 5000);
});

test('pagamento antecipado e complemento, como no Nubank: a fatura fica paga e o limite volta', async () => {
  // Caso real (valores trocados): um pagamento ANTES do fechamento e outro
  // depois quitaram a fatura. Antes, os dois eram ignorados e o saldo da
  // conta ficava milhares de reais acima do banco.
  const { imp, cards, ledger, saldo } = await ambiente();
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 13, diaVencimento: 20, contaPagamentoId: 'nubank' });
  await cards.addCardPurchase({ cardId, amountCents: 100000, competencia: '2026-08-01', parcelas: 1 });

  const csv = csvConta('04/08/2026,-900.00,a1,Pagamento de fatura', '14/08/2026,-100.00,a2,Pagamento de fatura');
  const p = await imp.prever(lerExtrato(csv), { tipo: 'conta', contaId: 'nubank' });
  assert.match(p.linhas[0].motivo!, /Adianta a fatura Roxinho de agosto de 2026, ainda aberta/);
  assert.match(p.linhas[1].motivo!, /Paga a fatura Roxinho de agosto de 2026/);
  await imp.importar(p, arq('antecipado'));

  const [f] = await cards.invoices(cardId, '2026-08-20');
  assert.deepEqual([f.status, f.pagoCents, f.devidoCents], ['paga', 100000, 0]);
  assert.equal(await saldo('nubank'), -100000);
  const [r] = await cards.summaries('2026-08-20');
  assert.equal(r.usadoCents, 0);
  assert.equal(r.faturaAPagar, null);

  // Excluir UM dos pagamentos recalcula a fatura: volta a dever 100.
  const segundo = (await ledger.listByMonth('2026-08-01')).find((t) => t.kind === 'pagamento_fatura' && t.amountCents === 10000)!;
  await ledger.deleteTransaction(segundo.id);
  const [g] = await cards.invoices(cardId, '2026-08-20');
  assert.deepEqual([g.status, g.pagoCents, g.devidoCents], ['fechada', 90000, 10000]);
});
test('reimportar: mesmo arquivo não duplica; extrato sobreposto também não', async () => {
  const { imp, contar } = await ambiente();
  const destino = { tipo: 'conta', contaId: 'nubank' } as const;
  await imp.importar(await imp.prever(lerExtrato(SETEMBRO), destino), arq('sha-1'));
  const antes = contar('select count(*) n from transactions');

  // O mesmo arquivo de novo: nada entra (o ignorado segue ignorado).
  const mesmo = await imp.prever(lerExtrato(SETEMBRO), destino);
  assert.ok(mesmo.linhas.every((l) => l.acao.tipo === 'ignorar'));
  const r = await imp.importar(mesmo, arq('sha-1'));
  assert.equal(r.importadas, 0);
  assert.equal(contar('select count(*) n from transactions'), antes);

  // Outro arquivo com as mesmas transações (OFX do mesmo mês, por exemplo):
  // só o que foi ignorado reaparece (o Pix no Crédito e o pagamento, que não
  // tinha fatura no app), e de novo como "ignorar".
  const p = await imp.prever(lerExtrato(SETEMBRO + '\n01/10/2026,-9.99,novo,Compra no débito - PADARIA'), destino);
  assert.equal(p.jaImportadas, 5);
  assert.deepEqual(tipos(p), ['ignorar', 'ignorar', 'ignorar', 'despesa']);
  await imp.importar(p, arq('sha-2'));
  assert.equal(contar('select count(*) n from transactions'), antes + 1);
});

test('lançamento importado e excluído não volta na próxima importação', async () => {
  const { imp, ledger, contar } = await ambiente();
  const destino = { tipo: 'conta', contaId: 'nubank' } as const;
  const csv = csvConta(
    `17/09/2026,-12.34,fff,Compra no débito - DESPENSA DO BAIRRO`,
    `18/09/2026,-5.00,ggg,Compra no débito - PADARIA`,
  );
  await imp.importar(await imp.prever(lerExtrato(csv), destino), arq('a'));
  const despensa = (await ledger.listByMonth('2026-09-01')).find((t) => t.amountCents === 1234)!;
  await ledger.deleteTransaction(despensa.id);

  // O lote segue vivo (a padaria): a exclusão foi de propósito.
  const p = await imp.prever(lerExtrato(csv + '\n'), destino);
  assert.equal(p.linhas.length, 0);
  assert.equal(p.jaImportadas, 2);
  assert.equal((await imp.importar(await imp.prever(lerExtrato(csv), destino), arq('a'))).importadas, 0);
  assert.equal(contar('select count(*) n from transactions where deleted_at is null'), 1);
});

test('tudo excluído = importação desfeita: o mesmo arquivo entra de novo', async () => {
  // Caso real: "começar do zero" excluiu tudo no servidor; na reimportação
  // da mesma fatura as linhas sumiam como "já importadas".
  const { raw, imp, contar } = await ambiente();
  const destino = { tipo: 'conta', contaId: 'nubank' } as const;
  await imp.importar(await imp.prever(lerExtrato(SETEMBRO), destino), arq('set'));
  const n = contar('select count(*) n from transactions where deleted_at is null');
  raw.exec(`update transactions set deleted_at = '${TS}'`);

  const p = await imp.prever(lerExtrato(SETEMBRO), destino);
  assert.equal(p.jaImportadas, 0);
  const r = await imp.importar(p, arq('set'));
  assert.equal(r.importadas, n);
  assert.equal(contar('select count(*) n from transactions where deleted_at is null'), n);
  assert.equal(contar(`select count(*) n from import_batches where sha256 like 'set:%'`), 1, 'o repetido guarda o hash com o id do lote');
  assert.equal(contar('select count(*) n from import_batches'), 2);
});

test('aprende: Pix do próprio nome vira transferência; categoria trocada é lembrada', async () => {
  const { imp, cat, contaPorNome } = await ambiente();
  const destino = { tipo: 'conta', contaId: 'nubank' } as const;
  let p = await imp.prever(lerExtrato(SETEMBRO), destino);
  p = trocar(p, 2, { tipo: 'transferencia', outra: { nova: 'Santander', tipo: 'corrente' } });
  p = trocar(p, 6, { tipo: 'despesa', categoryId: await cat('Lazer') });
  await imp.importar(p, arq('set'));

  const outubro = csvConta(
    `03/10/2026,4000.00,o1,${pixRecebido('FULANO DE TAL')}`,
    `05/10/2026,-12.00,o2,Compra no débito - DESPENSA DO BAIRRO`,
  );
  const q = await imp.prever(lerExtrato(outubro), destino);
  const santander = (await contaPorNome('Santander'))!.id;
  assert.deepEqual(q.linhas[0].acao, { tipo: 'transferencia', outra: { id: santander } });
  assert.deepEqual(q.linhas[1].acao, { tipo: 'despesa', categoryId: await cat('Lazer') });
  assert.equal(q.linhas[1].motivo, 'Como da última vez.');
});

test('concilia com o que foi lançado à mão: não duplica, só marca', async () => {
  const { imp, ledger, contar } = await ambiente();
  const manual = await ledger.addExpense({ amountCents: 4290, competencia: '2026-09-20', descricao: 'mercado', accountId: 'nubank' });
  const csv = csvConta(`21/09/2026,-42.90,m1,Compra no débito - SUPERMERCADO X`, `21/09/2026,-42.90,m2,Compra no débito - SUPERMERCADO X`);
  const p = await imp.prever(lerExtrato(csv), { tipo: 'conta', contaId: 'nubank' });
  assert.deepEqual(p.linhas[0].acao, { tipo: 'conciliar', transacaoId: manual });
  assert.equal(p.linhas[1].acao.tipo, 'despesa', 'o manual casa com UMA linha só');

  const r = await imp.importar(p, arq('m'));
  assert.equal(r.conciliadas, 1);
  assert.equal(r.importadas, 1);
  assert.equal(contar('select count(*) n from transactions'), 2);
  assert.equal(contar(`select count(*) n from transactions where id = ? and id_externo = 'conta:260:m1'`, manual), 1);
});

test('fatura: compras na fatura do arquivo, IOF herda, estorno abate, pagamento ignorado', async () => {
  const { imp, cards, cat } = await ambiente();
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 25, diaVencimento: 5, contaPagamentoId: 'nubank' });
  const fatura = [
    'date,title,amount',
    '2026-09-11,EBW*Spotify - NuPay,"9,99"',
    '2026-09-10,Dl*Uberrides,"23,45"',
    '2026-09-10,Dl*Uberrides,"23,45"',
    '2026-09-05,Pagamento recebido,"- 1.234,56"',
    '2026-08-17,Netflix Exterior,"50,00"',
    '2026-08-17,"IOF de ""Netflix Exterior""","1,75"',
    '2026-08-15,Estorno Loja,"- 10,00"',
    '2026-08-13,Loja Ficticia - Parcela 7/10,"99,90"',
  ].join('\n');
  const p = await imp.prever(lerExtrato(fatura), { tipo: 'cartao', cartaoId: cardId });
  assert.deepEqual(tipos(p), ['despesa', 'despesa', 'despesa', 'ignorar', 'despesa', 'despesa', 'receita', 'despesa']);
  assert.deepEqual(p.linhas[5].acao, { tipo: 'despesa', categoryId: await cat('Assinaturas') });
  assert.equal(p.linhas[5].motivo, 'IOF: mesma categoria da compra.');

  const r = await imp.importar(p, arq('fat'));
  assert.equal(r.importadas, 7);
  // Um arquivo é UMA fatura do banco: tudo entra na fatura do app que
  // contém a compra mais recente (11/09), não fatura por data de compra.
  const faturas = await cards.invoices(cardId, HOJE);
  assert.deepEqual(
    faturas.map((f) => [f.mesReferencia, f.totalCents]),
    [['2026-09-01', 5000 + 175 - 1000 + 9990 + 999 + 2345 * 2]],
  );
  const itens = await cards.invoiceItems(faturas[0].id!);
  assert.ok(itens.some((t) => t.descricao === 'Loja Ficticia (7/10)'));
});

test('fatura: linha em fatura já paga no app é ignorada na prévia e recusada na gravação', async () => {
  const { imp, cards } = await ambiente();
  const cardId = await cartaoComFaturaDe300(cards);
  const [f] = await cards.invoices(cardId, HOJE);
  await cards.payInvoice({ invoiceId: f.id!, accountId: 'nubank', data: '2026-09-01' });

  const p = await imp.prever(lerExtrato('date,title,amount\n2026-08-20,Padaria,"7,50"'), { tipo: 'cartao', cartaoId: cardId });
  assert.equal(p.linhas[0].acao.tipo, 'ignorar');
  assert.match(p.linhas[0].motivo!, /já está paga/);
  await assert.rejects(
    imp.importar(trocar(p, 0, { tipo: 'despesa', categoryId: null }), arq('x')),
    /Linha de 20\/08 \(Padaria\): A fatura de agosto de 2026 já foi paga/,
  );
});

test('tudo ou nada: uma linha inválida desfaz o lote inteiro', async () => {
  const { imp, contar } = await ambiente();
  let p = await imp.prever(lerExtrato(SETEMBRO), { tipo: 'conta', contaId: 'nubank' });
  p = trocar(p, 7, { tipo: 'despesa', categoryId: null }); // resgate (entrada) como despesa
  await assert.rejects(imp.importar(p, arq('z')), /Linha de 30\/09 \(Resgate RDB\): Entrada na conta não pode ser despesa/);
  assert.equal(contar('select count(*) n from transactions'), 0);
  assert.equal(contar('select count(*) n from import_batches'), 0);
  assert.equal(contar('select count(*) n from accounts where nome = ?', 'Investimentos'), 0);
});

// Duas camadas: o histórico é filtrado por usuário, e a categoria ou conta
// que ele sugere ainda é conferida contra as da própria pessoa. Por isso
// tirar só o filtro não derruba este teste (mutação conferida).
test('isolamento: histórico e lançamentos de outra pessoa não influenciam', async () => {
  const { imp, ledger, cat } = await ambiente();
  await ledger.addExpense(
    { amountCents: 1234, competencia: '2026-09-17', descricao: 'DESPENSA DO BAIRRO', categoryId: await cat('Lazer', U2), accountId: 'nubank-u2' },
    U2,
  );
  const p = await imp.prever(lerExtrato(csvConta(`17/09/2026,-12.34,fff,Compra no débito - DESPENSA DO BAIRRO`)), {
    tipo: 'conta',
    contaId: 'nubank',
  });
  assert.deepEqual(p.linhas[0].acao, { tipo: 'despesa', categoryId: await cat('Mercado') });
  await assert.rejects(imp.prever(lerExtrato(SETEMBRO), { tipo: 'conta', contaId: 'nubank-u2' }), /Conta não encontrada/);
});

test('OFX: confere o saldo com o banco e ajusta o saldo inicial', async () => {
  const { imp, saldo } = await ambiente();
  const ofx = `<OFX><BANKID>0260<STMTTRN><DTPOSTED>20260910<TRNAMT>-10.00<FITID>o1<MEMO>Compra no débito - PADARIA</STMTTRN>
<LEDGERBAL><BALAMT>90.00<DTASOF>20260930</LEDGERBAL></OFX>`;
  const r = await imp.importar(await imp.prever(lerExtrato(ofx), { tipo: 'conta', contaId: 'nubank' }), arq('ofx'));
  assert.deepEqual(r.saldo, { data: '2026-09-30', bancoCents: 9000, appCents: -1000, diferencaCents: 10000 });

  await imp.ajustarSaldoInicial('nubank', r.saldo!.diferencaCents);
  assert.equal(await saldo('nubank'), 9000);
  assert.equal((await imp.conferirSaldo('nubank', '2026-09-30', 9000)).diferencaCents, 0);
  await assert.rejects(imp.ajustarSaldoInicial('nubank-u2', 1, U1), /Conta não encontrada/);
});

test('extrato no destino errado é recusado', async () => {
  const { imp } = await ambiente();
  await assert.rejects(imp.prever(lerExtrato(SETEMBRO), { tipo: 'cartao', cartaoId: 'x' }), /extrato de conta/);
  await assert.rejects(
    imp.prever(lerExtrato('date,title,amount\n2026-09-01,X,"1,00"'), { tipo: 'conta', contaId: 'nubank' }),
    /fatura de cartão/,
  );
});

// ---------------------------------------------------------------------------
// Fatura em OFX (o erro real: IOF com o mesmo FITID da compra)
// ---------------------------------------------------------------------------

const ofxFatura = (...trns: Array<[string, string, string, string]>) =>
  `<OFX><FI><ORG>NU PAGAMENTOS S.A.</ORG><FID>260</FID></FI><CCSTMTRS><BANKTRANLIST>${trns
    .map(
      ([data, valor, fitid, memo]) =>
        `<STMTTRN><DTPOSTED>${data}000000[-3:BRT]</DTPOSTED><TRNAMT>${valor}</TRNAMT><FITID>${fitid}</FITID><MEMO>${memo}</MEMO></STMTTRN>`,
    )
    .join('\n')}</BANKTRANLIST></CCSTMTRS></OFX>`;

const OFX_SET = ofxFatura(
  ['20260917', '-1.75', 'f-int', 'IOF de compra internacional'],
  ['20260917', '-50.00', 'f-int', 'Netflix.Com'],
  ['20260910', '-23.45', 'f-uber', 'Dl*Uberrides'],
  ['20260905', '1234.56', 'f-pag', 'Pagamento recebido'],
);

test('fatura OFX: o IOF (antes da compra, mesmo FITID) herda a categoria e o lote grava', async () => {
  const { imp, cards, cat, contar } = await ambiente();
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 25, diaVencimento: 5, contaPagamentoId: 'nubank' });
  const p = await imp.prever(lerExtrato(OFX_SET), { tipo: 'cartao', cartaoId: cardId });
  assert.deepEqual(tipos(p), ['despesa', 'despesa', 'despesa', 'ignorar']);
  assert.deepEqual(p.linhas[0].acao, { tipo: 'despesa', categoryId: await cat('Assinaturas') });

  const r = await imp.importar(p, arq('ofx-set'));
  assert.equal(r.importadas, 3);
  assert.equal(contar(`select count(*) n from transactions where id_externo = 'cartao:260:f-int:iof'`), 1);
});

test('mesma fatura em CSV e depois em OFX: concilia, não duplica', async () => {
  const { imp, cards, contar } = await ambiente();
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 25, diaVencimento: 5, contaPagamentoId: 'nubank' });
  const destino = { tipo: 'cartao', cartaoId: cardId } as const;
  const csv = [
    'date,title,amount',
    '2026-09-17,Netflix.Com,"50,00"',
    '2026-09-17,"IOF de ""Netflix.Com""","1,75"',
    '2026-09-10,Dl*Uberrides,"23,45"',
    '2026-09-05,Pagamento recebido,"- 1.234,56"',
  ].join('\n');
  await imp.importar(await imp.prever(lerExtrato(csv), destino), arq('csv-set'));
  assert.equal(contar('select count(*) n from transactions'), 3);

  const p = await imp.prever(lerExtrato(OFX_SET), destino);
  assert.deepEqual(tipos(p), ['conciliar', 'conciliar', 'conciliar', 'ignorar']);
  const r = await imp.importar(p, arq('ofx-set'));
  assert.equal(r.conciliadas, 3);
  assert.equal(r.importadas, 0);
  assert.equal(contar('select count(*) n from transactions'), 3);
});

test('importação parcial: o mesmo arquivo de novo completa só o que falta', async () => {
  // Caso real: a primeira tentativa só gravou o IOF; o resto estava preso.
  const { imp, contar } = await ambiente();
  const destino = { tipo: 'conta', contaId: 'nubank' } as const;
  let p = await imp.prever(lerExtrato(SETEMBRO), destino);
  p = { ...p, linhas: p.linhas.map((l, i) => (i === 5 ? l : { ...l, acao: { tipo: 'ignorar' } as const })) };
  assert.equal((await imp.importar(p, arq('mesmo'))).importadas, 1);

  const q = await imp.prever(lerExtrato(SETEMBRO), destino);
  assert.equal(q.jaImportadas, 1);
  const r = await imp.importar(q, arq('mesmo'));
  // 5 linhas valem (Pix no Crédito e o pagamento sem fatura seguem ignorados): 1 já estava, entram 4.
  assert.equal(r.importadas, 4);
  assert.equal(contar('select count(*) n from transactions'), 5);
});

// ---------------------------------------------------------------------------
// Parcelas: o Nubank repete o FITID da compra em todas elas
// ---------------------------------------------------------------------------

const PARCELA_SET = ofxFatura(['20260813', '-254.80', 'f-loja', 'Loja Ficticia - Parcela 7/10']);
const PARCELA_OUT = ofxFatura(
  ['20260913', '-254.80', 'f-loja', 'Loja Ficticia - Parcela 8/10'],
  ['20260920', '-9.90', 'f-pad', 'Padaria'],
);

test('parcelas com o mesmo FITID em faturas seguidas: cada uma entra no seu mês', async () => {
  // Caso real: a 8/10 da fatura de outubro sumia como "já importada" porque
  // a 7/10, de setembro, tinha o mesmo FITID.
  const { imp, cards, contar } = await ambiente();
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 25, diaVencimento: 5, contaPagamentoId: 'nubank' });
  const destino = { tipo: 'cartao', cartaoId: cardId } as const;
  await imp.importar(await imp.prever(lerExtrato(PARCELA_SET), destino), arq('set'));

  const p = await imp.prever(lerExtrato(PARCELA_OUT), destino);
  assert.equal(p.jaImportadas, 0);
  assert.equal((await imp.importar(p, arq('out'))).importadas, 2);
  assert.equal(contar(`select count(*) n from transactions where descricao like 'Loja Ficticia (%'`), 2);
  assert.equal(contar(`select count(*) n from transactions where id_externo = 'cartao:260:f-loja:p8'`), 1);
});

test('parcela gravada com o id antigo (sem o número) não duplica', async () => {
  const { raw, imp, cards, contar } = await ambiente();
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 25, diaVencimento: 5, contaPagamentoId: 'nubank' });
  const destino = { tipo: 'cartao', cartaoId: cardId } as const;
  await imp.importar(await imp.prever(lerExtrato(PARCELA_SET), destino), arq('set'));
  // Como ficou o que foi importado antes da correção: FITID puro.
  raw.exec(`update transactions set id_externo = 'cartao:260:f-loja' where id_externo = 'cartao:260:f-loja:p7'`);

  const mesmo = await imp.prever(lerExtrato(PARCELA_SET), destino);
  assert.equal(mesmo.jaImportadas, 1, 'a 7/10 antiga é reconhecida pela descrição');
  const r = await imp.importar(await imp.prever(lerExtrato(PARCELA_OUT), destino), arq('out'));
  assert.equal(r.importadas, 2, 'a 8/10 entra');
  assert.equal(contar(`select count(*) n from transactions where descricao like 'Loja Ficticia (%'`), 2);
});

test('fatura do banco: todas as linhas na mesma fatura do app, inclusive a parcela do dia do fechamento', async () => {
  // Caso real: o Nubank lança a parcela em 13/09 na fatura que fecha em
  // 13/10. Com fechamento no dia 13, a regra por data a punha na fatura de
  // setembro — já paga —, e a prévia a ignorava.
  const { imp, cards, contar } = await ambiente();
  const cardId = await cards.addCard({ nome: 'Roxinho', limiteCents: 500000, diaFechamento: 13, diaVencimento: 20, contaPagamentoId: 'nubank' });
  await cards.addCardPurchase({ cardId, amountCents: 1000, competencia: '2026-09-01', parcelas: 1 });
  const [setembro] = await cards.invoices(cardId, '2026-09-15');
  await cards.payInvoice({ invoiceId: setembro.id!, accountId: 'nubank', data: '2026-09-15' });

  const ofx = ofxFatura(
    ['20260913', '-254.80', 'f-loja', 'Loja Ficticia - Parcela 8/10'],
    ['20261011', '-9.99', 'f-sp', 'EBW*Spotify - NuPay'],
  );
  const p = await imp.prever(lerExtrato(ofx), { tipo: 'cartao', cartaoId: cardId });
  assert.deepEqual(tipos(p), ['despesa', 'despesa']);
  assert.equal((await imp.importar(p, arq('out'))).importadas, 2);

  const faturas = await cards.invoices(cardId, '2026-10-20');
  const outubro = faturas.find((f) => f.dataFechamento === '2026-10-13')!;
  assert.equal(outubro.totalCents, 25480 + 999, 'as duas na fatura que fecha em 13/10');
  assert.equal(faturas.find((f) => f.id === setembro.id)!.totalCents, 1000, 'a paga não mudou');
  assert.equal(contar(`select count(*) n from transactions where competencia = '2026-09-13'`), 1, 'a data da compra continua a do banco');
});

test('Pix do salário convertido em receita: a próxima importação já sugere a receita', async () => {
  const { imp, ledger, cat } = await ambiente();
  const destino = { tipo: 'conta', contaId: 'nubank' } as const;
  let p = await imp.prever(lerExtrato(SETEMBRO), destino);
  p = trocar(p, 2, { tipo: 'transferencia', outra: { nova: 'Santander', tipo: 'corrente' } });
  await imp.importar(p, arq('set'));
  const pix = (await ledger.listByMonth('2026-09-01')).find((t) => t.descricao === 'FULANO DE TAL')!;
  await ledger.converterTransferencia(pix.id, 'receita', await cat('Salário'), true);

  const q = await imp.prever(lerExtrato(csvConta(`03/10/2026,4000.00,o1,${pixRecebido('FULANO DE TAL')}`)), destino);
  assert.deepEqual(q.linhas[0].acao, { tipo: 'receita', categoryId: await cat('Salário') });
  assert.equal(q.linhas[0].motivo, 'Como da última vez.');
});
