/** TransactionRow, BalanceCard, MonthSwitcher e OptionList.
 *  Especificação: replica/design/components.md.
 */

import { StyleSheet, View } from 'react-native';

import { radius, space, TARGET_MIN, useTheme } from '@/design/theme';
import { addMonths, monthStart, parse } from '@/lib/civil-date';
import { formatCents, formatSigned } from '@/lib/money';
import type { Transaction } from '@/db/schema';
import type { StatusFatura } from '@/lib/card';

import { Button, Card, Row, Txt } from './primitives';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "outubro de 2026" -> "outubro". O ano só atrapalha numa linha de fatura. */
export const mesCurto = (d: string) => nomeDoMes(d).split(' de ')[0];

/** '2026-11-10' -> '10/11'. */
export const diaMes = (d: string) => {
  const { day, month } = parse(d);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};

/** Status de fatura sempre com marca textual, não só cor. */
export const ROTULO_STATUS: Record<StatusFatura, string> = {
  aberta: '○ aberta',
  fechada: '● fechada',
  paga: '✓ paga',
};

export function nomeDoMes(d: string): string {
  const { year, month } = parse(d);
  return `${MESES[month - 1]} de ${year}`;
}

// ---------------------------------------------------------------------------
// TransactionRow
// ---------------------------------------------------------------------------

export function TransactionRow({
  tx,
  categoria,
  onPress,
}: {
  tx: Transaction;
  categoria?: { nome: string; cor: string };
  onPress?: () => void;
}) {
  const t = useTheme();
  const { day } = parse(tx.competencia);

  /** Cada tipo decide sinal, cor e rótulo explicitamente. Um `else` genérico
   *  aqui já foi um bug: com o tipo `pagamento_fatura`, ele cairia no ramo
   *  de receita e apareceria com `+`. */
  const apresentacao: Record<
    Transaction['kind'],
    { valor: string; cor: 'danger' | 'success' | 'textMuted'; tipo: string }
  > = {
    despesa: { valor: formatSigned(tx.amountCents, 'despesa'), cor: 'danger', tipo: 'despesa' },
    receita: { valor: formatSigned(tx.amountCents, 'receita'), cor: 'success', tipo: 'receita' },
    // Move dinheiro entre contas do próprio usuário: sem sinal, sem cor.
    transferencia: { valor: formatCents(tx.amountCents), cor: 'textMuted', tipo: 'transferência' },
    // Sai da conta, mas não é gasto novo (a compra já foi): sinal, sem vermelho.
    pagamento_fatura: {
      valor: formatSigned(tx.amountCents, 'despesa'),
      cor: 'textMuted',
      tipo: 'pagamento de fatura',
    },
  };
  const { valor, cor: corValor, tipo } = apresentacao[tx.kind];

  const parcela = tx.parcelaN && tx.parcelaDe ? `${tx.parcelaN}/${tx.parcelaDe}` : null;
  const recorrente = tx.seriesId !== null && tx.parcelaN === null;
  const noCartao = tx.creditCardId !== null && tx.kind !== 'pagamento_fatura';

  // Uma linha é UM nó de leitura, não seis. Ver a11y em components.md.
  const leitura = [
    tx.descricao || categoria?.nome || 'Lançamento',
    tipo,
    `de ${formatCents(tx.amountCents)}`,
    parcela ? `parcela ${tx.parcelaN} de ${tx.parcelaDe}` : null,
    recorrente ? 'repete todo mês' : null,
    noCartao ? 'no cartão' : null,
    `dia ${day}`,
    tx.pago ? 'pago' : 'pendente',
  ]
    .filter(Boolean)
    .join(', ');

  const subtitulo = [
    tx.kind === 'pagamento_fatura' ? 'Pagamento de fatura' : (categoria?.nome ?? 'Sem categoria'),
    noCartao ? 'cartão' : null,
    parcela,
    recorrente ? '↻ mensal' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Row onPress={onPress} accessibilityLabel={leitura}>
      <View
        style={[
          styles.pontoCategoria,
          { backgroundColor: categoria?.cor ?? t.textMuted, borderColor: t.surface },
        ]}
      />
      <View style={styles.meio}>
        <Txt variant="base" numberOfLines={1}>
          {tx.descricao || categoria?.nome || 'Sem descrição'}
        </Txt>
        <Txt variant="xs" color="textMuted">
          {/* Pendente carrega ÍCONE textual + rótulo, nunca só a cor. */}
          {subtitulo}
          {tx.pago ? '' : '  ○ pendente'}
        </Txt>
      </View>
      <Txt variant="base" color={corValor} style={styles.valor}>
        {valor}
      </Txt>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// BalanceCard
// ---------------------------------------------------------------------------

export function BalanceCard({
  titulo,
  saldoCents,
  oculto,
}: {
  titulo: string;
  saldoCents: number;
  oculto?: boolean;
}) {
  const negativo = saldoCents < 0;
  return (
    <Card>
      <Txt variant="sm" color="textMuted">
        {titulo}
      </Txt>
      {/* Modo privacidade esconde do leitor de tela também: senão o saldo sai
          no alto-falante dentro do ônibus. */}
      <Txt
        variant="money"
        color={negativo ? 'danger' : 'text'}
        style={{ marginTop: space[1] }}>
        {oculto ? '•••••' : formatCents(saldoCents)}
      </Txt>
      {negativo && !oculto ? (
        <Txt variant="xs" color="danger">
          saldo negativo
        </Txt>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MonthSwitcher
// ---------------------------------------------------------------------------

export function MonthSwitcher({
  mes,
  onChange,
}: {
  mes: string;
  onChange: (novo: string) => void;
}) {
  return (
    <View style={styles.mes}>
      {/* Rótulo em chaves, não em string de atributo: em JSX o escape \uXXXX
          dentro de "..." não é interpretado e sairia literal na tela.
          O leitor de tela recebe o nome por accessibilityLabel, não a seta. */}
      <Button
        label={'‹'}
        variant="ghost"
        size="sm"
        onPress={() => onChange(monthStart(addMonths(mes, -1)))}
      />
      <Txt variant="lg" style={styles.mesRotulo}>
        {nomeDoMes(mes)}
      </Txt>
      <Button
        label={'›'}
        variant="ghost"
        size="sm"
        onPress={() => onChange(monthStart(addMonths(mes, 1)))}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// OptionList — seleção de categoria e de conta
// ---------------------------------------------------------------------------

export function OptionList<T extends { id: string }>({
  itens,
  selecionadoId,
  rotulo,
  cor,
  onSelect,
}: {
  itens: T[];
  selecionadoId?: string | null;
  rotulo: (item: T) => string;
  cor?: (item: T) => string;
  onSelect: (item: T) => void;
}) {
  const t = useTheme();
  return (
    <View>
      {itens.map((item) => {
        const ativo = item.id === selecionadoId;
        return (
          <Row
            key={item.id}
            onPress={() => onSelect(item)}
            accessibilityLabel={rotulo(item)}
            accessibilityState={{ selected: ativo }}
            style={[
              styles.opcao,
              {
                borderColor: ativo ? t.accent : t.border,
                backgroundColor: ativo ? t.surfaceSunken : 'transparent',
              },
            ]}>
            {cor ? (
              <View
                style={[styles.pontoCategoria, { backgroundColor: cor(item), borderColor: t.surface }]}
              />
            ) : null}
            <Txt variant="base" style={styles.meio}>
              {rotulo(item)}
            </Txt>
            {/* Estado selecionado tem marca textual, não só cor de fundo. */}
            {ativo ? (
              <Txt variant="base" color="accent">
                {'✓'}
              </Txt>
            ) : null}
          </Row>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pontoCategoria: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    // Anel de 2px na cor da superfície: regra de marca do dataviz, e aqui
    // garante separação quando duas cores de categoria ficam vizinhas.
    borderWidth: 2,
  },
  meio: { flex: 1 },
  valor: { fontWeight: '600' },
  mes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TARGET_MIN,
  },
  mesRotulo: { flex: 1, textAlign: 'center' },
  opcao: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    marginBottom: space[2],
  },
});
