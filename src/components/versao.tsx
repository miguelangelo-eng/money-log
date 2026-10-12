/** Versão do app e "Verificar atualização" (EAS Update).
 *
 *  Sem o botão, uma atualização publicada é baixada numa abertura do app e
 *  só aplicada na seguinte. Aqui ela é baixada e aplicada na hora (o app
 *  recarrega). Os dados não são tocados: ficam no SQLite, fora do bundle.
 *
 *  No Expo Go e no Metro as atualizações pelo ar não existem
 *  (`Updates.isEnabled` é falso): mostra só a versão.
 */

import { useState } from 'react';
import { View } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

import { Button, Card, Txt } from '@/components/ui/primitives';
import { space } from '@/design/theme';

function quando(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SecaoVersao() {
  const [estado, setEstado] = useState<'parado' | 'buscando' | 'em_dia' | 'erro'>('parado');
  const [erro, setErro] = useState<string | null>(null);

  const versao = Constants.expoConfig?.version ?? '?';
  const deQuando = Updates.isEnabled && !Updates.isEmbeddedLaunch ? quando(Updates.createdAt) : null;

  async function verificar() {
    setEstado('buscando');
    setErro(null);
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) return setEstado('em_dia');
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync(); // reinicia o app já na versão nova
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEstado('erro');
    }
  }

  return (
    <Card>
      <Txt variant="sm" color="textMuted">
        Versão do app
      </Txt>
      <Txt variant="base" style={{ fontWeight: '600' }}>
        {deQuando ? `${versao} · atualizado em ${deQuando}` : `${versao} · versão instalada`}
      </Txt>

      {Updates.isEnabled ? (
        <View style={{ marginTop: space[3] }}>
          <Button
            label={estado === 'buscando' ? 'Verificando…' : 'Verificar atualização'}
            variant="secondary"
            size="sm"
            onPress={() => void verificar()}
            loading={estado === 'buscando'}
            disabled={estado === 'buscando'}
          />
          {estado === 'em_dia' ? (
            <Txt variant="xs" color="textMuted" style={{ marginTop: space[1] }}>
              Você já está na versão mais nova.
            </Txt>
          ) : null}
          {estado === 'erro' ? (
            <Txt variant="xs" color="danger" style={{ marginTop: space[1] }}>
              {`Não foi possível verificar: ${erro}`}
            </Txt>
          ) : null}
        </View>
      ) : (
        <Txt variant="xs" color="textMuted" style={{ marginTop: space[1] }}>
          Atualização pelo ar só no app instalado (não no Expo Go).
        </Txt>
      )}
    </Card>
  );
}
