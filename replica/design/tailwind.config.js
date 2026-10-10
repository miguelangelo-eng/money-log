/** Mapeamento dos tokens para o tema do Tailwind, via NativeWind v4.
 *  Objetivo: componente escreve `bg-surface text-muted`, nunca hex cru.
 *  Mover para a raiz do projeto Expo quando o app for criado (M0).
 */
const { hairlineWidth } = require('nativewind/theme');

module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          sunken: 'var(--surface-sunken)',
        },
        border: {
          DEFAULT: 'var(--border)',
          input: 'var(--border-input)',
        },
        text: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
          axis: 'var(--text-axis)',
        },
        accent: 'var(--accent)',
        'on-accent': 'var(--on-accent)',
        danger: 'var(--danger)',
        success: 'var(--success)',
        'warning-ink': 'var(--warning-ink)',
        fill: {
          danger: 'var(--fill-danger)',
          warning: 'var(--fill-warning)',
          success: 'var(--fill-success)',
        },
      },
      // Escala de texto do tokens.json. `money` e `display` ainda precisam de
      // fontVariant: ['tabular-nums'] no componente — Tailwind não expressa isso.
      fontSize: {
        xs: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        sm: ['14px', { lineHeight: '20px', fontWeight: '400' }],
        base: ['16px', { lineHeight: '24px', fontWeight: '400' }],
        lg: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        xl: ['28px', { lineHeight: '34px', fontWeight: '700' }],
        money: ['34px', { lineHeight: '40px', fontWeight: '700' }],
        display: ['40px', { lineHeight: '44px', fontWeight: '700' }],
      },
      fontFamily: {
        sans: ['Inter'],
        mono: ['JetBrains Mono'],
      },
      spacing: {
        0: '0px', 1: '4px', 2: '8px', 3: '12px',
        4: '16px', 6: '24px', 8: '32px', 12: '48px', 16: '64px',
        // área de toque mínima — não é espaçamento, é requisito
        target: '48px',
      },
      borderRadius: { sm: '8px', md: '12px', lg: '20px', pill: '999px' },
      borderWidth: { hairline: hairlineWidth() },
      transitionDuration: { fast: '120ms', base: '200ms' },
    },
  },
  plugins: [],
};
