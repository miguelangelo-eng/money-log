/** MoneyInput — entrada de valor monetário.
 *
 *  Comportamento: preenche da DIREITA para a esquerda. Digitar 4,2,9,0 produz
 *  0,04 -> 0,42 -> 4,29 -> 42,90. É como todo app de banco se comporta e é o
 *  que o dedo espera; digitar "42,90" com vírgula num teclado numérico de
 *  celular é um fluxo pior.
 *
 *  O valor guardado é SEMPRE centavos inteiros. Nunca string, nunca float.
 *
 *  Foco visível: o TextInput de verdade é invisível, então o estado "estou
 *  digitando aqui" tem de ser desenhado — moldura como a do Field (accent e
 *  2px com foco) e um cursor piscando depois do número. Sem isso não havia
 *  como saber se o teclado estava escrevendo no valor.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { radius, space, type as typeScale, useTheme } from '@/design/theme';
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
  const [focado, setFocado] = useState(false);
  const piscar = useRef(new Animated.Value(1)).current;

  // No Android, fechar o teclado pelo "voltar" NÃO tira o foco do TextInput.
  // Aí a moldura continuaria dizendo "digitando" e tocar de novo no valor não
  // reabriria o teclado (focus() num campo já focado não faz nada).
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => input.current?.blur());
    return () => sub.remove();
  }, []);

  // Cursor piscando enquanto focado; parado para quem pediu menos movimento.
  useEffect(() => {
    if (!focado) return;
    let animacao: Animated.CompositeAnimation | null = null;
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (!vivo || reduzir) return;
      animacao = Animated.loop(
        Animated.sequence([
          Animated.timing(piscar, { toValue: 0, duration: 500, delay: 300, useNativeDriver: true }),
          Animated.timing(piscar, { toValue: 1, duration: 0, delay: 400, useNativeDriver: true }),
        ]),
      );
      animacao.start();
    });
    return () => {
      vivo = false;
      animacao?.stop();
      piscar.setValue(1);
    };
  }, [focado, piscar]);
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
      <Txt variant="sm" style={{ fontWeight: '600', marginBottom: space[1] }}>
        Valor
      </Txt>
      <View
        style={[
          styles.caixa,
          {
            backgroundColor: t.surface,
            borderColor: focado ? t.accent : t.borderInput,
            borderWidth: focado ? 2 : 1,
            // Compensa a borda mais grossa: o número não pula ao focar.
            padding: focado ? space[3] - 1 : space[3],
          },
        ]}>
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
        {focado ? (
          <Animated.View style={[styles.cursor, { backgroundColor: t.accent, opacity: piscar }]} />
        ) : null}
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
        onFocus={() => setFocado(true)}
        onBlur={() => setFocado(false)}
        style={styles.escondido}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      {!focado ? (
        <Txt variant="xs" color="textMuted" style={{ marginTop: space[1] }}>
          {valueCents === 0 ? 'Toque para digitar o valor' : 'Toque para alterar'}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space[3] },
  caixa: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md },
  cursor: { width: 2, height: typeScale.money.fontSize, marginLeft: space[1] },
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
