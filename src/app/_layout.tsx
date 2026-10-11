/** Layout raiz: portão do banco de dados + pilha de navegação.
 *
 *  A pilha existe para que `novo` fique FORA das abas. Antes ele era um
 *  `Tabs.Screen` com `href: null`, o que esconde da barra mas continua sendo
 *  uma aba — e navegar para uma aba TROCA de aba em vez de empilhar. O
 *  `router.back()` depois de salvar não tinha o que desempilhar e o
 *  react-navigation reclamava: "The action 'GO_BACK' was not handled by any
 *  navigator".
 *
 *  Como lançamento é um fluxo que começa e termina, ele é uma tela de pilha
 *  apresentada como modal. Aí voltar é desempilhar, que é o que a intenção
 *  sempre foi.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
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
          Nenhum dado foi alterado. Limpar os dados do app recria o banco.
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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTitleStyle: { color: t.text },
        headerTintColor: t.accent,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.bg },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="novo"
        options={{ title: 'Novo lançamento', presentation: 'modal' }}
      />
      <Stack.Screen
        name="cartao-novo"
        options={{ title: 'Novo cartão', presentation: 'modal' }}
      />
      {/* O título real (nome do cartão) é definido pela própria tela. */}
      <Stack.Screen name="cartao/[id]" options={{ title: 'Cartão' }} />
    </Stack>
  );
}
