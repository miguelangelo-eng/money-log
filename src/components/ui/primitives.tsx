/** Primitivos. Especificação: replica/design/components.md.
 *
 *  Regra do build: nenhum hex e nenhum pixel solto aqui. Tudo vem de
 *  src/design/tokens.ts pelo useTheme(). Se falta um valor, ele entra nos
 *  tokens, não no componente.
 */

import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { radius, space, TARGET_MIN, type as typeScale, useTheme } from '@/design/theme';
import type { ThemeColor } from '@/design/theme';

// ---------------------------------------------------------------------------
// Txt — todo texto do app passa por aqui, para a cor vir de papel e não de hex
// ---------------------------------------------------------------------------

type TxtVariant = keyof typeof typeScale;

export function Txt({
  children,
  variant = 'base',
  color = 'text',
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: TxtVariant;
  color?: ThemeColor;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  const s = typeScale[variant];
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          fontWeight: s.fontWeight as TextStyle['fontWeight'],
          color: t[color],
        },
        'fontVariant' in s ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const ALTURA: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bloqueado = Boolean(disabled || loading);

  const fundo: Record<ButtonVariant, string> = {
    primary: t.accent,
    secondary: t.surface,
    ghost: 'transparent',
    danger: t.fillDanger,
  };
  const tinta: Record<ButtonVariant, ThemeColor> = {
    primary: 'onAccent',
    secondary: 'text',
    ghost: 'accent',
    danger: 'onAccent',
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={bloqueado}
      accessibilityRole="button"
      // O rótulo NUNCA é trocado por spinner: quem usa leitor de tela perderia
      // o que o botão faz. O estado vai em accessibilityState.busy.
      accessibilityState={{ disabled: bloqueado, busy: Boolean(loading) }}
      // Altura visual pode ser menor que o alvo de toque; hitSlop cobre a diferença.
      hitSlop={Math.max(0, (TARGET_MIN - ALTURA[size]) / 2)}
      style={({ pressed }) => [
        styles.botao,
        {
          minHeight: ALTURA[size],
          backgroundColor: fundo[variant],
          borderRadius: radius.md,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderColor: t.border,
          opacity: bloqueado ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      <Txt variant="base" color={tinta[variant]} style={styles.botaoTexto}>
        {loading ? `${label}…` : label}
      </Txt>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.border,
          padding: space[4],
        },
        style,
      ]}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

export function SectionHeader({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: space[2], backgroundColor: t.bg }}>
      <Txt variant="sm" color="textMuted" style={{ fontWeight: '600' }}>
        {children}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — texto escrito de zero, dizendo o próximo passo concreto
// ---------------------------------------------------------------------------

export function EmptyState({
  titulo,
  texto,
  acao,
}: {
  titulo: string;
  texto: string;
  acao?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.vazio}>
      <Txt variant="lg" style={styles.centro}>
        {titulo}
      </Txt>
      <Txt variant="sm" color="textMuted" style={[styles.centro, { marginTop: space[2] }]}>
        {texto}
      </Txt>
      {acao ? (
        <Button
          label={acao.label}
          onPress={acao.onPress}
          style={{ marginTop: space[4], alignSelf: 'center', paddingHorizontal: space[6] }}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar — o texto numérico é OBRIGATÓRIO, a cor não carrega o estado
// ---------------------------------------------------------------------------

export function ProgressBar({
  fracao,
  rotulo,
}: {
  /** 0..n — acima de 1 significa estourado. */
  fracao: number;
  rotulo: string;
}) {
  const t = useTheme();
  const clamped = Math.max(0, Math.min(1, fracao));
  const cor = fracao > 1 ? t.fillDanger : fracao >= 0.8 ? t.fillWarning : t.fillSuccess;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(fracao * 100), min: 0, max: 100 }}>
      <View
        style={{
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: t.surfaceSunken,
          overflow: 'hidden',
        }}>
        <View
          style={{
            width: `${clamped * 100}%`,
            height: '100%',
            backgroundColor: cor,
            borderRadius: radius.pill,
          }}
        />
      </View>
      {/* fill-warning tem 1,79:1 na superfície clara e NAO pode carregar
          significado sozinho — este texto é a mitigação, não enfeite. */}
      <Txt variant="xs" color="textMuted" style={{ marginTop: space[1] }}>
        {rotulo}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Row — linha prensável genérica, com alvo de toque garantido
// ---------------------------------------------------------------------------

export function Row({
  children,
  onPress,
  accessibilityLabel,
  style,
  ...rest
}: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.linha,
        {
          minHeight: TARGET_MIN,
          backgroundColor: pressed && onPress ? t.surfaceSunken : 'transparent',
        },
        style,
      ]}
      {...rest}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  botao: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  botaoTexto: { fontWeight: '600' },
  vazio: { paddingVertical: space[8], paddingHorizontal: space[4] },
  centro: { textAlign: 'center' },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
  },
});
