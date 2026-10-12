/** Ícone da categoria, na cor dela, num círculo discreto.
 *
 *  A cor gravada é o tom do slot no modo CLARO (é o valor de referência).
 *  No modo escuro o mesmo slot tem outro passo — o roxo claro #4a3aa7 sobre
 *  a superfície escura fica abaixo de 3:1, que é o piso de marca gráfica.
 *  `corNoModo` troca pelo passo certo; cor fora dos slots passa como veio.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { categorical, radius, useMode, useTheme } from '@/design/theme';
import { glifoDoIcone } from '@/lib/categoria-icones';

type Glifo = ComponentProps<typeof Ionicons>['name'];

export function corNoModo(hex: string, modo: 'light' | 'dark'): string {
  const i = (categorical.light as readonly string[]).indexOf(hex.toLowerCase());
  return i >= 0 ? categorical[modo][i] : hex;
}

export function IconeCategoria({
  icone,
  cor,
  tamanho = 18,
}: {
  icone: string | null | undefined;
  cor: string | null | undefined;
  tamanho?: number;
}) {
  const t = useTheme();
  const modo = useMode();
  const lado = tamanho + 14;
  return (
    <View
      // Decorativo: o nome da categoria vem sempre ao lado, e é ele que o
      // leitor de tela lê.
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: lado,
        height: lado,
        borderRadius: radius.pill,
        backgroundColor: t.surfaceSunken,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Ionicons
        name={glifoDoIcone(icone) as Glifo}
        size={tamanho}
        color={cor ? corNoModo(cor, modo) : t.textMuted}
      />
    </View>
  );
}
