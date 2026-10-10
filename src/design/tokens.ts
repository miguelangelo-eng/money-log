/** Valores crus dos tokens, para onde classe utilitária não alcança:
 *  Victory Native XL (recebe cor como prop, não como className), Skia,
 *  StyleSheet nativo e opções de navegação.
 *
 *  Fonte da verdade: tokens.json. Derivado — ver o cabeçalho do tokens.css.
 */

export type Mode = 'light' | 'dark';

export const color = {
  light: {
    bg: '#f9f9f7',
    surface: '#fcfcfb',
    surfaceSunken: '#f0efec',
    border: '#e1e0d9',
    borderInput: '#6f6e67',
    text: '#0b0b0b',
    textMuted: '#52514e',
    textAxis: '#5f5e58',
    accent: '#1c5cab',
    onAccent: '#ffffff',
    danger: '#b32626',
    success: '#006300',
    warningInk: '#6b4800',
    fillDanger: '#d03b3b',
    fillWarning: '#fab219',
    fillSuccess: '#0ca30c',
    chartSurface: '#fcfcfb',
    chartGridline: '#e1e0d9',
    scrim: 'rgba(11,11,11,0.45)',
  },
  dark: {
    bg: '#0d0d0d',
    surface: '#1a1a19',
    surfaceSunken: '#242422',
    border: '#2c2c2a',
    borderInput: '#8f8e86',
    text: '#ffffff',
    textMuted: '#c3c2b7',
    textAxis: '#a3a299',
    accent: '#6da7ec',
    onAccent: '#0b0b0b',
    danger: '#f08f8f',
    success: '#5cc95c',
    warningInk: '#fab219',
    fillDanger: '#d03b3b',
    fillWarning: '#fab219',
    fillSuccess: '#0ca30c',
    chartSurface: '#1a1a19',
    chartGridline: '#2c2c2a',
    scrim: 'rgba(0,0,0,0.6)',
  },
} as const;

/** Slots categóricos, ORDEM FIXA. A ordem é o mecanismo de segurança para
 *  daltonismo — nunca reordenar, nunca ciclar, nunca gerar um 9º.
 *  Mais de 8 categorias: as 7 maiores + "Outras". Ver CATEGORIAS_MAX. */
export const categorical = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100',
          '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark:  ['#3987e5', '#d95926', '#199e70', '#c98500',
          '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

/** Par polar para receita vs. despesa. Azul↔vermelho, não verde↔vermelho.
 *  Ver a nota "Por que receita não é verde no gráfico" em components.md. */
export const polar = {
  light: { receita: '#2a78d6', despesa: '#e34948', zero: '#f0efec' },
  dark:  { receita: '#3987e5', despesa: '#e66767', zero: '#383835' },
} as const;

/** Teto de fatias na rosca da S15, incluindo "Outras".
 *  O dataviz limita part-to-whole a 6 segmentos: acima disso a rosca deixa de
 *  ser legível e o ranking abaixo dela é que responde a pergunta. */
export const CATEGORIAS_MAX = 6;

export const space = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

/** Área de toque mínima. 44pt iOS / 48dp Android: 48 serve aos dois. */
export const TARGET_MIN = 48;

export const type = {
  xs: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  sm: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  base: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  lg: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  xl: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  money: { fontSize: 34, lineHeight: 40, fontWeight: '700',
           fontVariant: ['tabular-nums'] as const },
  display: { fontSize: 40, lineHeight: 44, fontWeight: '700',
             fontVariant: ['tabular-nums'] as const },
} as const;

export const motion = { fast: 120, base: 200 } as const;


/** Formatação de dinheiro NÃO mora aqui — está em src/lib/money.ts.
 *  Este arquivo é só design: cor, espaço, tipo, movimento. Regra de negócio
 *  dentro de arquivo de token é exatamente como a formatação acaba divergindo
 *  entre duas telas.
 *
 *  Canônico para código: este arquivo (src/design/tokens.ts).
 *  replica/design/tokens.ts é o artefato do replica-design e pode ficar atrás;
 *  na dúvida, vale este. */
