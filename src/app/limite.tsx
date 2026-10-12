/** Definir, alterar ou remover o limite de uma categoria (formulário do S16).
 *
 *  "Vale para": todo mês (recorrente) ou só o mês que estava aberto. O padrão
 *  é o que já vale: se a categoria tem limite só deste mês, abre nele.
 */

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { IconeCategoria } from '@/components/ui/icone-categoria';
import { MoneyInput } from '@/components/ui/money-input';
import { Button, SectionHeader, Txt } from '@/components/ui/primitives';
import { mesCurto } from '@/components/ui/widgets';
import { orcamento } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { monthStart, today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';

export default function Limite() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId: string; mes?: string }>();
  const mes = monthStart(params.mes ?? today());

  const dados = useAsync(() => orcamento.doMes(mes), ['orcamento', mes]);
  const item = dados.data?.find((l) => l.categoria.id === params.categoryId) ?? null;

  const [pronto, setPronto] = useState(false);
  const [valor, setValor] = useState(0);
  const [soEsteMes, setSoEsteMes] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!item || pronto) return;
    setValor(item.limiteCents ?? 0);
    setSoEsteMes(item.origem === 'mes');
    setPronto(true);
  }, [item, pronto]);

  function sair() {
    if (router.canGoBack()) router.back();
    else router.replace('/orcamento');
  }

  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      sair();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  if (dados.error || (!dados.loading && !item)) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Categoria não encontrada
        </Txt>
        <Button label="Voltar" onPress={sair} style={{ marginTop: space[4] }} />
      </View>
    );
  }

  if (!item || !pronto) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="sm" color="textMuted">
          {'Carregando…'}
        </Txt>
      </View>
    );
  }

  const escopoMes = soEsteMes ? mes : null;
  // Existe limite no escopo escolhido? Só então "remover" faz sentido.
  const temNoEscopo = soEsteMes ? item.origem === 'mes' : item.origem !== null;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.tela}
      keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: item.limiteCents === null ? 'Definir limite' : 'Limite' }} />

      <View style={styles.cabecalho}>
        <IconeCategoria icone={item.categoria.icone} cor={item.categoria.cor} tamanho={22} />
        <View style={{ flex: 1 }}>
          <Txt variant="lg">{item.categoria.nome}</Txt>
          <Txt variant="sm" color="textMuted">
            {`${formatCents(item.gastoCents)} gastos em ${mesCurto(mes)}`}
          </Txt>
        </View>
      </View>

      <MoneyInput valueCents={valor} onChange={setValor} kind="neutro" autoFocus={item.limiteCents === null} />

      <SectionHeader>Vale para</SectionHeader>
      <View style={styles.linha}>
        <Button
          label="Todo mês"
          size="sm"
          variant={!soEsteMes ? 'primary' : 'secondary'}
          onPress={() => setSoEsteMes(false)}
          style={styles.flex}
        />
        <Button
          label={`Só ${mesCurto(mes)}`}
          size="sm"
          variant={soEsteMes ? 'primary' : 'secondary'}
          onPress={() => setSoEsteMes(true)}
          style={styles.flex}
        />
      </View>
      <Txt variant="xs" color="textMuted" style={{ marginTop: space[2] }}>
        {soEsteMes
          ? `Vale só em ${mesCurto(mes)} e, nele, substitui o limite de todo mês.`
          : 'Vale a partir de agora em todos os meses que não tiverem um limite próprio.'}
      </Txt>

      {valor > 0 && valor < item.gastoCents ? (
        <Txt variant="sm" color="danger" style={{ marginTop: space[3] }}>
          {`Já foram gastos ${formatCents(item.gastoCents)} em ${mesCurto(mes)}: este mês já começa estourado.`}
        </Txt>
      ) : null}

      {erro ? (
        <Txt variant="sm" color="danger" style={{ marginTop: space[2] }}>
          {erro}
        </Txt>
      ) : null}

      <Button
        label="Salvar limite"
        size="lg"
        onPress={() =>
          void executar(() =>
            orcamento.definir({ categoryId: item.categoria.id, limiteCents: valor, mes: escopoMes }),
          )
        }
        disabled={ocupado || valor <= 0}
        loading={ocupado}
        style={{ marginTop: space[4] }}
      />
      {temNoEscopo ? (
        <Button
          label={soEsteMes ? `Remover o limite de ${mesCurto(mes)}` : 'Remover o limite de todo mês'}
          variant="danger"
          onPress={() =>
            void executar(() => orcamento.remover({ categoryId: item.categoria.id, mes: escopoMes }))
          }
          disabled={ocupado}
          style={{ marginTop: space[3] }}
        />
      ) : null}
      <Button label="Cancelar" variant="ghost" onPress={sair} style={{ marginTop: space[2] }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  linha: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
});
