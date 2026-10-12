/** S16 — Orçamento: limite de gasto por categoria, mês a mês.
 *
 *  Em cima, as categorias COM limite, com a barra (ok / atenção / estourado)
 *  e o texto do valor — a cor da barra nunca carrega o estado sozinha
 *  (components.md, ProgressBar). Embaixo, as categorias sem limite, com o
 *  gasto do mês, para a pessoa ver onde valeria pôr um.
 *
 *  Estados: carregando, sem categoria, nenhum limite, dentro, estourado.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { IconeCategoria } from '@/components/ui/icone-categoria';
import {
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Row,
  SectionHeader,
  Txt,
} from '@/components/ui/primitives';
import { MonthSwitcher, mesCurto } from '@/components/ui/widgets';
import { orcamento, type LimiteDoMes } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { monthStart, today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';
import { estadoDoLimite, fracaoGasta, percentual } from '@/lib/orcamento';

export default function Orcamento() {
  const t = useTheme();
  const router = useRouter();
  const [mes, setMes] = useState(monthStart(today()));
  const dados = useAsync(() => orcamento.doMes(mes), ['orcamento', mes]);

  const abrir = (categoryId: string) =>
    router.push({ pathname: '/limite', params: { categoryId, mes } });

  if (dados.error) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível carregar o orçamento
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {dados.error.message}
        </Txt>
        <Button label="Tentar de novo" onPress={dados.reload} style={{ marginTop: space[4] }} />
      </View>
    );
  }

  const lista = dados.data ?? [];
  const comLimite = lista.filter((l) => l.limiteCents !== null);
  // Sem limite: quem mais gastou primeiro — é onde um limite faria diferença.
  const semLimite = lista
    .filter((l) => l.limiteCents === null)
    .sort((a, b) => b.gastoCents - a.gastoCents);
  const totalLimite = comLimite.reduce((s, l) => s + (l.limiteCents ?? 0), 0);
  const totalGasto = comLimite.reduce((s, l) => s + l.gastoCents, 0);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <MonthSwitcher mes={mes} onChange={setMes} />

      {!dados.loading && lista.length === 0 ? (
        <EmptyState
          titulo="Nenhuma categoria de despesa"
          texto="O limite de gasto é por categoria. Crie uma para começar."
          acao={{ label: 'Categorias', onPress: () => router.push('/categorias') }}
        />
      ) : null}

      {comLimite.length > 0 ? (
        <Card>
          <Txt variant="sm" color="textMuted">
            {`Gasto nas categorias com limite em ${mesCurto(mes)}`}
          </Txt>
          <Txt variant="lg" style={{ marginTop: space[1], marginBottom: space[2] }}>
            {`${formatCents(totalGasto)} de ${formatCents(totalLimite)}`}
          </Txt>
          <ProgressBar
            fracao={fracaoGasta(totalGasto, totalLimite)}
            rotulo={`${percentual(totalGasto, totalLimite)}% do total`}
          />
        </Card>
      ) : !dados.loading && lista.length > 0 ? (
        <EmptyState
          titulo="Nenhum limite ainda"
          texto="Escolha uma categoria abaixo e defina quanto quer gastar nela por mês."
        />
      ) : null}

      {comLimite.length > 0 ? <SectionHeader>Com limite</SectionHeader> : null}
      {comLimite.map((l) => (
        <LinhaComLimite key={l.categoria.id} item={l} onPress={() => abrir(l.categoria.id)} />
      ))}

      {semLimite.length > 0 ? <SectionHeader>Sem limite</SectionHeader> : null}
      {semLimite.map((l) => (
        <Row
          key={l.categoria.id}
          onPress={() => abrir(l.categoria.id)}
          accessibilityLabel={`${l.categoria.nome}, sem limite, ${formatCents(l.gastoCents)} gastos. Definir limite`}>
          <IconeCategoria icone={l.categoria.icone} cor={l.categoria.cor} />
          <View style={{ flex: 1 }}>
            <Txt variant="base" numberOfLines={1}>
              {l.categoria.nome}
            </Txt>
            <Txt variant="xs" color="textMuted">
              {l.gastoCents > 0 ? `${formatCents(l.gastoCents)} gastos` : 'nada gasto'}
            </Txt>
          </View>
          <Txt variant="sm" color="accent">
            Definir limite
          </Txt>
        </Row>
      ))}
    </ScrollView>
  );
}

function LinhaComLimite({ item, onPress }: { item: LimiteDoMes; onPress: () => void }) {
  const limite = item.limiteCents!;
  const estado = estadoDoLimite(item.gastoCents, limite);
  const pct = percentual(item.gastoCents, limite);
  const resto = limite - item.gastoCents;

  // O estado em TEXTO, sempre: a cor da barra é redundante, nunca a única pista.
  const situacao =
    estado === 'estourado'
      ? `Passou ${formatCents(-resto)}`
      : estado === 'atencao'
        ? resto === 0
          ? 'Limite atingido'
          : `Atenção: restam ${formatCents(resto)}`
        : `Restam ${formatCents(resto)}`;

  return (
    <Row
      onPress={onPress}
      accessibilityLabel={`${item.categoria.nome}: ${formatCents(item.gastoCents)} de ${formatCents(limite)}, ${pct} por cento. ${situacao}`}
      style={styles.linhaLimite}>
      <IconeCategoria icone={item.categoria.icone} cor={item.categoria.cor} />
      <View style={{ flex: 1, gap: space[1] }}>
        <View style={styles.topo}>
          <Txt variant="base" numberOfLines={1} style={{ flex: 1 }}>
            {item.categoria.nome}
          </Txt>
          <Txt variant="sm" color={estado === 'estourado' ? 'danger' : 'textMuted'}>
            {situacao}
          </Txt>
        </View>
        <ProgressBar
          fracao={fracaoGasta(item.gastoCents, limite)}
          rotulo={
            `${formatCents(item.gastoCents)} de ${formatCents(limite)} (${pct}%)` +
            (item.origem === 'mes' ? ' · só este mês' : '')
          }
        />
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], gap: space[2], paddingBottom: space[8] },
  linhaLimite: { alignItems: 'flex-start', paddingVertical: space[2] },
  topo: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
