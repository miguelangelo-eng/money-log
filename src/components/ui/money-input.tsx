/** MoneyInput — entrada de valor monetário.
 *
 *  Comportamento: preenche da DIREITA para a esquerda. Digitar 4,2,9,0 produz
 *  0,04 -> 0,42 -> 4,29 -> 42,90. É como todo app de banco se comporta e é o
 *  que o dedo espera; digitar "42,90" com vírgula num teclado numérico de
 *  celular é um fluxo pior.
 *
 *  O valor guardado é SEMPRE centavos inteiros. Nunca string, nunca float.
 */

import { useRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { space, type as typeScale, useTheme } from '@/design/theme';
import { formatCents, popDigit, pushDigit, type Cents } from '@/lib/money';

import { Txt } from './primitives';

export function MoneyInput({
  valueCents,
  onChange,
  kind,
  autoFocus,
}: {
  valueCents: Cents;
  onChange: (cents: Cents) => void;
  /** `neutro` é para valor que não é entrada nem saída — limite de cartão,
   *  saldo inicial. Sem sinal e sem cor semântica: um `−` num limite seria
   *  informação falsa. */
  kind: 'despesa' | 'receita' | 'neutro';
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const input = useRef<TextInput>(null);
  const cor = kind === 'despesa' ? t.danger : kind === 'receita' ? t.success : t.text;
  const sinal = kind === 'despesa' ? '−' : kind === 'receita' ? '+' : '';

  /** O TextInput real fica invisível e com valor vazio; o que o usuário vê é
   *  texto formatado. Assim o cursor nunca aparece no meio do número e não há
   *  como editar o texto para um estado inválido. */
  function onKeyPress(key: string) {
    if (key === 'Backspace') return onChange(popDigit(valueCents));
    onChange(pushDigit(valueCents, key));
  }

  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessibilityRole="none"
      // O sinal é lido junto: a cor NÃO é a portadora do significado.
      accessibilityLabel={`${kind === 'neutro' ? 'valor' : kind} de ${formatCents(valueCents)}`}
      style={styles.wrap}>
      <View style={styles.linha}>
        {sinal ? (
          <Txt variant="xl" color={kind === 'despesa' ? 'danger' : 'success'}>
            {sinal}
          </Txt>
        ) : null}
        <Txt
          variant="money"
          style={{ color: cor, marginLeft: sinal ? space[2] : 0 }}
          numberOfLines={1}>
          {formatCents(valueCents)}
        </Txt>
      </View>

      <TextInput
        ref={input}
        autoFocus={autoFocus}
        value=""
        keyboardType="number-pad"
        // No Android o onKeyPress não dispara para o teclado numérico de forma
        // confiável; onChangeText entrega o dígito e nós o consumimos.
        onChangeText={(txt) => {
          const d = txt.slice(-1);
          if (/\d/.test(d)) onChange(pushDigit(valueCents, d));
        }}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Backspace') onKeyPress('Backspace');
        }}
        style={styles.escondido}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      {valueCents === 0 ? (
        <Txt variant="xs" color="textMuted" style={{ marginTop: space[1] }}>
          Toque para digitar o valor
        </Txt>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space[4] },
  linha: { flexDirection: 'row', alignItems: 'baseline' },
  escondido: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
    // No web o input precisa existir no fluxo para receber foco por teclado.
    ...Platform.select({ web: { pointerEvents: 'none' as const } }),
    fontSize: typeScale.money.fontSize,
  },
});
