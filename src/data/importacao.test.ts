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

test('pagamento de valor diferente da fatura do app não paga a fatura', async () => {
  const { imp, cards } = await ambiente();
  const cardId = await cartaoComFaturaDe300(cards);
  const p = await imp.prever(lerExtrato(csvConta('05/09/2026,-250.00,ddd,Pagamento de fatura')), {
    tipo: 'conta',
    contaId: 'nubank',
  });
  // Pagar os R$ 300 do app por um débito de R$ 250 no banco faria o saldo
  // da conta mentir. Fica para a pessoa resolver pela tela do cartão.
  assert.equal(p.linhas[0].acao.tipo, 'ignorar');
  assert.match(p.linhas[0].motivo!, /Nenhuma fatura fechada de R\$\s250,00/);
  assert.equal((await cards.invoices(cardId, HOJE))[0].status, 'fechada');
});

test('reimportar: mesmo arquivo é recusado; extrato sobreposto não duplica', async () => {
  const { imp, contar } = await ambiente();
  const destino = { tipo: 'conta', contaId: 'nubank' } as const;
  await imp.importar(await imp.prever(lerExtrato(SETEMBRO), destino), arq('sha-1'));
  const antes = contar('select count(*) n from transactions');

  await assert.rejects(imp.importar(await imp.prever(lerExtrato(SETEMBRO), destino), arq('sha-1')), /já foi importado/);

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
  const csv = csvConta(`17/09/2026,-12.34,fff,Compra no débito - DESPENSA DO BAIRRO`);
  await imp.importar(await imp.prever(lerExtrato(csv), destino), arq('a'));
  const id = (await ledger.listByMonth('2026-09-01'))[0].id;
  await ledger.deleteTransaction(id);

  const p = await imp.prever(lerExtrato(csv + '\n'), destino);
  assert.equal(p.linhas.length, 0);
  assert.equal(p.jaImportadas, 1);
  assert.equal(contar('select count(*) n from transactions where deleted_at is null'), 0);
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

test('fatura: compras nas faturas certas, IOF herda, estorno abate, pagamento ignorado', async () => {
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
  const faturas = await cards.invoices(cardId, HOJE);
  assert.deepEqual(
    faturas.map((f) => [f.mesReferencia, f.totalCents]),
    [
      ['2026-08-01', 5000 + 175 - 1000 + 9990],
      ['2026-09-01', 999 + 2345 * 2],
    ],
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
