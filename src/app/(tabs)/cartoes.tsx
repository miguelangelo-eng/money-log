/** S10 — Cartões de crédito. Estados: carregando, vazio, preenchido, erro.
 *
 *  Por cartão: a fatura em que uma compra de hoje entra, a fatura fechada
 *  esperando pagamento (quando houver) e o limite livre. O limite livre já
 *  desconta as parcelas futuras, que é como o banco compromete o limite.
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Txt,
} from '@/components/ui/primitives';
import { diaMes, mesCurto, ROTULO_STATUS } from '@/components/ui/widgets';
import { cards } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { radius, space, useTheme } from '@/design/theme';
import { today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';

export default function Cartoes() {
  const t = useTheme();
  const router = useRouter();
  const hoje = today();
  const resumo = useAsync(() => cards.summaries(hoje), ['cartoes', hoje]);

  if (resumo.error) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível carregar os cartões
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {resumo.error.message}
        </Txt>
        <Button label="Tentar de novo" onPress={resumo.reload} style={{ marginTop: space[4] }} />
      </View>
    );
  }

  if (resumo.loading && !resumo.data) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="sm" color="textMuted">
          {'Carregando…'}
        </Txt>
      </View>
    );
  }

  const lista = resumo.data ?? [];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      {lista.length === 0 ? (
        <EmptyState
          titulo="Nenhum cartão cadastrado"
          texto="Cadastre o cartão com os dias de fechamento e vencimento. É deles que o app calcula em que fatura cada compra cai."
          acao={{ label: 'Cadastrar cartão', onPress: () => router.push('/cartao-novo') }}
        />
      ) : (
        lista.map(({ cartao, faturaAtual, faturaAPagar, usadoCents, disponivelCents }) => {
          const fracao = cartao.limiteCents > 0 ? usadoCents / cartao.limiteCents : 0;
          return (
            <Pressable
              key={cartao.id}
              onPress={() => router.push(`/cartao/${cartao.id}`)}
              accessibilityRole="button"
              accessibilityLabel={[
                `Cartão ${cartao.nome}`,
                `fatura de ${mesCurto(faturaAtual.mesReferencia)} ${faturaAtual.status}, ${formatCents(faturaAtual.totalCents)}`,
                faturaAPagar
                  ? `fatura de ${mesCurto(faturaAPagar.mesReferencia)} fechada, ${formatCents(faturaAPagar.devidoCents)} a pagar até ${diaMes(faturaAPagar.dataVencimento)}`
                  : null,
                `${formatCents(disponivelCents)} de limite livre`,
              ]
                .filter(Boolean)
                .join(', ')}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, borderRadius: radius.lg })}>
              <Card style={{ marginBottom: space[3] }}>
                <Txt variant="lg" numberOfLines={1}>
                  {cartao.nome}
                </Txt>

                <View style={styles.linha}>
                  <Txt variant="sm" color="textMuted" style={styles.flex}>
                    {`Fatura de ${mesCurto(faturaAtual.mesReferencia)} · ${ROTULO_STATUS[faturaAtual.status]}`}
                  </Txt>
                  <Txt variant="base" style={{ fontWeight: '600' }}>
                    {formatCents(faturaAtual.totalCents)}
                  </Txt>
                </View>
                <Txt variant="xs" color="textMuted">
                  {`fecha ${diaMes(faturaAtual.dataFechamento)} · vence ${diaMes(faturaAtual.dataVencimento)}`}
                </Txt>

                {faturaAPagar ? (
                  <View
                    style={[
                      styles.aPagar,
                      { backgroundColor: t.surfaceSunken, borderColor: t.border },
                    ]}>
                    <Txt variant="sm" color="warningInk" style={{ fontWeight: '600' }}>
                      {`⚠ Fatura de ${mesCurto(faturaAPagar.mesReferencia)} fechada`}
                    </Txt>
                    <Txt variant="sm">
                      {`${formatCents(faturaAPagar.devidoCents)} · vence ${diaMes(faturaAPagar.dataVencimento)}`}
                    </Txt>
                  </View>
                ) : null}

                {cartao.limiteCents > 0 ? (
                  <View style={{ marginTop: space[3] }}>
                    <ProgressBar
                      fracao={fracao}
                      rotulo={
                        disponivelCents < 0
                          ? `Limite estourado em ${formatCents(-disponivelCents)}`
                          : `${formatCents(disponivelCents)} livres de ${formatCents(cartao.limiteCents)}`
                      }
                    />
                  </View>
                ) : null}
              </Card>
            </Pressable>
          );
        })
      )}

      {lista.length > 0 ? (
        <Button
          label="Cadastrar outro cartão"
          variant="secondary"
          onPress={() => router.push('/cartao-novo')}
          style={{ marginTop: space[3] }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
  linha: { flexDirection: 'row', alignItems: 'baseline', gap: space[3], marginTop: space[2] },
  flex: { flex: 1 },
  aPagar: {
    marginTop: space[3],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
