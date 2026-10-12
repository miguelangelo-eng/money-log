/** As abas. O portão do banco e as telas de fluxo (novo lançamento, novo
 *  cartão, fatura) ficam na pilha do layout raiz. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/design/theme';

type NomeIcone = ComponentProps<typeof Ionicons>['name'];

/** Ativa: ícone preenchido; inativa: contorno (components.md, TabBar). A cor
 *  já diferencia, mas não pode ser a única pista — quem não distingue o azul
 *  do cinza ainda vê a forma mudar. */
function icone(base: string) {
  function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    const nome = (focused ? base : `${base}-outline`) as NomeIcone;
    return <Ionicons name={nome} color={color} size={size} />;
  }
  return TabIcon;
}

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
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icone('home') }} />
      <Tabs.Screen
        name="lancamentos"
        options={{ title: 'Lançamentos', tabBarIcon: icone('receipt') }}
      />
      <Tabs.Screen name="cartoes" options={{ title: 'Cartões', tabBarIcon: icone('card') }} />
      <Tabs.Screen
        name="relatorios"
        options={{ title: 'Relatórios', tabBarIcon: icone('pie-chart') }}
      />
      <Tabs.Screen
        name="orcamento"
        options={{ title: 'Orçamento', tabBarIcon: icone('speedometer') }}
      />
      {/* Vitrine dos componentes, para desenvolvimento. No APK a aba some
          (href: null); no Metro continua acessível. */}
      <Tabs.Screen
        name="design"
        options={{
          title: 'Design',
          tabBarIcon: icone('color-palette'),
          href: __DEV__ ? undefined : null,
        }}
      />
    </Tabs>
  );
}
