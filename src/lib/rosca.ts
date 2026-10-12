/** Geometria e agrupamento da rosca de gastos (CategoryDonut). Puro.
 *
 *  Regras do skill dataviz e de components.md:
 *    - no máximo 6 fatias: as 5 maiores + "Outras";
 *    - com menos de 3 fatias não há rosca (uma "pizza de 2 fatias" é
 *      anti-padrão: a lista com os números diz o mesmo, melhor).
 */

import { CATEGORIAS_MAX } from '@/design/tokens';

export interface FatiaDeEntrada {
  id: string;
  totalCents: number;
}

export const ID_OUTRAS = '__outras__';
export const FATIAS_MIN = 3;

/** As 5 maiores + "Outras" (soma do resto). A entrada já vem ordenada do
 *  maior para o menor (expensesByCategory), mas a função não confia nisso. */
export function agruparParaRosca<T extends FatiaDeEntrada>(
  fatias: T[],
  max = CATEGORIAS_MAX,
): Array<T | { id: typeof ID_OUTRAS; totalCents: number; agrupadas: number }> {
  const ordenadas = [...fatias].filter((f) => f.totalCents > 0).sort((a, b) => b.totalCents - a.totalCents);
  if (ordenadas.length <= max) return ordenadas;
  const topo = ordenadas.slice(0, max - 1);
  const resto = ordenadas.slice(max - 1);
  return [
    ...topo,
    { id: ID_OUTRAS, totalCents: resto.reduce((s, f) => s + f.totalCents, 0), agrupadas: resto.length },
  ];
}

export interface Arco {
  inicio: number; // radianos, 0 = 12h, sentido horário
  fim: number;
}

/** Ângulos de cada fatia, proporcionais ao valor, começando às 12h. */
export function arcos(valores: number[]): Arco[] {
  const total = valores.reduce((s, v) => s + v, 0);
  if (total <= 0) return valores.map(() => ({ inicio: 0, fim: 0 }));
  let a = 0;
  return valores.map((v) => {
    const inicio = a;
    a += (v / total) * Math.PI * 2;
    return { inicio, fim: a };
  });
}

const ponto = (cx: number, cy: number, r: number, ang: number) =>
  `${(cx + r * Math.sin(ang)).toFixed(2)} ${(cy - r * Math.cos(ang)).toFixed(2)}`;

/** Path SVG de um setor de anel entre os raios `r` (interno) e `R`
 *  (externo). Uma fatia de 360° vira dois arcos de 180°: um arco SVG com
 *  ponto inicial igual ao final não desenha nada. */
export function pathDoSetor(cx: number, cy: number, r: number, R: number, arco: Arco): string {
  const varredura = arco.fim - arco.inicio;
  if (varredura >= Math.PI * 2 - 1e-9) {
    const meio = arco.inicio + Math.PI;
    return (
      pathDoSetor(cx, cy, r, R, { inicio: arco.inicio, fim: meio }) +
      ' ' +
      pathDoSetor(cx, cy, r, R, { inicio: meio, fim: arco.fim })
    );
  }
  const grande = varredura > Math.PI ? 1 : 0;
  return [
    `M ${ponto(cx, cy, R, arco.inicio)}`,
    `A ${R} ${R} 0 ${grande} 1 ${ponto(cx, cy, R, arco.fim)}`,
    `L ${ponto(cx, cy, r, arco.fim)}`,
    `A ${r} ${r} 0 ${grande} 0 ${ponto(cx, cy, r, arco.inicio)}`,
    'Z',
  ].join(' ');
}

/** Percentuais inteiros que SOMAM 100 (maior resto). Arredondar cada um
 *  sozinho dá 99% ou 101% no total, e alguém sempre soma. */
export function percentuaisInteiros(valores: number[]): number[] {
  const total = valores.reduce((s, v) => s + v, 0);
  if (total <= 0) return valores.map(() => 0);
  const brutos = valores.map((v) => (v / total) * 100);
  const base = brutos.map(Math.floor);
  let falta = 100 - base.reduce((s, v) => s + v, 0);
  const ordem = brutos
    .map((b, i) => ({ i, resto: b - Math.floor(b) }))
    .sort((a, b) => b.resto - a.resto);
  for (const { i } of ordem) {
    if (falta <= 0) break;
    base[i] += 1;
    falta -= 1;
  }
  return base;
}
