/** As abas. O portão do banco e as telas de fluxo (novo lançamento, novo
 *  cartão, fatura) ficam na pilha do layout raiz. */

import { Tabs } from 'expo-router';

import { useTheme } from '@/design/theme';

export default function TabsLayout() {
  const t = useTheme();
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
      <Tabs.Screen name="cartoes" options={{ title: 'Cartões' }} />
      <Tabs.Screen name="relatorios" options={{ title: 'Relatórios' }} />
      <Tabs.Screen name="design" options={{ title: 'Design' }} />
    </Tabs>
  );
}
