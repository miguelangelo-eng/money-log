import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '../../drizzle/migrations';
import { db } from '@/db/client';
import { ensureSeed } from '@/data/ledger';
import { Txt } from '@/components/ui/primitives';
import { space, useTheme } from '@/design/theme';

export default function RootLayout() {
  const t = useTheme();
  const { success, error } = useMigrations(db, migrations);
  const [semeado, setSemeado] = useState(false);
  const [erroSeed, setErroSeed] = useState<Error | null>(null);

  useEffect(() => {
    if (!success) return;
    ensureSeed()
      .then(() => setSemeado(true))
      .catch((e) => setErroSeed(e instanceof Error ? e : new Error(String(e))));
  }, [success]);

  // Falha de migração é terminal e precisa ser VISÍVEL. Um app de dinheiro que
  // abre com o banco meio migrado é pior que um app que não abre.
  const falha = error ?? erroSeed;
  if (falha) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          padding: space[6],
          justifyContent: 'center',
        }}>
        <Txt variant="lg" color="danger">
          Não foi possível preparar o banco de dados
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {falha.message}
        </Txt>
        <Txt variant="xs" color="textMuted" style={{ marginTop: space[4] }}>
          Nenhum dado foi alterado. Reinstalar o app recria o banco.
        </Txt>
      </View>
    );
  }

  if (!success || !semeado) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTitleStyle: { color: t.text },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textMuted,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="lancamentos" options={{ title: 'Lançamentos' }} />
      <Tabs.Screen name="relatorios" options={{ title: 'Relatórios' }} />
      <Tabs.Screen name="design" options={{ title: 'Design' }} />
      {/* `novo` não é aba: é um fluxo que começa e termina. */}
      <Tabs.Screen name="novo" options={{ href: null, title: 'Novo lançamento' }} />
    </Tabs>
  );
}
