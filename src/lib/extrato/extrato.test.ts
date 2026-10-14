/** Leitura de extrato. Os arquivos aqui são INVENTADOS: mesmo formato e
 *  mesmas manhas dos exportados pelo Nubank (id repetido no CSV, ":reversal"
 *  no OFX, aspas dobradas, "- 1.234,56"), nenhum dado de gente de verdade. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lerCsv } from './csv';
import { lerExtrato } from './ler';
import { categoriaPorPalavra, idsPixNoCredito, regraFixa } from './regras';

const CONTA_CSV = [
  'Data,Valor,Identificador,Descrição',
  '01/09/2026,150.00,aaa-1,Valor adicionado na conta por cartão de crédito - Valor adicionado para Pix no Crédito',
  '01/09/2026,-150.00,aaa-1,Transferência enviada pelo Pix - LOJA FICTICIA S.A. - 00.000.000/0001-00 - BANCO X (0001) Agência: 1 Conta: 1-1',
  '03/09/2026,5000.00,bbb-2,Transferência recebida pelo Pix - FULANO DE TAL - •••.000.000-•• - BCO Y (0033) Agência: 1 Conta: 2-2',
  '05/09/2026,-2000.00,ccc-3,Aplicação RDB',
  '05/09/2026,-1234.56,ddd-4,Pagamento de fatura',
  '06/09/2026,-20.00,eee-5,Transferência enviada pelo Pix - BELTRANO   SILVA      - •••.111.111-•• - BCO Z (0237) Agência: 9 Conta: 3-3',
  '09/09/2026,-8.00,fff-6,Transferência enviada pelo Pix - 11.222.333 Sicrano Lima - 11.222.333/0001-44 - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 4-4',
  '14/09/2026,-45.50,ggg-7,Pagamento de boleto efetuado - DISTRIBUIDORA DE GAS FICTICIA',
  '17/09/2026,-12.34,hhh-8,Compra no débito - DESPENSA DO BAIRRO',
  '30/09/2026,2000.00,iii-9,Resgate RDB',
].join('\n');

const CONTA_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0260</BANKID><ACCTID>0000-0</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260901000000[-3:BRT]</DTPOSTED>
<TRNAMT>150.00</TRNAMT>
<FITID>aaa-1</FITID>
<MEMO>Valor adicionado na conta por cartão de crédito - Valor adicionado para Pix no Crédito</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260901000000[-3:BRT]</DTPOSTED>
<TRNAMT>-150.00</TRNAMT>
<FITID>aaa-1:reversal</FITID>
<MEMO>Transferência enviada pelo Pix - LOJA FICTICIA S.A. - 00.000.000/0001-00 - BANCO X (0001) Agência: 1 Conta: 1-1</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260917000000[-3:BRT]</DTPOSTED>
<TRNAMT>-12.34</TRNAMT>
<FITID>hhh-8</FITID>
<MEMO>Compra no débito - DESPENSA DO BAIRRO &amp; CIA</MEMO>
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>321.00</BALAMT>
<DTASOF>20260930000000[-3:BRT]</DTASOF>
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const FATURA_CSV = [
  'date,title,amount',
  '2026-09-11,EBW*Spotify - NuPay,"9,99"',
  '2026-09-10,Dl*Uberrides,"23,45"',
  '2026-09-10,Dl*Uberrides,"23,45"',
  '2026-09-09,Dentista Ficticio - Parcela 1/10,"100,00"',
  '2026-09-05,Pagamento recebido,"- 1.234,56"',
  '2026-09-01,Pg *99 Ride,"15,00"',
  '2026-08-21,Pix no Crédito - 11.222.333 FULANO DA SILVA,"40,00"',
  '2026-08-17,Assinatura Exterior,"50,00"',
  '2026-08-17,"IOF de ""Assinatura Exterior""","1,75"',
  '2026-08-15,Estorno Loja,"- 10,00"',
].join('\r\n');

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test('csv: aspas, aspas dobradas, vírgula no campo, CRLF e BOM', () => {
  assert.deepEqual(lerCsv(String.fromCharCode(0xfeff) + 'a,b\r\n"1,5","diz ""oi"""\r\n\r\n'), [
    ['a', 'b'],
    ['1,5', 'diz "oi"'],
  ]);
  assert.throws(() => lerCsv('a,"b\n'), /aspas/);
});

// ---------------------------------------------------------------------------
// Conta
// ---------------------------------------------------------------------------

test('conta CSV: formato, sinal, datas e descrição limpa', () => {
  const e = lerExtrato(CONTA_CSV);
  assert.equal(e.origem, 'conta');
  assert.equal(e.formato, 'csv');
  assert.equal(e.linhas.length, 10);

  const [, pix, recebido, , , pessoa, mei, boleto, debito] = e.linhas;
  assert.equal(pix.valorCents, -15000);
  assert.equal(pix.data, '2026-09-01');
  assert.equal(pix.descricao, 'LOJA FICTICIA S.A.');
  assert.equal(recebido.valorCents, 500000);
  assert.equal(recebido.descricao, 'FULANO DE TAL');
  assert.equal(pessoa.descricao, 'BELTRANO SILVA', 'espaços sobrando somem');
  assert.equal(mei.descricao, 'Sicrano Lima', 'CNPJ-raiz do MEI sai do nome');
  assert.equal(boleto.descricao, 'DISTRIBUIDORA DE GAS FICTICIA');
  assert.equal(debito.descricao, 'DESPENSA DO BAIRRO');
  assert.equal(e.linhas[4].descricao, 'Pagamento de fatura', 'sem padrão, fica o texto');
});

test('conta CSV: id repetido do Pix no Crédito vira ":reversal", como no OFX', () => {
  const csv = lerExtrato(CONTA_CSV).linhas;
  const ofx = lerExtrato(CONTA_OFX).linhas;
  assert.equal(csv[0].idExterno, 'conta:260:aaa-1');
  assert.equal(csv[1].idExterno, 'conta:260:aaa-1:reversal');
  assert.equal(new Set(csv.map((l) => l.idExterno)).size, csv.length, 'ids únicos no arquivo');
  // Mesmo extrato nos dois formatos = mesmos ids: trocar de formato não duplica.
  assert.deepEqual(
    ofx.map((l) => l.idExterno),
    [csv[0], csv[1], csv[8]].map((l) => l.idExterno),
  );
});

test('conta OFX: saldo final, entidades e descrição', () => {
  const e = lerExtrato(CONTA_OFX);
  assert.equal(e.formato, 'ofx');
  assert.equal(e.origem, 'conta');
  assert.equal(e.nome, 'Conta Nubank (OFX)');
  assert.deepEqual(e.saldoFinal, { cents: 32100, data: '2026-09-30' });
  assert.equal(e.linhas[2].descricao, 'DESPENSA DO BAIRRO & CIA');
  assert.equal(e.linhas[2].valorCents, -1234);
});

test('OFX sem tags de fechamento (SGML puro) também lê', () => {
  const sgml = `<OFX><BANKID>0341<STMTTRN><DTPOSTED>20261001<TRNAMT>-1,50<FITID>x1<NAME>PADARIA</BANKTRANLIST>`;
  const e = lerExtrato(sgml);
  assert.equal(e.linhas[0].idExterno, 'conta:341:x1');
  assert.equal(e.linhas[0].valorCents, -150);
  assert.equal(e.linhas[0].descricao, 'PADARIA');
  assert.equal(e.saldoFinal, null);
});

// ---------------------------------------------------------------------------
// Fatura
// ---------------------------------------------------------------------------

test('fatura CSV: positivo é gasto, "- 1.234,56" é crédito, prefixos saem', () => {
  const e = lerExtrato(FATURA_CSV);
  assert.equal(e.origem, 'cartao');
  const [spotify, uber, , dentista, pagamento, ride, pixCredito, , iof, estorno] = e.linhas;
  assert.equal(spotify.valorCents, -999);
  assert.equal(spotify.descricao, 'Spotify');
  assert.equal(uber.descricao, 'Uberrides');
  assert.equal(ride.descricao, '99 Ride');
  assert.equal(pagamento.valorCents, 123456);
  assert.equal(estorno.valorCents, 1000);
  assert.deepEqual(dentista.parcela, { n: 1, de: 10 });
  assert.equal(dentista.descricao, 'Dentista Ficticio');
  assert.equal(pixCredito.descricao, 'FULANO DA SILVA');
  assert.equal(iof.original, 'IOF de "Assinatura Exterior"');
});

test('fatura CSV: duas linhas idênticas são duas compras, com ids distintos e estáveis', () => {
  const a = lerExtrato(FATURA_CSV).linhas;
  const b = lerExtrato(FATURA_CSV).linhas;
  assert.notEqual(a[1].idExterno, a[2].idExterno);
  assert.deepEqual(
    a.map((l) => l.idExterno),
    b.map((l) => l.idExterno),
  );
});

test('formato desconhecido dá erro legível', () => {
  assert.throws(() => lerExtrato('nome,idade\nana,3'), /Formato não reconhecido/);
  assert.throws(() => lerExtrato('Data,Valor,Identificador,Descrição\n31/02/2026,1.00,x,y'), /dia não existe/);
});

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

test('regras da conta: Pix no Crédito em par, fatura, RDB; o resto fica livre', () => {
  const linhas = lerExtrato(CONTA_CSV).linhas;
  const pix = idsPixNoCredito(linhas);
  const r = linhas.map((l) => regraFixa(l, 'conta', pix)?.tipo ?? null);
  assert.deepEqual(r, [
    'ignorar', // entrada do Pix no Crédito
    'ignorar', // a saída do par
    null, // Pix recebido: depende do histórico (transferência sua ou receita)
    'investimento', // Aplicação RDB
    'pagamento_fatura',
    null,
    null,
    null,
    null,
    'investimento', // Resgate RDB
  ]);
});

test('regras da fatura: pagamento ignorado, IOF herda da compra', () => {
  const linhas = lerExtrato(FATURA_CSV).linhas;
  const r = linhas.map((l) => regraFixa(l, 'cartao', new Set()));
  assert.equal(r[4]?.tipo, 'ignorar');
  assert.deepEqual(r[8], { tipo: 'herdar', texto: 'Assinatura Exterior' });
  assert.equal(r[0], null);
});

test('palpite de categoria pela palavra', () => {
  const casos: Array<[string, string | null]> = [
    ['Uberrides', 'Transporte'],
    ['99 Ride', 'Transporte'],
    ['Rede de Postos Exemplo', 'Transporte'],
    ['DESPENSA DO BAIRRO', 'Mercado'],
    ['Supermercado Exemplo', 'Mercado'],
    ['Hipermarketexemplo', 'Mercado'],
    ['99food *Pizzaria Exemplo', 'Alimentação fora'],
    ['Barlanchoneteexemplo', 'Alimentação fora'],
    ['Acai do Centro', 'Alimentação fora'],
    ['Spotify', 'Assinaturas'],
    ['Netflix Entretenimento', 'Assinaturas'],
    ['ENEL DISTRIBUICAO', 'Moradia'],
    ['DISTRIBUIDORA DE GAS EXEMPLO', 'Moradia'],
    ['IMOBILIARIA EXEMPLO', 'Moradia'],
    ['Clinica Dental Exemplo', 'Saúde'],
    ['Maria Exemplo', null],
    ['Barbearia do Zé', null],
  ];
  for (const [desc, cat] of casos) assert.equal(categoriaPorPalavra(desc), cat, desc);
});

// ---------------------------------------------------------------------------
// Fatura em OFX
// ---------------------------------------------------------------------------

/** Como o Nubank exporta: o IOF vem ANTES da compra e com o MESMO FITID. */
const FATURA_OFX = `OFXHEADER:100
DATA:OFXSGML
ENCODING:USASCII
CHARSET:1252
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>NU PAGAMENTOS S.A.</ORG><FID>260</FID></FI></SONRS></SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>cartao-ficticio</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260917000000[-3:BRT]</DTPOSTED><TRNAMT>-1.75</TRNAMT><FITID>f-int</FITID><MEMO>IOF de compra internacional</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260917000000[-3:BRT]</DTPOSTED><TRNAMT>-50.00</TRNAMT><FITID>f-int</FITID><MEMO>Netflix.Com</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260910000000[-3:BRT]</DTPOSTED><TRNAMT>-23.45</TRNAMT><FITID>f-uber</FITID><MEMO>Dl*Uberrides</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260905000000[-3:BRT]</DTPOSTED><TRNAMT>1234.56</TRNAMT><FITID>f-pag</FITID><MEMO>Pagamento recebido</MEMO></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-75.20</BALAMT><DTASOF>20261013000000[-3:BRT]</DTASOF></LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

test('fatura OFX: IOF com o FITID da compra vira ":iof" e aponta para a compra', () => {
  const e = lerExtrato(FATURA_OFX);
  assert.equal(e.origem, 'cartao');
  assert.equal(e.nome, 'Cartão Nubank (OFX)');
  const [iof, compra, uber, pagamento] = e.linhas;
  assert.equal(iof.idExterno, 'cartao:260:f-int:iof');
  assert.equal(compra.idExterno, 'cartao:260:f-int', 'a compra fica com o id limpo');
  assert.equal(new Set(e.linhas.map((l) => l.idExterno)).size, e.linhas.length);
  assert.equal(compra.valorCents, -5000);
  assert.equal(uber.descricao, 'Uberrides');
  assert.equal(pagamento.valorCents, 123456);

  assert.deepEqual(regraFixa(iof, 'cartao', new Set()), { tipo: 'herdar', id: 'cartao:260:f-int' });
  assert.equal(regraFixa(pagamento, 'cartao', new Set())?.tipo, 'ignorar');
});

test('qualquer outro id repetido no arquivo ganha sufixo numerado', () => {
  const ofx = `<OFX><BANKID>0341
<STMTTRN><DTPOSTED>20261001<TRNAMT>-1.00<FITID>x<MEMO>A</STMTTRN>
<STMTTRN><DTPOSTED>20261001<TRNAMT>-2.00<FITID>x<MEMO>B</STMTTRN>
<STMTTRN><DTPOSTED>20261001<TRNAMT>-3.00<FITID>x<MEMO>C</STMTTRN></OFX>`;
  assert.deepEqual(
    lerExtrato(ofx).linhas.map((l) => l.idExterno),
    ['conta:341:x', 'conta:341:x:2', 'conta:341:x:3'],
  );
});
