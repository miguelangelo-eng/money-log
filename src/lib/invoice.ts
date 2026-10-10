/** Ciclo de fatura de cartão de crédito.
 *
 *  É a regra de negócio mais densa do app e a que o usuário percebe errada na
 *  hora (ver "hard parts" em replica/architecture.md). Fica isolada aqui, em
 *  funções puras sem banco e sem React, porque é o único jeito de testá-la a
 *  sério.
 *
 *  As duas decisões que governam tudo abaixo:
 *
 *  1. A fatura de uma compra é calculada UMA VEZ, na escrita, e gravada em
 *     transactions.invoice_id. Não é derivada na consulta. Se fosse derivada,
 *     mudar o dia de fechamento do cartão reorganizaria o histórico inteiro e
 *     faturas antigas já pagas mudariam de valor. Ver a nota [F] em
 *     replica/schema.sql.
 *  2. Compra NO dia do fechamento entra na fatura que fecha. Só depois dele
 *     vai para a seguinte. Fixado aqui para não virar divergência entre telas.
 */

import {
  type CivilDate,
  addMonths,
  clampDay,
  format,
  isSameOrBefore,
  monthStart,
  parse,
} from './civil-date';

export interface CardCycle {
  /** 1–31. Pode ser 29, 30 ou 31 — e aí fevereiro não tem. É grampeado. */
  diaFechamento: number;
  /** 1–31, mesmo cuidado. */
  diaVencimento: number;
}

export interface InvoiceRef {
  /** Primeiro dia do mês de referência. Casa com invoices.mes_referencia. */
  mesReferencia: CivilDate;
  dataFechamento: CivilDate;
  dataVencimento: CivilDate;
}

function validarCiclo({ diaFechamento, diaVencimento }: CardCycle): void {
  for (const [nome, v] of [
    ['dia de fechamento', diaFechamento],
    ['dia de vencimento', diaVencimento],
  ] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 31) {
      throw new RangeError(`${nome} inválido: ${v}`);
    }
  }
}

/** Data de fechamento da fatura de um mês, com o dia grampeado.
 *  Fechamento no dia 31 cai em 28/02 (ou 29/02 em ano bissexto). */
export function closingDate(
  year: number,
  month: number,
  ciclo: CardCycle,
): CivilDate {
  validarCiclo(ciclo);
  return clampDay(year, month, ciclo.diaFechamento);
}

/** Vencimento correspondente a um fechamento.
 *
 *  A heurística é a do mercado brasileiro: se o dia de vencimento é MAIOR que
 *  o de fechamento, vence no mesmo mês (fecha dia 5, vence dia 15). Se é menor
 *  ou igual, vence no mês seguinte (fecha dia 28, vence dia 10 do mês que vem)
 *  — o caso mais comum.
 */
export function dueDate(
  year: number,
  month: number,
  ciclo: CardCycle,
): CivilDate {
  validarCiclo(ciclo);
  const mesmoMes = ciclo.diaVencimento > ciclo.diaFechamento;
  const base = format({ year, month, day: 1 });
  const alvo = mesmoMes ? base : addMonths(base, 1);
  const { year: y, month: m } = parse(alvo);
  return clampDay(y, m, ciclo.diaVencimento);
}

/** A qual fatura pertence uma compra feita em `compra`.
 *
 *  Esta é a função que o INSERT de lançamento no cartão chama. O resultado
 *  é persistido; nunca recalculado para uma linha que já existe.
 *
 *  Casos que ela cobre, e que são os de borda que importam:
 *    - compra exatamente no dia do fechamento  -> fatura que fecha
 *    - compra um dia depois                    -> fatura seguinte
 *    - fechamento dia 31, compra em 28/02      -> fecha em 28/02, entra nela
 *    - compra em dezembro com fatura virando   -> referência passa para janeiro
 */
export function invoiceForPurchase(
  compra: CivilDate,
  ciclo: CardCycle,
): InvoiceRef {
  validarCiclo(ciclo);
  const { year, month } = parse(compra);
  const fechamentoDoMes = closingDate(year, month, ciclo);

  // No dia do fechamento ainda entra; depois dele, não.
  const referencia = isSameOrBefore(compra, fechamentoDoMes)
    ? format({ year, month, day: 1 })
    : addMonths(format({ year, month, day: 1 }), 1);

  const { year: ry, month: rm } = parse(referencia);
  return {
    mesReferencia: monthStart(referencia),
    dataFechamento: closingDate(ry, rm, ciclo),
    dataVencimento: dueDate(ry, rm, ciclo),
  };
}

/** Fatura de cada parcela de uma compra parcelada.
 *
 *  A primeira parcela segue a regra da compra; as seguintes caem nos meses de
 *  referência subsequentes. Devolve na mesma ordem das parcelas, para casar
 *  posição a posição com splitInstallments().
 */
export function invoicesForInstallments(
  compra: CivilDate,
  ciclo: CardCycle,
  parcelas: number,
): InvoiceRef[] {
  if (!Number.isInteger(parcelas) || parcelas < 1) {
    throw new RangeError(`número de parcelas inválido: ${parcelas}`);
  }
  const primeira = invoiceForPurchase(compra, ciclo);
  return Array.from({ length: parcelas }, (_, i) => {
    const ref = addMonths(primeira.mesReferencia, i);
    const { year, month } = parse(ref);
    return {
      mesReferencia: ref,
      dataFechamento: closingDate(year, month, ciclo),
      dataVencimento: dueDate(year, month, ciclo),
    };
  });
}

/** Uma fatura está fechada quando a data de referência de "hoje" já passou do
 *  fechamento dela. Usado pelo job `fechar_faturas` e pela UI da S12. */
export function isClosed(fatura: InvoiceRef, hoje: CivilDate): boolean {
  return !isSameOrBefore(hoje, fatura.dataFechamento);
}

/** Casos de borda que o teste de unidade do M2 precisa fixar.
 *  Deixados aqui como especificação executável do comportamento esperado —
 *  mover para invoice.test.ts quando houver runner de teste.
 *
 *  const ciclo = { diaFechamento: 28, diaVencimento: 10 };
 *
 *  invoiceForPurchase('2026-10-27', ciclo).mesReferencia === '2026-10-01'
 *  invoiceForPurchase('2026-10-28', ciclo).mesReferencia === '2026-10-01'  // no dia: entra
 *  invoiceForPurchase('2026-10-29', ciclo).mesReferencia === '2026-11-01'  // depois: sai
 *  invoiceForPurchase('2026-10-27', ciclo).dataVencimento === '2026-11-10' // vence no mês seguinte
 *
 *  const dia31 = { diaFechamento: 31, diaVencimento: 10 };
 *  closingDate(2026, 2, dia31) === '2026-02-28'   // fevereiro não tem 31
 *  closingDate(2028, 2, dia31) === '2028-02-29'   // bissexto
 *  closingDate(2026, 4, dia31) === '2026-04-30'   // abril tem 30
 *
 *  const cedo = { diaFechamento: 5, diaVencimento: 15 };
 *  dueDate(2026, 10, cedo) === '2026-10-15'       // vencimento > fechamento: mesmo mês
 *
 *  invoiceForPurchase('2026-12-29', ciclo).mesReferencia === '2027-01-01'  // vira o ano
 *
 *  invoicesForInstallments('2026-10-29', ciclo, 3).map(f => f.mesReferencia)
 *    === ['2026-11-01', '2026-12-01', '2027-01-01']
 */
