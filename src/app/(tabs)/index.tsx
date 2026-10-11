/** S03 — Início. Saldo das contas, totais do mês e atalho para lançar.
 *  Estados cobertos: carregando, vazio, preenchido, erro.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, EmptyState, SectionHeader, Txt } from '@/components/ui/primitives';
import { BalanceCard, nomeDoMes } from '@/components/ui/widgets';
import { accountBalances, monthTotals } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { monthStart, today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';

export default function Inicio() {
  const t = useTheme();
  const router = useRouter();
  const mes = monthStart(today());

  const contas = useAsync(() => accountBalances(), ['contas']);
  const totais = useAsync(() => monthTotals(mes), ['totais', mes]);

  const erro = contas.error ?? totais.error;
  if (erro) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível carregar
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {erro.message}
        </Txt>
        <Button
          label="Tentar de novo"
          onPress={() => {
            contas.reload();
            totais.reload();
          }}
          style={{ marginTop: space[4] }}
        />
      </View>
    );
  }

  const carregando = contas.loading || totais.loading;
  const saldoTotal = (contas.data ?? []).reduce((a, c) => a + c.saldoCents, 0);
  const semMovimento =
    !carregando &&
    (totais.data?.receitaCents ?? 0) === 0 &&
    (totais.data?.despesaCents ?? 0) === 0;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <BalanceCard titulo="Saldo nas contas" saldoCents={saldoTotal} />

      <SectionHeader>{nomeDoMes(mes)}</SectionHeader>

      {semMovimento ? (
        <EmptyState
          titulo="Nenhum lançamento este mês"
          texto="Registre o primeiro gasto para começar a ver para onde o dinheiro vai."
          acao={{ label: 'Lançar despesa', onPress: () => router.push('/novo') }}
        />
      ) : (
        <>
          <View style={styles.par}>
            <Card style={styles.metade}>
              <Txt variant="sm" color="textMuted">
                Entrou
              </Txt>
              <Txt variant="lg" color="success" style={{ marginTop: space[1] }}>
                {carregando ? '—' : formatCents(totais.data?.receitaCents ?? 0)}
              </Txt>
            </Card>
            <Card style={styles.metade}>
              <Txt variant="sm" color="textMuted">
                Saiu
              </Txt>
              <Txt variant="lg" color="danger" style={{ marginTop: space[1] }}>
                {carregando ? '—' : formatCents(totais.data?.despesaCents ?? 0)}
              </Txt>
            </Card>
          </View>

          <Button
            label="Lançar despesa"
            onPress={() => router.push('/novo')}
            style={{ marginTop: space[4] }}
          />
        </>
      )}

      <SectionHeader>Contas</SectionHeader>
      {(contas.data ?? []).map((c) => (
        <BalanceCard key={c.id} titulo={c.nome} saldoCents={c.saldoCents} />
      ))}

      <View style={styles.par}>
        <Button
          label="Contas"
          variant="secondary"
          onPress={() => router.push('/contas')}
          style={styles.metade}
        />
        <Button
          label="Categorias"
          variant="secondary"
          onPress={() => router.push('/categorias')}
          style={styles.metade}
        />
      </View>
      <Button label="Backup e conta" variant="secondary" onPress={() => router.push('/backup')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], gap: space[2], paddingBottom: space[8] },
  par: { flexDirection: 'row', gap: space[3] },
  metade: { flex: 1 },
});
