/** Lançar pelo WhatsApp: ligar o número da pessoa à conta dela.
 *
 *  Fluxo: escolher a conta em que os lançamentos do WhatsApp vão entrar →
 *  gerar um código (6 dígitos, 10 minutos, uso único) → mandar
 *  "vincular 123456" ao bot. O botão "Abrir no WhatsApp" já abre a conversa
 *  com o texto pronto.
 *
 *  Online por natureza: o vínculo mora no servidor (supabase/whatsapp.sql).
 *  O número do bot vem de EXPO_PUBLIC_WHATSAPP_NUMERO (não é segredo).
 */

import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, SectionHeader, Txt } from '@/components/ui/primitives';
import { OptionList } from '@/components/ui/widgets';
import { listAccounts } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { useSessao } from '@/sync/sessao';
import { mensagemDeAuth, supabase } from '@/sync/supabase';

const NUMERO_BOT = (process.env.EXPO_PUBLIC_WHATSAPP_NUMERO ?? '').replace(/\D/g, '');

/** 5511999990001 -> +55 11 99999-0001 (o suficiente para reconhecer). */
function telefoneLegivel(d: string): string {
  const m = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : `+${d}`;
}

type Vinculo = { telefone: string; conta_id: string };

export default function WhatsApp() {
  const t = useTheme();
  const { sessao } = useSessao();
  const contas = useAsync(() => listAccounts(), ['contas']);
  const vinculo = useAsync(async (): Promise<Vinculo | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from('whatsapp_vinculos').select('telefone, conta_id').maybeSingle();
    if (error) throw new Error(mensagemDeAuth(error));
    return data as Vinculo | null;
  }, ['whatsapp-vinculo', sessao?.user.id ?? null]);

  const [contaId, setContaId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!supabase) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="sm" color="textMuted">
          Lançar pelo WhatsApp precisa do backup ligado (Supabase configurado).
        </Txt>
      </View>
    );
  }
  const sb = supabase;

  const lista = (contas.data ?? []).filter((c) => !c.arquivada);
  const contaEfetiva = contaId ?? vinculo.data?.conta_id ?? lista[0]?.id ?? null;
  const nomeDaConta = (id: string | null) => lista.find((c) => c.id === id)?.nome ?? '—';

  async function gerar() {
    if (!contaEfetiva) return;
    setOcupado(true);
    setErro(null);
    try {
      const { data, error } = await sb.rpc('whatsapp_gerar_codigo', { p_conta_id: contaEfetiva });
      if (error) throw error;
      setCodigo(String(data));
    } catch (e) {
      setErro(mensagemDeAuth(e));
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    if (!sessao) return;
    setOcupado(true);
    setErro(null);
    try {
      const { error } = await sb.from('whatsapp_vinculos').delete().eq('user_id', sessao.user.id);
      if (error) throw error;
      setCodigo(null);
      vinculo.reload();
    } catch (e) {
      setErro(mensagemDeAuth(e));
    } finally {
      setOcupado(false);
    }
  }

  const abrirWhatsApp = () =>
    Linking.openURL(`https://wa.me/${NUMERO_BOT}?text=${encodeURIComponent(`vincular ${codigo}`)}`);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <Txt variant="sm" color="textMuted">
        {'Mande "mercado 42,90" para o bot e o lançamento aparece aqui. Também: "uber 18 ontem", "recebi salário 5000", "desfazer".'}
      </Txt>

      {vinculo.error ? (
        <Txt variant="sm" color="danger">
          {`Não foi possível ver o status: ${vinculo.error.message}`}
        </Txt>
      ) : vinculo.data ? (
        <Card>
          <Txt variant="sm" color="textMuted">
            Conectado
          </Txt>
          <Txt variant="lg">{telefoneLegivel(vinculo.data.telefone)}</Txt>
          <Txt variant="sm" color="textMuted" style={{ marginTop: space[1] }}>
            {`Lançamentos entram na conta ${nomeDaConta(vinculo.data.conta_id)}.`}
          </Txt>
        </Card>
      ) : !vinculo.loading ? (
        <Txt variant="base">Nenhum número conectado.</Txt>
      ) : null}

      {lista.length > 1 ? (
        <>
          <SectionHeader>Conta dos lançamentos do WhatsApp</SectionHeader>
          <OptionList
            itens={lista}
            selecionadoId={contaEfetiva}
            rotulo={(c) => c.nome}
            onSelect={(c) => setContaId(c.id)}
          />
        </>
      ) : null}

      {codigo ? (
        <Card style={{ alignItems: 'center' }}>
          <Txt variant="sm" color="textMuted">
            Mande para o bot, em até 10 minutos:
          </Txt>
          <Txt variant="display" style={{ letterSpacing: 4, marginVertical: space[2] }}>
            {codigo}
          </Txt>
          <Txt variant="sm">{`vincular ${codigo}`}</Txt>
          {NUMERO_BOT ? (
            <Button label="Abrir no WhatsApp" onPress={() => void abrirWhatsApp()} style={{ marginTop: space[3] }} />
          ) : null}
          <Button
            label="Já mandei"
            variant="ghost"
            onPress={() => {
              setCodigo(null);
              vinculo.reload();
            }}
            style={{ marginTop: space[2] }}
          />
        </Card>
      ) : (
        <Button
          label={vinculo.data ? 'Reconectar (trocar número ou conta)' : 'Gerar código de conexão'}
          onPress={() => void gerar()}
          loading={ocupado}
          disabled={ocupado || !contaEfetiva}
        />
      )}

      {vinculo.data ? (
        <Button label="Desconectar este número" variant="danger" onPress={() => void desconectar()} disabled={ocupado} />
      ) : null}

      {erro ? (
        <Txt variant="sm" color="danger">
          {erro}
        </Txt>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], gap: space[3], paddingBottom: space[8] },
});
