/** S08 — Contas: lista com saldo de cada uma e o total. */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, EmptyState, Txt } from '@/components/ui/primitives';
import { accountBalances, ROTULO_TIPO_CONTA, type TipoConta } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { formatCents } from '@/lib/money';

export default function Contas() {
  const t = useTheme();
  const router = useRouter();
  const contas = useAsync(() => accountBalances(), ['saldos']);

  if (contas.error) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível carregar as contas
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {contas.error.message}
        </Txt>
        <Button label="Tentar de novo" onPress={contas.reload} style={{ marginTop: space[4] }} />
      </View>
    );
  }

  const lista = contas.data ?? [];
  const total = lista.reduce((a, c) => a + c.saldoCents, 0);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      {contas.loading && !contas.data ? (
        <Txt variant="sm" color="textMuted">
          {'Carregando…'}
        </Txt>
      ) : lista.length === 0 ? (
        <EmptyState
          titulo="Nenhuma conta"
          texto="Cadastre onde o seu dinheiro fica: banco, poupança, dinheiro vivo."
          acao={{ label: 'Nova conta', onPress: () => router.push('/conta-nova') }}
        />
      ) : (
        <>
          <Card>
            <Txt variant="sm" color="textMuted">
              Total nas contas
            </Txt>
            <Txt variant="money" color={total < 0 ? 'danger' : 'text'} style={{ marginTop: space[1] }}>
              {formatCents(total)}
            </Txt>
          </Card>

          {lista.map((c) => (
            <Card key={c.id} style={styles.conta}>
              <View style={styles.linha}>
                <View style={styles.flex}>
                  <Txt variant="base" numberOfLines={1}>
                    {c.nome}
                  </Txt>
                  <Txt variant="xs" color="textMuted">
                    {ROTULO_TIPO_CONTA[c.tipo as TipoConta]}
                  </Txt>
                </View>
                <Txt
                  variant="base"
                  color={c.saldoCents < 0 ? 'danger' : 'text'}
                  style={{ fontWeight: '600' }}>
                  {formatCents(c.saldoCents)}
                </Txt>
              </View>
              {c.saldoCents < 0 ? (
                <Txt variant="xs" color="danger" style={{ marginTop: space[1] }}>
                  saldo negativo
                </Txt>
              ) : null}
            </Card>
          ))}

          <Button
            label="Nova conta"
            variant="secondary"
            onPress={() => router.push('/conta-nova')}
            style={{ marginTop: space[3] }}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8], gap: space[2] },
  conta: { marginTop: space[1] },
  linha: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1 },
});
