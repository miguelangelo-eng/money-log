/** Regras puras do orçamento por categoria. Sem banco, sem React.
 *
 *  Estados (components.md, ProgressBar): ok abaixo de 80%, atenção de 80% a
 *  100%, estourado acima de 100%. Exatamente 100% é atenção, não estouro:
 *  gastar o limite inteiro é o combinado.
 */

import type { Cents } from './money';

export type EstadoDoLimite = 'ok' | 'atencao' | 'estourado';

export const LIMIAR_ATENCAO = 0.8;

export function estadoDoLimite(gastoCents: Cents, limiteCents: Cents): EstadoDoLimite {
  if (gastoCents > limiteCents) return 'estourado';
  if (gastoCents >= limiteCents * LIMIAR_ATENCAO) return 'atencao';
  return 'ok';
}

/** Fração gasta (pode passar de 1). Limite zero não existe — o banco exige
 *  limite > 0 —, mas a função não divide por zero mesmo assim. */
export function fracaoGasta(gastoCents: Cents, limiteCents: Cents): number {
  return limiteCents > 0 ? gastoCents / limiteCents : 0;
}

/** Percentual inteiro para exibição. Arredonda para BAIXO até 100: "100%"
 *  só aparece quando o limite foi de fato atingido, não a R$ 0,40 dele. */
export function percentual(gastoCents: Cents, limiteCents: Cents): number {
  const f = fracaoGasta(gastoCents, limiteCents) * 100;
  return f < 100 ? Math.floor(f) : Math.round(f);
}
