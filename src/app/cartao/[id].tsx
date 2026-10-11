/** S12 — Fatura do cartão: navegar entre faturas, ver os itens, pagar.
 *
 *  Abre na fatura que pede ação: a fechada mais antiga com valor a pagar; se
 *  não houver, a atual (onde uma compra de hoje entraria). Só fatura fechada
 *  pode ser paga — numa aberta a tela diz quando o pagamento libera, em vez
 *  de mostrar um botão desabilitado sem explicação.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, EmptyState, SectionHeader, Txt } from '@/components/ui/primitives';
import {
  diaMes,
  mesCurto,
  nomeDoMes,
  OptionList,
  ROTULO_STATUS,
  TransactionRow,
} from '@/components/ui/widgets';
import { cards, listAccounts, listCategories } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, TARGET_MIN, useTheme } from '@/design/theme';
import { today } from '@/lib/civil-date';
import { invoiceForPurchase } from '@/lib/invoice';
import { formatCents } from '@/lib/money';

export default function Fatura() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const hoje = today();

  const cartao = useAsync(() => cards.getCard(id), ['cartao', id]);
  const faturas = useAsync(() => cards.invoices(id, hoje), ['faturas', id, hoje]);
  const contas = useAsync(() => listAccounts(), ['contas']);
  const cats = useAsync(() => listCategories(), ['cats']);

  const [escolhida, setEscolhida] = useState<number | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [pagando, setPagando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const lista = faturas.data ?? [];

  /** Índice inicial: a fechada a pagar, senão a atual, senão a última. */
  const indicePadrao = useMemo(() => {
    if (lista.length === 0 || !cartao.data) return 0;
    const aPagar = lista.findIndex((f) => f.status === 'fechada' && f.totalCents > 0);
    if (aPagar >= 0) return aPagar;
    const atual = invoiceForPurchase(hoje, {
      diaFechamento: cartao.data.diaFechamento,
      diaVencimento: cartao.data.diaVencimento,
    }).mesReferencia;
    const iAtual = lista.findIndex((f) => f.mesReferencia === atual);
    return iAtual >= 0 ? iAtual : lista.length - 1;
  }, [lista, cartao.data, hoje]);

  const i = Math.min(escolhida ?? indicePadrao, Math.max(0, lista.length - 1));
  const fatura = lista[i];

  const itens = useAsync(
    () => (fatura?.id ? cards.invoiceItems(fatura.id) : Promise.resolve([])),
    ['itens', fatura?.id ?? null],
  );

  const porCategoria = useMemo(() => {
    const m = new Map<string, { nome: string; cor: string }>();
    for (const c of cats.data ?? []) m.set(c.id, { nome: c.nome, cor: c.cor });
    return m;
  }, [cats.data]);

  const contaEfetiva =
    contaId ?? cartao.data?.contaPagamentoId ?? contas.data?.[0]?.id ?? null;

  async function pagar() {
    if (!fatura?.id || !contaEfetiva) return;
    setPagando(true);
    setErro(null);
    try {
      await cards.payInvoice({ invoiceId: fatura.id, accountId: contaEfetiva, data: hoje });
      faturas.reload();
      itens.reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setPagando(false);
    }
  }

  const titulo = cartao.data?.nome ?? 'Cartão';

  if (cartao.error || faturas.error) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Stack.Screen options={{ title: titulo }} />
        <Txt variant="lg" color="danger">
          Não foi possível carregar a fatura
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {(cartao.error ?? faturas.error)?.message}
        </Txt>
      </View>
    );
  }

  if (!cartao.loading && cartao.data === null) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Stack.Screen options={{ title: 'Cartão' }} />
        <EmptyState
          titulo="Cartão não encontrado"
          texto="Ele pode ter sido removido."
          acao={{ label: 'Voltar aos cartões', onPress: () => router.replace('/cartoes') }}
        />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <Stack.Screen options={{ title: titulo }} />

      {faturas.loading && !faturas.data ? (
        <Txt variant="sm" color="textMuted">
          {'Carregando…'}
        </Txt>
      ) : !fatura ? (
        <EmptyState
          titulo="Nenhuma compra neste cartão"
          texto="As faturas aparecem conforme você lança compras nele."
          acao={{ label: 'Lançar compra', onPress: () => router.push('/novo') }}
        />
      ) : (
        <>
          {/* Navegação entre faturas existentes */}
          <View style={styles.nav}>
            <Button
              label={'‹'}
              variant="ghost"
              size="sm"
              disabled={i === 0}
              onPress={() => setEscolhida(i - 1)}
            />
            <Txt variant="lg" style={styles.navRotulo}>
              {`Fatura de ${nomeDoMes(fatura.mesReferencia)}`}
            </Txt>
            <Button
              label={'›'}
              variant="ghost"
              size="sm"
              disabled={i >= lista.length - 1}
              onPress={() => setEscolhida(i + 1)}
            />
          </View>

          <Card>
            <Txt variant="sm" color="textMuted">
              {ROTULO_STATUS[fatura.status]}
            </Txt>
            <Txt variant="money" style={{ marginTop: space[1] }}>
              {formatCents(fatura.totalCents)}
            </Txt>
            <Txt variant="xs" color="textMuted" style={{ marginTop: space[1] }}>
              {`fecha ${diaMes(fatura.dataFechamento)} · vence ${diaMes(fatura.dataVencimento)}`}
            </Txt>
          </Card>

          {fatura.status === 'fechada' && fatura.totalCents > 0 ? (
            <>
              <SectionHeader>Pagar com</SectionHeader>
              <OptionList
                itens={contas.data ?? []}
                selecionadoId={contaEfetiva}
                rotulo={(c) => c.nome}
                onSelect={(c) => setContaId(c.id)}
              />
              <Button
                label={`Pagar ${formatCents(fatura.totalCents)}`}
                onPress={pagar}
                loading={pagando}
                disabled={pagando || !contaEfetiva}
                size="lg"
              />
              <Txt variant="xs" color="textMuted" style={{ marginTop: space[2] }}>
                O valor sai da conta escolhida hoje. A compra já entrou como gasto no mês
                dela, então o pagamento não conta de novo nos relatórios.
              </Txt>
            </>
          ) : fatura.status === 'aberta' ? (
            <Txt variant="sm" color="textMuted" style={styles.aviso}>
              {`Esta fatura ainda recebe compras até ${diaMes(fatura.dataFechamento)}. ` +
                'O pagamento fica disponível depois do fechamento.'}
            </Txt>
          ) : fatura.status === 'paga' ? (
            <Txt variant="sm" color="success" style={styles.aviso}>
              {'✓ Fatura paga'}
            </Txt>
          ) : null}

          {erro ? (
            <Txt variant="sm" color="danger" style={{ marginTop: space[2] }}>
              {erro}
            </Txt>
          ) : null}

          <SectionHeader>{`Compras de ${mesCurto(fatura.mesReferencia)}`}</SectionHeader>
          {itens.loading && !itens.data ? (
            <Txt variant="sm" color="textMuted">
              {'Carregando…'}
            </Txt>
          ) : (itens.data ?? []).length === 0 ? (
            <Txt variant="sm" color="textMuted">
              Nenhuma compra nesta fatura.
            </Txt>
          ) : (
            (itens.data ?? []).map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                categoria={tx.categoryId ? porCategoria.get(tx.categoryId) : undefined}
              />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8], gap: space[2] },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TARGET_MIN,
  },
  navRotulo: { flex: 1, textAlign: 'center' },
  aviso: { marginTop: space[2] },
});
