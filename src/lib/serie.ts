/** Séries de lançamentos: parcelado e recorrente. Regras puras, sem banco.
 *
 *  Os dois tipos são materializados — uma linha por mês, com o mesmo
 *  `seriesId` (nota [P] do schema.sql) — e se distinguem pelos campos de
 *  parcela:
 *
 *    parcelado   seriesId + parcelaN/parcelaDe. Valor DIVIDIDO, N fixo.
 *    recorrente  seriesId, sem parcela. Valor CHEIO, todo mês, sem fim: o app
 *                mantém as ocorrências até HORIZONTE_MESES à frente e renova
 *                ao abrir. Para parar, exclui-se "esta e as próximas".
 *
 *  "Despesa fixa com fim conhecido" (10 mensalidades) é recorrente que se
 *  encerra excluindo as próximas, não um terceiro tipo.
 */

import { addMonths, type CivilDate } from './civil-date';

/** Quantos meses à frente de hoje a recorrência fica materializada. Um ano
 *  cobre "quanto vou gastar em março?" sem encher o sync de linhas. */
export const HORIZONTE_MESES = 12;

export type TipoSerie = 'parcelado' | 'recorrente';

export function tipoDaSerie(tx: {
  seriesId: string | null;
  parcelaN: number | null;
}): TipoSerie | null {
  if (!tx.seriesId) return null;
  return tx.parcelaN !== null ? 'parcelado' : 'recorrente';
}

/** Escopo de uma edição ou exclusão numa série. */
export type Escopo = 'esta' | 'proximas' | 'todas';

/** Data da k-ésima ocorrência (k = 0 é a primeira).
 *
 *  Sempre a partir da PRIMEIRA data, nunca da anterior: dia 31 vira 28/02 e
 *  volta a 31/03. Somando mês a mês, o 28 de fevereiro contaminaria o resto
 *  do ano. */
export function dataDaOcorrencia(inicio: CivilDate, k: number): CivilDate {
  return addMonths(inicio, k);
}

/** Índices k (a partir de `deK`) das ocorrências com data até `ate`. */
export function ocorrenciasAte(inicio: CivilDate, deK: number, ate: CivilDate): number[] {
  const ks: number[] = [];
  for (let k = deK; dataDaOcorrencia(inicio, k) <= ate; k++) ks.push(k);
  return ks;
}

/** Até onde a recorrência deve existir, dado o dia de hoje. */
export function horizonte(hoje: CivilDate): CivilDate {
  return addMonths(hoje, HORIZONTE_MESES);
}

/** Quantos meses inteiros separam `inicio` de `d` (as duas são ocorrências
 *  da mesma série, então o dia não importa). */
export function indiceDaOcorrencia(inicio: CivilDate, d: CivilDate): number {
  const [ai, mi] = inicio.split('-').map(Number);
  const [ad, md] = d.split('-').map(Number);
  return (ad - ai) * 12 + (md - mi);
}
