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

import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '../../drizzle/migrations';
import { db } from '@/db/client';
import { ensureSeed, estenderRecorrencias } from '@/data/ledger';
import { Entrar } from '@/components/entrar';
import { Button, Txt } from '@/components/ui/primitives';
import { space, useTheme } from '@/design/theme';
import { sync, useAutoSync } from '@/sync';
import { ErroDeSync } from '@/sync/engine';
import { useSessao } from '@/sync/sessao';
import { mensagemDeAuth, supabase } from '@/sync/supabase';

/** Antes da primeira tela: categorias e conta padrão (só na conta nova) e as
 *  recorrências renovadas até 12 meses à frente. As duas são idempotentes. */
async function prepararDados() {
  await ensureSeed();
  await estenderRecorrencias();
}

type Fase =
  | { tipo: 'carregando'; texto?: string }
  | { tipo: 'entrar' }
  | { tipo: 'pronto' }
  | { tipo: 'erro'; erro: unknown };

/** Decide o que mostrar depois que o banco migrou.
 *
 *  Local-first: se o aparelho já tem dono, o app abre na hora, com ou sem
 *  sessão e com ou sem rede. A sessão só é exigida no PRIMEIRO uso, para
 *  saber de quem são os dados. Se o portão dependesse da sessão, abrir o app
 *  offline com o token vencido cairia no login — e o app pararia de
 *  funcionar sem internet, que é o que local-first promete evitar.
 */
function usePortao(migrado: boolean): [Fase, () => void] {
  const { carregando, sessao } = useSessao();
  const [fase, setFase] = useState<Fase>({ tipo: 'carregando' });
  const [tentativa, setTentativa] = useState(0);
  const uid = sessao?.user.id ?? null;

  useEffect(() => {
    if (!migrado) return;
    let vivo = true;
    const ir = (f: Fase) => vivo && setFase(f);

    (async (): Promise<Fase> => {
      // Sem Supabase configurado: só local, como antes do M1.
      if (!sync || sync.estado().dono !== null) {
        await prepararDados();
        return { tipo: 'pronto' };
      }
      if (carregando) return { tipo: 'carregando' };
      if (!uid) return { tipo: 'entrar' };

      ir({ tipo: 'carregando', texto: 'Preparando seus dados…' });
      await sync.prepararAparelho(uid);
      // Conta nova: semeia aqui, DEPOIS de saber que a nuvem está vazia. Antes
      // do preparo, semear criaria categorias que colidem com as da nuvem.
      await prepararDados();
      return { tipo: 'pronto' };
    })()
      .then(ir)
      .catch((erro) => ir({ tipo: 'erro', erro }));

    return () => {
      vivo = false;
    };
  }, [migrado, carregando, uid, tentativa]);

  return [fase, () => setTentativa((n) => n + 1)];
}

export default function RootLayout() {
  const t = useTheme();
  const { success, error } = useMigrations(db, migrations);
  const [fase, tentarDeNovo] = usePortao(success);
  useAutoSync(fase.tipo === 'pronto');

  const centro = (filhos: ReactNode) => (
    <View style={{ flex: 1, backgroundColor: t.bg, padding: space[6], justifyContent: 'center' }}>
      {filhos}
    </View>
  );

  // Falha de migração é terminal e precisa ser VISÍVEL. Um app de dinheiro que
  // abre com o banco meio migrado é pior que um app que não abre.
  if (error) {
    return centro(
      <>
        <Txt variant="lg" color="danger">
          Não foi possível preparar o banco de dados
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {error.message}
        </Txt>
        <Txt variant="xs" color="textMuted" style={{ marginTop: space[4] }}>
          Nenhum dado foi alterado. Limpar os dados do app recria o banco.
        </Txt>
      </>,
    );
  }

  if (fase.tipo === 'erro') return centro(<ErroDoPortao erro={fase.erro} tentarDeNovo={tentarDeNovo} />);

  if (fase.tipo === 'entrar') return <Entrar temDadosLocais={sync?.temDadosLocais() ?? false} />;

  if (!success || fase.tipo === 'carregando') {
    return centro(
      <View style={{ alignItems: 'center', gap: space[3] }}>
        <ActivityIndicator color={t.accent} />
        {fase.tipo === 'carregando' && fase.texto ? (
          <Txt variant="sm" color="textMuted">
            {fase.texto}
          </Txt>
        ) : null}
      </View>,
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
      {/* Título real (tipo do lançamento) definido pela própria tela. */}
      <Stack.Screen name="lancamento/[id]" options={{ title: 'Lançamento' }} />
      <Stack.Screen name="contas" options={{ title: 'Contas' }} />
      <Stack.Screen name="conta-nova" options={{ title: 'Nova conta', presentation: 'modal' }} />
      <Stack.Screen name="categorias" options={{ title: 'Categorias' }} />
      <Stack.Screen
        name="categoria-nova"
        options={{ title: 'Nova categoria', presentation: 'modal' }}
      />
      <Stack.Screen name="backup" options={{ title: 'Backup e conta' }} />
      <Stack.Screen name="limite" options={{ title: 'Limite', presentation: 'modal' }} />
      <Stack.Screen name="whatsapp" options={{ title: 'Lançar pelo WhatsApp' }} />
    </Stack>
  );
}

/** O primeiro login não deu certo. Três casos, três saídas. */
function ErroDoPortao({ erro, tentarDeNovo }: { erro: unknown; tentarDeNovo: () => void }) {
  const sair = () => {
    void supabase?.auth.signOut();
  };

  if (erro instanceof ErroDeSync && erro.codigo === 'conflito_primeiro_login') {
    const usarNuvem = () =>
      Alert.alert(
        'Apagar os dados deste aparelho?',
        'Os lançamentos que estão só neste aparelho serão apagados, e os da sua conta serão baixados. Não dá para desfazer.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Apagar e baixar',
            style: 'destructive',
            onPress: () => {
              sync?.apagarDadosLocais();
              tentarDeNovo();
            },
          },
        ],
      );
    return (
      <>
        <Txt variant="lg">Já existem dados nos dois lugares</Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2], marginBottom: space[4] }}>
          Este aparelho tem lançamentos feitos sem login, e a sua conta também tem dados. Juntar os
          dois misturaria históricos e duplicaria categorias, então o app não faz isso sozinho.
        </Txt>
        <Button label="Ficar com os dados da conta" onPress={usarNuvem} />
        <View style={{ height: space[3] }} />
        <Button label="Sair e entrar com outra conta" variant="secondary" onPress={sair} />
      </>
    );
  }

  return (
    <>
      <Txt variant="lg" color="danger">
        Não foi possível preparar seus dados
      </Txt>
      <Txt variant="sm" color="textMuted" style={{ marginTop: space[2], marginBottom: space[4] }}>
        {mensagemDeAuth(erro)}
      </Txt>
      <Button label="Tentar de novo" onPress={tentarDeNovo} />
      <View style={{ height: space[3] }} />
      <Button label="Sair" variant="secondary" onPress={sair} />
    </>
  );
}
