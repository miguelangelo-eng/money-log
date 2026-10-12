/** S15 — Relatórios do mês.
 *
 *  Duas leituras, conforme replica/design/components.md:
 *   - barras receita × despesa, par polar azul↔vermelho (medido: ΔE 21,6 sob
 *     protanopia, contra 7,2 do verde↔vermelho);
 *   - lista ranqueada de categorias, hue única, porque o comprimento da barra
 *     já carrega a magnitude e gastar o canal de cor para repetir isso é
 *     desperdício. A identidade vem do nome.
 *
 *  - rosca COM DESTAQUE (src/components/ui/rosca.tsx): a leitura de relance
 *    de "como está dividido". Uma fatia por vez na cor da categoria, o resto
 *    em cinza; tocar numa fatia ou numa linha da lista troca a selecionada.
 *    Até 6 fatias (5 + "Outras"); com menos de 3, sem rosca — a lista basta.
 *
 *  A lista ranqueada é a visão de tabela da rosca, e é ela que responde "qual
 *  categoria me sangrou": comparar ângulos parecidos não é tarefa de rosca.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IconeCategoria } from '@/components/ui/icone-categoria';
import { Button, Card, EmptyState, SectionHeader, Txt } from '@/components/ui/primitives';
import { Rosca, type FatiaDaRosca } from '@/components/ui/rosca';
import { MonthSwitcher, nomeDoMes } from '@/components/ui/widgets';
import { expensesByCategory, monthTotals } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { polar, radius, space, useMode, useTheme } from '@/design/theme';
import { monthStart, today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';
import { agruparParaRosca, FATIAS_MIN, ID_OUTRAS } from '@/lib/rosca';

const SEM_CATEGORIA = '__sem_categoria__';

export default function Relatorios() {
  const t = useTheme();
  const mode = useMode();
  const [mes, setMes] = useState(monthStart(today()));
  const [selecionado, setSelecionado] = useState<string | null>(null);

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

  // Rosca: 5 maiores + "Outras". O id de cada fatia é o da categoria.
  const idDe = (f: { categoryId: string | null }) => f.categoryId ?? SEM_CATEGORIA;
  const grupos = agruparParaRosca(fatias.map((f) => ({ ...f, id: idDe(f) })));
  const fatiasDaRosca: FatiaDaRosca[] = grupos.map((g) =>
    'agrupadas' in g
      ? { id: ID_OUTRAS, nome: `Outras (${g.agrupadas})`, cor: null, totalCents: g.totalCents }
      : { id: g.id, nome: g.nome, cor: g.categoryId ? g.cor : null, totalCents: g.totalCents },
  );
  const naRosca = new Set(fatiasDaRosca.map((f) => f.id));
  /** Selecionar uma categoria que caiu em "Outras" destaca "Outras". */
  const fatiaDe = (id: string) => (naRosca.has(id) ? id : ID_OUTRAS);
  const selecionadaEfetiva =
    selecionado && fatiasDaRosca.some((f) => f.id === fatiaDe(selecionado))
      ? fatiaDe(selecionado)
      : (fatiasDaRosca[0]?.id ?? '');

  const vazio = !totais.loading && receita === 0 && despesa === 0;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <MonthSwitcher
        mes={mes}
        onChange={(m) => {
          setMes(m);
          setSelecionado(null);
        }}
      />

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
          {fatiasDaRosca.length >= FATIAS_MIN ? (
            <Rosca
              fatias={fatiasDaRosca}
              selecionadoId={selecionadaEfetiva}
              onSelect={setSelecionado}
            />
          ) : null}
          {porCategoria.loading ? (
            <Txt variant="sm" color="textMuted">
              {'Carregando…'}
            </Txt>
          ) : fatias.length === 0 ? (
            <Txt variant="sm" color="textMuted">
              Nenhuma despesa neste mês.
            </Txt>
          ) : (
            fatias.map((f) => {
              const ativa =
                fatiasDaRosca.length >= FATIAS_MIN && fatiaDe(idDe(f)) === selecionadaEfetiva;
              return (
                <Pressable
                  key={idDe(f)}
                  onPress={() => setSelecionado(idDe(f))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ativa }}
                  style={[
                    styles.itemCategoria,
                    ativa ? { backgroundColor: t.surfaceSunken } : null,
                  ]}>
                  <IconeCategoria icone={f.icone} cor={f.categoryId ? f.cor : null} />
                  <View style={{ flex: 1 }}>
                    <Barra
                      rotulo={f.nome}
                      valor={f.totalCents}
                      fracao={f.totalCents / maiorFatia}
                      // Hue única de propósito: o comprimento já diz a magnitude.
                      cor={t.accent}
                      trilha={t.surfaceSunken}
                      destaque={ativa}
                    />
                  </View>
                </Pressable>
              );
            })
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
  destaque,
}: {
  rotulo: string;
  valor: number;
  fracao: number;
  cor: string;
  trilha: string;
  destaque?: boolean;
}) {
  const largura = `${Math.max(2, Math.min(100, fracao * 100))}%` as const;
  return (
    <View
      style={{ marginTop: space[3] }}
      accessibilityLabel={`${rotulo}: ${formatCents(valor)}`}>
      <View style={styles.rotuloLinha}>
        <Txt
          variant="sm"
          numberOfLines={1}
          style={[styles.rotulo, destaque ? { fontWeight: '700' } : null]}>
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
  itemCategoria: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[2],
    paddingBottom: space[2],
    borderRadius: radius.md,
  },
});
