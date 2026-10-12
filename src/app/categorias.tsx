/** S13 — Categorias, separadas por tipo. */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { IconeCategoria } from '@/components/ui/icone-categoria';
import { Button, Row, SectionHeader, Txt } from '@/components/ui/primitives';
import { listCategories } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';

export default function Categorias() {
  const t = useTheme();
  const router = useRouter();
  const cats = useAsync(() => listCategories(), ['cats-todas']);

  if (cats.error) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível carregar as categorias
        </Txt>
        <Button label="Tentar de novo" onPress={cats.reload} style={{ marginTop: space[4] }} />
      </View>
    );
  }

  const lista = cats.data ?? [];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      {(['despesa', 'receita'] as const).map((tipo) => (
        <View key={tipo}>
          <SectionHeader>{tipo === 'despesa' ? 'Despesas' : 'Receitas'}</SectionHeader>
          {lista
            .filter((c) => c.tipo === tipo)
            .map((c) => (
              <Row key={c.id} accessibilityLabel={`${c.nome}, categoria de ${tipo}`}>
                <IconeCategoria icone={c.icone} cor={c.cor} />
                <Txt variant="base" style={{ flex: 1 }} numberOfLines={1}>
                  {c.nome}
                </Txt>
              </Row>
            ))}
          <Button
            label={`+ Nova categoria de ${tipo}`}
            variant="ghost"
            size="sm"
            onPress={() => router.push({ pathname: '/categoria-nova', params: { tipo } })}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
});
