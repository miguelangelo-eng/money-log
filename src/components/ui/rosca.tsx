/** CategoryDonut — rosca de gastos por categoria, COM DESTAQUE.
 *
 *  Uma fatia selecionada na cor da categoria; as demais em cinza neutro.
 *  Não é economia de cor, é correção: o validador do skill dataviz reprova os
 *  8 slots quando qualquer par pode ficar adjacente — e numa rosca ordenada
 *  por tamanho qualquer par pode. Moradia (laranja) × Outros gastos
 *  (vermelho) ficam em ΔE 7,1 até para visão normal; laranja × verde, 3,2
 *  para protanopia. E a cor é escolha da pessoa: duas categorias podem ter a
 *  MESMA. Com destaque, nenhuma leitura depende de distinguir duas cores.
 *
 *  A seleção tem codificação redundante: cor E forma (a fatia escolhida sai
 *  do anel). O nome, o percentual e o valor vão no centro, em texto.
 *  A lista ranqueada abaixo (em Relatórios) é a visão de tabela.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useMode, useTheme } from '@/design/theme';
import { formatCents } from '@/lib/money';
import { arcos, pathDoSetor, percentuaisInteiros } from '@/lib/rosca';

import { corNoModo } from './icone-categoria';
import { Txt } from './primitives';

export interface FatiaDaRosca {
  id: string;
  nome: string;
  /** null = "Outras": sem cor própria, usa o texto atenuado. */
  cor: string | null;
  totalCents: number;
}

const LADO = 220;
const R_EXT = 92;
const R_INT = 62;
/** Quanto a fatia selecionada sai do anel. */
const SALTO = 8;

export function Rosca({
  fatias,
  selecionadoId,
  onSelect,
}: {
  fatias: FatiaDaRosca[];
  selecionadoId: string;
  onSelect: (id: string) => void;
}) {
  const t = useTheme();
  const modo = useMode();
  const c = LADO / 2;
  const angulos = arcos(fatias.map((f) => f.totalCents));
  const pct = percentuaisInteiros(fatias.map((f) => f.totalCents));
  const i = Math.max(0, fatias.findIndex((f) => f.id === selecionadoId));
  const sel = fatias[i];

  const leitura =
    'Gastos por categoria: ' + fatias.map((f, k) => `${f.nome} ${pct[k]}%`).join(', ');

  // A selecionada é desenhada por último, por cima das vizinhas.
  const ordem = fatias.map((_, k) => k).filter((k) => k !== i).concat(i);

  return (
    <View style={styles.wrap} accessible accessibilityLabel={leitura}>
      <Svg width={LADO} height={LADO}>
        {ordem.map((k) => {
          const f = fatias[k];
          const ativa = k === i;
          const cor = ativa ? (f.cor ? corNoModo(f.cor, modo) : t.textMuted) : t.chartNeutral;
          return (
            <Path
              key={f.id}
              d={pathDoSetor(c, c, R_INT, ativa ? R_EXT + SALTO : R_EXT, angulos[k])}
              fill={cor}
              // Vão de 2px na cor da superfície entre fatias (1px de cada lado).
              stroke={t.surface}
              strokeWidth={2}
              onPress={() => onSelect(f.id)}
            />
          );
        })}
      </Svg>
      <View style={styles.centro} pointerEvents="none">
        <Txt variant="sm" numberOfLines={1} style={styles.nome}>
          {sel.nome}
        </Txt>
        <Txt variant="xl">{`${pct[i]}%`}</Txt>
        <Txt variant="xs" color="textMuted">
          {formatCents(sel.totalCents)}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: LADO, height: LADO, alignSelf: 'center' },
  centro: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Cabe dentro do furo (2 × R_INT) com folga.
  nome: { maxWidth: R_INT * 2 - 24, textAlign: 'center' },
});
