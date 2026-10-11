/** S04 — Lançamentos do mês. Estados: carregando, vazio, preenchido, erro. */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, EmptyState, SectionHeader, Txt } from '@/components/ui/primitives';
import { MonthSwitcher, TransactionRow } from '@/components/ui/widgets';
import { listByMonth, listCategories } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { monthStart, parse, today } from '@/lib/civil-date';

export default function Lancamentos() {
  const t = useTheme();
  const router = useRouter();
  const [mes, setMes] = useState(monthStart(today()));

  const lista = useAsync(() => listByMonth(mes), ['lista', mes]);
  const cats = useAsync(() => listCategories(), ['cats-todas']);

  const porId = useMemo(() => {
    const m = new Map<string, { nome: string; cor: string }>();
    for (const c of cats.data ?? []) m.set(c.id, { nome: c.nome, cor: c.cor });
    return m;
  }, [cats.data]);

  /** Agrupa por dia. O cabeçalho de data é o que torna a lista legível quando
   *  há 40 lançamentos no mês. */
  const porDia = useMemo(() => {
    const grupos = new Map<string, typeof lista.data>();
    for (const tx of lista.data ?? []) {
      const atual = grupos.get(tx.competencia) ?? [];
      atual.push(tx);
      grupos.set(tx.competencia, atual);
    }
    return [...grupos.entries()];
  }, [lista.data]);

  if (lista.error) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível carregar os lançamentos
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {lista.error.message}
        </Txt>
        <Button label="Tentar de novo" onPress={lista.reload} style={{ marginTop: space[4] }} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <MonthSwitcher mes={mes} onChange={setMes} />

      {lista.loading ? (
        <Txt variant="sm" color="textMuted" style={{ paddingVertical: space[6] }}>
          {'Carregando…'}
        </Txt>
      ) : porDia.length === 0 ? (
        <EmptyState
          titulo="Nada lançado neste mês"
          texto="Quando você registrar um gasto ou uma entrada, ele aparece aqui, agrupado por dia."
          acao={{ label: 'Lançar agora', onPress: () => router.push('/novo') }}
        />
      ) : (
        porDia.map(([dia, txs]) => (
          <View key={dia}>
            <SectionHeader>{`dia ${parse(dia).day}`}</SectionHeader>
            {(txs ?? []).map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                categoria={tx.categoryId ? porId.get(tx.categoryId) : undefined}
                onPress={() => router.push(`/lancamento/${tx.id}`)}
              />
            ))}
          </View>
        ))
      )}

      <Button
        label="Novo lançamento"
        onPress={() => router.push('/novo')}
        style={{ marginTop: space[6] }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
});
