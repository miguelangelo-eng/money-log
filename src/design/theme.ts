/** Tema derivado dos tokens, para consumo com StyleSheet.
 *
 *  Por que não NativeWind (decisão de 2026-10-10, revendo o replica-design):
 *  o estável mais recente é 4.2.7 e a v5 só existe em rc; ele declara peer
 *  apenas de `tailwindcss`, sem garantia alguma quanto a React Native 0.86 e
 *  React 19.2; e este projeto roda com `reactCompiler: true`, que é
 *  precisamente onde um transform de Babel de terceiro quebra de um jeito
 *  difícil de diagnosticar. O caminho suportado no SDK 57 — e o que o próprio
 *  template do Expo usa — é StyleSheet com tema tipado.
 *
 *  O custo foi zero: os tokens já eram valores crus. O que mudou é que o
 *  componente escreve `theme.surface` em vez de `className="bg-surface"`.
 */

import { useColorScheme } from 'react-native';
import { color, type Mode } from './tokens';

/** Os tokens são `as const`, então `typeof color.light` produz tipos LITERAIS
 *  ('#f9f9f7', não string) e o tema escuro deixa de ser atribuível ao claro.
 *  Mapear para `string` mantém as chaves (que é o que importa: elas impedem
 *  hex cru na tela) e solta os valores. */
export type Theme = { readonly [K in keyof typeof color.light]: string };

/** Chaves do tema, para componentes aceitarem um papel em vez de uma cor.
 *  É isto que impede hex cru de aparecer numa tela. */
export type ThemeColor = keyof Theme;

export function themeFor(mode: Mode): Theme {
  return color[mode];
}

/** O modo segue o sistema (`userInterfaceStyle: "automatic"` no app.json).
 *  `useColorScheme` pode devolver null antes de o sistema responder — nesse
 *  caso cai no claro, que é o default seguro para um app de finanças usado
 *  na rua, sob sol. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return themeFor(scheme === 'dark' ? 'dark' : 'light');
}

export function useMode(): Mode {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export { categorical, CATEGORIAS_MAX, motion, polar, radius, space, TARGET_MIN, type } from './tokens';
