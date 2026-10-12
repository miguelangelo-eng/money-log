/** OFX 1.x (SGML) e 2.x (XML), o que os bancos brasileiros exportam.
 *
 *  O 1.x é SGML: a tag de valor pode não ter fechamento (`<TRNAMT>-1.50` e
 *  a linha acaba). Por isso a leitura é por tag, "do `<TAG>` até o próximo
 *  `<` ou fim de linha", e não com um parser de XML — que recusaria o arquivo.
 *
 *  Só o que o app usa: transações (FITID, data, valor, memo), a conta de
 *  origem e o saldo final (LEDGERBAL), que permite conferir se a conta no
 *  app fecha com o banco.
 */

import { parse, type CivilDate } from '../civil-date';
import { parseAmount, type Cents } from '../money';

export interface OfxTransacao {
  fitid: string | null;
  data: CivilDate;
  /** Com sinal, como o banco manda: negativo = saiu da conta / gasto no cartão. */
  valorCents: Cents;
  memo: string;
}

export interface Ofx {
  /** Código do banco sem zeros à esquerda ('260' = Nubank), se houver. */
  bancoId: string | null;
  /** Extrato de cartão (`CCSTMTRS`) ou de conta (`STMTRS`). */
  cartao: boolean;
  transacoes: OfxTransacao[];
  saldoFinal: { cents: Cents; data: CivilDate } | null;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTIDADES[e]);

function campo(bloco: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? decodificar(m[1].trim()) : null;
}

/** '20260905000000[-3:BRT]' -> '2026-09-05'. A data do banco já é a data
 *  civil do lançamento; o fuso não muda o dia. */
function dataOfx(s: string | null): CivilDate {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s ?? '');
  if (!m) throw new Error(`Data inválida no OFX: ${s ?? '(vazia)'}`);
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  parse(d);
  return d;
}

export function lerOfx(texto: string): Ofx {
  if (!/<OFX>/i.test(texto)) throw new Error('Não é um arquivo OFX.');

  const blocos = texto
    .split(/<STMTTRN>/i)
    .slice(1)
    .map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);

  const transacoes = blocos.map((b): OfxTransacao => {
    const valor = campo(b, 'TRNAMT');
    if (!valor) throw new Error('Transação sem valor no OFX.');
    return {
      fitid: campo(b, 'FITID') || null,
      data: dataOfx(campo(b, 'DTPOSTED')),
      valorCents: parseAmount(valor),
      // Alguns bancos põem o texto em NAME e deixam MEMO vazio.
      memo: (campo(b, 'MEMO') || campo(b, 'NAME') || '').replace(/\s+/g, ' ').trim(),
    };
  });

  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|$)/i.exec(texto)?.[1];
  const saldoValor = ledger ? campo(ledger, 'BALAMT') : null;
  const banco = campo(texto, 'BANKID') ?? campo(texto, 'FID');

  return {
    bancoId: banco && /^\d+$/.test(banco) ? String(Number(banco)) : banco,
    cartao: /<CCSTMTRS>/i.test(texto),
    transacoes,
    saldoFinal:
      ledger && saldoValor
        ? { cents: parseAmount(saldoValor), data: dataOfx(campo(ledger, 'DTASOF')) }
        : null,
  };
}
