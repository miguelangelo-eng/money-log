/** S15 — Relatórios do mês.
 *
 *  Duas leituras, conforme replica/design/components.md:
 *   - barras receita × despesa, par polar azul↔vermelho (medido: ΔE 21,6 sob
 *     protanopia, contra 7,2 do verde↔vermelho);
 *   - lista ranqueada de categorias, hue única, porque o comprimento da barra
 *     já carrega a magnitude e gastar o canal de cor para repetir isso é
 *     desperdício. A identidade vem do nome.
 *
 *  A rosca do design NÃO está aqui: ela exige Skia, que ainda não foi
 *  instalado. A lista ranqueada é a metade que responde "qual categoria me
 *  sangrou" e é também a visão de tabela exigida pela acessibilidade, então o
 *  que falta é a leitura de relance, não a informação. Registrado como
 *  `partial` em features.csv.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, SectionHeader, Txt } from '@/components/ui/primitives';
import { MonthSwitcher, nomeDoMes } from '@/components/ui/widgets';
import { expensesByCategory, monthTotals } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { polar, radius, space, useMode, useTheme } from '@/design/theme';
import { monthStart, today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';

export default function Relatorios() {
  const t = useTheme();
  const mode = useMode();
  const [mes, setMes] = useState(monthStart(today()));

  const totais = useAsync(() => monthTotals(mes), ['tot', mes]);
  const porCategoria = useAsync(() => expensesByCategory(mes), ['cat', mes]);

  const erro = totais.error ?? porCategoria.error;
  if (erro) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível montar o relatório
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {erro.message}
        </Txt>
        <Button
          label="Tentar de novo"
          onPress={() => {
            totais.reload();
            porCategoria.reload();
          }}
          style={{ marginTop: space[4] }}
        />
      </View>
    );
  }

  const receita = totais.data?.receitaCents ?? 0;
  const despesa = totais.data?.despesaCents ?? 0;
  const maiorTotal = Math.max(receita, despesa, 1);
  const fatias = porCategoria.data ?? [];
  const maiorFatia = Math.max(...fatias.map((f) => f.totalCents), 1);
  const cores = polar[mode];

  const vazio = !totais.loading && receita === 0 && despesa === 0;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <MonthSwitcher mes={mes} onChange={setMes} />

      {vazio ? (
        <EmptyState
          titulo={`Sem dados em ${nomeDoMes(mes)}`}
          texto="O relatório aparece assim que houver lançamento no mês."
        />
      ) : (
        <>
          <Card>
            <Txt variant="sm" color="textMuted">
              Entrou e saiu
            </Txt>
            {/* Legenda sempre presente com 2 séries, e cada barra tem rótulo
                direto: identidade nunca depende só da cor. */}
            <Barra
              rotulo="Entrou"
              valor={receita}
              fracao={receita / maiorTotal}
              cor={cores.receita}
              trilha={t.surfaceSunken}
            />
            <Barra
              rotulo="Saiu"
              valor={despesa}
              fracao={despesa / maiorTotal}
              cor={cores.despesa}
              trilha={t.surfaceSunken}
            />
            <Txt variant="sm" style={{ marginTop: space[3], fontWeight: '600' }}>
              {`Resultado: ${formatCents(receita - despesa)}`}
            </Txt>
          </Card>

          <SectionHeader>Para onde foi o dinheiro</SectionHeader>
          {porCategoria.loading ? (
            <Txt variant="sm" color="textMuted">
              {'Carregando…'}
            </Txt>
          ) : fatias.length === 0 ? (
            <Txt variant="sm" color="textMuted">
              Nenhuma despesa neste mês.
            </Txt>
          ) : (
            fatias.map((f) => (
              <Barra
                key={f.categoryId ?? 'sem-categoria'}
                rotulo={f.nome}
                valor={f.totalCents}
                fracao={f.totalCents / maiorFatia}
                // Hue única de propósito: o comprimento já diz a magnitude.
                cor={t.accent}
                trilha={t.surfaceSunken}
              />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function Barra({
  rotulo,
  valor,
  fracao,
  cor,
  trilha,
}: {
  rotulo: string;
  valor: number;
  fracao: number;
  cor: string;
  trilha: string;
}) {
  const largura = `${Math.max(2, Math.min(100, fracao * 100))}%` as const;
  return (
    <View
      style={{ marginTop: space[3] }}
      accessibilityLabel={`${rotulo}: ${formatCents(valor)}`}>
      <View style={styles.rotuloLinha}>
        <Txt variant="sm" numberOfLines={1} style={styles.rotulo}>
          {rotulo}
        </Txt>
        <Txt variant="sm" style={{ fontWeight: '600' }}>
          {formatCents(valor)}
        </Txt>
      </View>
      <View style={[styles.trilha, { backgroundColor: trilha }]}>
        {/* Extremidade arredondada ancorada na linha de base, 2px de gap na
            cor da superfície: especificação de marca do dataviz. */}
        <View style={[styles.preenchimento, { width: largura, backgroundColor: cor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
  rotuloLinha: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  rotulo: { flex: 1 },
  trilha: { height: 10, borderRadius: radius.pill, marginTop: space[1], overflow: 'hidden' },
  preenchimento: { height: '100%', borderRadius: radius.pill },
});
