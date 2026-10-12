/** Backup e conta: estado do sync, sincronizar agora e sair.
 *
 *  Sair APAGA os dados do aparelho. É o que garante "um banco local, uma
 *  pessoa": a próxima conta a entrar começa de um aparelho vazio. O que já
 *  subiu continua na conta; o que está na fila e não subiu é perdido, e por
 *  isso o aviso diz quanto é.
 */

import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Entrar } from '@/components/entrar';
import { SecaoVersao } from '@/components/versao';
import { Button, Card, SectionHeader, Txt } from '@/components/ui/primitives';
import { space, useTheme } from '@/design/theme';
import { sincronizarAgora, sync, useStatusSync } from '@/sync';
import { useSessao } from '@/sync/sessao';
import { supabase } from '@/sync/supabase';

function quando(iso: string | null): string {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Backup() {
  const t = useTheme();
  const status = useStatusSync();
  const { carregando, sessao } = useSessao();

  if (!sync || !supabase) {
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
        <Txt variant="lg">Backup desligado</Txt>
        <Txt variant="sm" color="textMuted">
          Os dados existem só neste aparelho. Se o celular for perdido ou o app desinstalado, eles se
          perdem. O backup liga quando o app é configurado com um projeto do Supabase (ver SETUP.md).
        </Txt>
        <SecaoVersao />
      </ScrollView>
    );
  }

  // O aparelho tem dono, mas a sessão expirou: entrar de novo só religa o
  // sync. Se outra conta entrar aqui, o motor recusa sincronizar.
  if (!carregando && !sessao) return <Entrar temDadosLocais={false} />;

  const s = sync;
  const est = s.estado();
  const pendentes = s.pendentes();

  function sair() {
    const perde =
      pendentes > 0
        ? `\n\n${pendentes} alteração(ões) ainda não foram enviadas e serão PERDIDAS. Sincronize antes, se puder.`
        : '';
    Alert.alert(
      'Sair da conta?',
      `Os dados serão apagados deste aparelho. O que já foi enviado continua na sua conta e volta quando você entrar de novo.${perde}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair e apagar',
          style: 'destructive',
          // Apaga ANTES de sair: o portão decide pela existência de dono, e
          // com o dono ainda gravado ele manteria o app aberto.
          onPress: () => {
            s.apagarDadosLocais();
            void supabase?.auth.signOut();
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <Card>
        <Txt variant="sm" color="textMuted">
          Conta
        </Txt>
        <Txt variant="base" style={{ fontWeight: '600' }}>
          {sessao?.user.email ?? '…'}
        </Txt>
      </Card>

      <SectionHeader>Backup</SectionHeader>
      <Card>
        <View style={styles.linha}>
          <Txt variant="sm">Último envio</Txt>
          <Txt variant="sm" color="textMuted">
            {quando(est.ultimoPushEm)}
          </Txt>
        </View>
        <View style={styles.linha}>
          <Txt variant="sm">Último recebimento</Txt>
          <Txt variant="sm" color="textMuted">
            {quando(est.ultimoPullEm)}
          </Txt>
        </View>
        <View style={styles.linha}>
          <Txt variant="sm">Aguardando envio</Txt>
          <Txt variant="sm" color={pendentes > 0 ? 'text' : 'textMuted'}>
            {pendentes === 0 ? 'nada' : String(pendentes)}
          </Txt>
        </View>
      </Card>

      {status.erro ? (
        <Txt variant="sm" color="danger">
          {`Última tentativa falhou: ${status.erro}`}
        </Txt>
      ) : null}

      <Button
        label={status.sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
        onPress={() => void sincronizarAgora()}
        loading={status.sincronizando}
        disabled={status.sincronizando}
      />

      <View style={{ height: space[6] }} />
      <SecaoVersao />

      <View style={{ height: space[6] }} />
      <Button label="Sair da conta" variant="secondary" onPress={sair} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], gap: space[3], paddingBottom: space[8] },
  linha: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space[1] },
});
