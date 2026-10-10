/** Rota /design — os primitivos em todos os estados, isolados.
 *
 *  Existe para ser olhada: é aqui que colisão de rótulo, alvo de toque pequeno
 *  e contraste ruim aparecem antes de contaminar uma tela de produto. O passo 4
 *  do replica-design pede exatamente isto, antes de qualquer tela.
 *
 *  Não é tela de produto. Fica fora do app quando o M0 fechar.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Row,
  SectionHeader,
  Txt,
  type ButtonVariant,
} from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { BalanceCard, MonthSwitcher, OptionList } from '@/components/ui/widgets';
import { categorical, space, useMode, useTheme } from '@/design/theme';
import { monthStart, today } from '@/lib/civil-date';

const VARIANTES: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];

const CATEGORIAS_FALSAS = [
  { id: '1', nome: 'Mercado', cor: categorical.light[0] },
  { id: '2', nome: 'Moradia', cor: categorical.light[1] },
  { id: '3', nome: 'Um nome de categoria absurdamente longo para testar corte', cor: categorical.light[2] },
];

export default function Design() {
  const t = useTheme();
  const mode = useMode();
  const [valor, setValor] = useState(0);
  const [sel, setSel] = useState<string | null>('1');
  const [mes, setMes] = useState(monthStart(today()));

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <Txt variant="xl">Sistema de design</Txt>
      <Txt variant="sm" color="textMuted">
        {`modo atual: ${mode}`}
      </Txt>

      <SectionHeader>Tipografia</SectionHeader>
      <Txt variant="display">Display 40</Txt>
      <Txt variant="money">R$ 1.234,56</Txt>
      <Txt variant="xl">Título 28</Txt>
      <Txt variant="lg">Subtítulo 20</Txt>
      <Txt variant="base">Corpo 16 — o texto normal do app.</Txt>
      <Txt variant="sm" color="textMuted">
        Pequeno 14 em texto secundário.
      </Txt>
      <Txt variant="xs" color="textMuted">
        Mínimo 12 — não usar abaixo disto.
      </Txt>

      <SectionHeader>Botões: variantes e estados</SectionHeader>
      {VARIANTES.map((v) => (
        <View key={v} style={styles.linhaBotoes}>
          <Button label={v} variant={v} style={styles.flex} />
          <Button label="desabilitado" variant={v} disabled style={styles.flex} />
          <Button label="salvando" variant={v} loading style={styles.flex} />
        </View>
      ))}
      <View style={styles.linhaBotoes}>
        <Button label="sm" size="sm" style={styles.flex} />
        <Button label="md" size="md" style={styles.flex} />
        <Button label="lg" size="lg" style={styles.flex} />
      </View>

      <SectionHeader>Valor monetário</SectionHeader>
      <Card>
        <MoneyInput valueCents={valor} onChange={setValor} kind="despesa" />
        <MoneyInput valueCents={valor} onChange={setValor} kind="receita" />
        <Txt variant="xs" color="textMuted">
          Digite: preenche da direita para a esquerda. O sinal é texto, não cor.
        </Txt>
      </Card>

      <SectionHeader>Saldo</SectionHeader>
      <BalanceCard titulo="Positivo" saldoCents={123456} />
      <BalanceCard titulo="Negativo" saldoCents={-45900} />
      <BalanceCard titulo="Zero" saldoCents={0} />
      <BalanceCard titulo="Oculto (modo privacidade)" saldoCents={123456} oculto />

      <SectionHeader>Barra de progresso</SectionHeader>
      <Card>
        <ProgressBar fracao={0.4} rotulo="R$ 400 de R$ 1.000 (40%)" />
        <View style={{ height: space[4] }} />
        <ProgressBar fracao={0.9} rotulo="R$ 900 de R$ 1.000 (90%)" />
        <View style={{ height: space[4] }} />
        <ProgressBar fracao={1.3} rotulo="R$ 1.300 de R$ 1.000 (130%) — estourado" />
      </Card>

      <SectionHeader>Seleção (inclui nome longo)</SectionHeader>
      <OptionList
        itens={CATEGORIAS_FALSAS}
        selecionadoId={sel}
        rotulo={(c) => c.nome}
        cor={(c) => c.cor}
        onSelect={(c) => setSel(c.id)}
      />

      <SectionHeader>Seletor de mês</SectionHeader>
      <MonthSwitcher mes={mes} onChange={setMes} />

      <SectionHeader>Os 8 slots categóricos</SectionHeader>
      <Txt variant="xs" color="textMuted">
        Ordem fixa — nunca ciclar, nunca gerar o 9º. Três deles ficam abaixo de
        3:1 no modo claro e exigem rótulo visível.
      </Txt>
      <View style={styles.slots}>
        {categorical[mode].map((c, i) => (
          <View key={c} style={[styles.slot, { backgroundColor: c, borderColor: t.surface }]}>
            <Txt variant="xs" color="onAccent">
              {String(i + 1)}
            </Txt>
          </View>
        ))}
      </View>

      <SectionHeader>Linha prensável</SectionHeader>
      <Row onPress={() => {}} accessibilityLabel="Exemplo de linha prensável">
        <Txt variant="base" style={styles.flex}>
          Toque e veja o estado pressionado
        </Txt>
        <Txt variant="base" color="textMuted">
          {'›'}
        </Txt>
      </Row>

      <SectionHeader>Estado vazio</SectionHeader>
      <Card>
        <EmptyState
          titulo="Nada por aqui"
          texto="Texto de estado vazio diz o próximo passo concreto, não um lamento."
          acao={{ label: 'Fazer a coisa', onPress: () => {} }}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8], gap: space[1] },
  linhaBotoes: { flexDirection: 'row', gap: space[2], marginBottom: space[2] },
  flex: { flex: 1 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  slot: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
