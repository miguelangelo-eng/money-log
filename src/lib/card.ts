/** Regras do cartão de crédito que não dependem de banco.
 *
 *  Junta o ciclo de fatura (invoice.ts) com a divisão em parcelas (money.ts)
 *  e define o que a tela e o banco precisam saber: em que fatura cai cada
 *  parcela, quanto vale cada uma, qual o total de uma fatura e quanto do
 *  limite está livre.
 */

import { addMonths, isAfter, type CivilDate } from './civil-date';
import { invoicesForInstallments, type CardCycle, type InvoiceRef } from './invoice';
import { splitInstallments, sum, type Cents } from './money';

export const PARCELAS_MAX = 24;

export interface Parcela {
  n: number;
  de: number;
  /** Data contábil da parcela. A primeira é a da compra; as seguintes
   *  avançam um mês cada, para que o relatório mostre a parcela no mês em
   *  que ela pesa, e não a compra inteira no mês em que foi feita. */
  competencia: CivilDate;
  amountCents: Cents;
  fatura: InvoiceRef;
}

/** O que uma compra no cartão vira no banco: uma linha por parcela.
 *
 *  A soma das parcelas é exatamente o total (o resto vai nas primeiras, ver
 *  splitInstallments), e cada parcela cai numa fatura distinta e consecutiva.
 */
export function planoDeCompra(
  compra: CivilDate,
  ciclo: CardCycle,
  totalCents: Cents,
  parcelas: number,
): Parcela[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new RangeError(`valor da compra deve ser positivo em centavos: ${totalCents}`);
  }
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > PARCELAS_MAX) {
    throw new RangeError(`parcelas deve estar entre 1 e ${PARCELAS_MAX}: ${parcelas}`);
  }

  const valores = splitInstallments(totalCents, parcelas);
  const faturas = invoicesForInstallments(compra, ciclo, parcelas);

  return valores.map((amountCents, i) => ({
    n: i + 1,
    de: parcelas,
    competencia: addMonths(compra, i),
    amountCents,
    fatura: faturas[i],
  }));
}

export type StatusFatura = 'aberta' | 'fechada' | 'paga';

/** Status derivado de datas e do pagamento, não persistido.
 *
 *  Derivar é o que mantém o app correto offline: a fatura fecha à meia-noite
 *  do dia de fechamento esteja o servidor acessível ou não. O job
 *  `fechar_faturas` da arquitetura vira desnecessário no aparelho. Só o
 *  `paga` é estado de verdade, porque depende de um ato do usuário.
 *
 *  No dia do fechamento a fatura ainda está aberta — mesma regra de
 *  invoice.ts, onde a compra desse dia ainda entra nela. */
export function statusDaFatura(
  dataFechamento: CivilDate,
  paga: boolean,
  hoje: CivilDate,
): StatusFatura {
  if (paga) return 'paga';
  return isAfter(hoje, dataFechamento) ? 'fechada' : 'aberta';
}

export interface ItemDeFatura {
  kind: 'despesa' | 'receita' | 'transferencia' | 'pagamento_fatura';
  amountCents: Cents;
}

/** Total devido numa fatura: compras somam, estornos (receita no cartão)
 *  abatem. O próprio pagamento NÃO entra — ele está ligado à fatura, mas é a
 *  quitação dela, não um item; contá-lo zeraria toda fatura paga. */
export function totalDaFatura(itens: ItemDeFatura[]): Cents {
  let total = 0;
  for (const i of itens) {
    if (i.kind === 'despesa') total += i.amountCents;
    if (i.kind === 'receita') total -= i.amountCents;
  }
  return total;
}

/** Limite livre: o limite menos tudo que está em faturas ainda não pagas,
 *  inclusive as parcelas futuras — é assim que o banco compromete o limite
 *  numa compra parcelada. Pode ficar negativo (estouro), e o sinal é
 *  preservado para a tela avisar. */
export function limiteDisponivel(limiteCents: Cents, totaisNaoPagos: Cents[]): Cents {
  return limiteCents - sum(totaisNaoPagos);
}
