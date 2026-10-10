/** S05 + S06 — escolher o tipo e preencher o lançamento.
 *
 *  Meta do fluxo F02: 5 toques. Valor, categoria, salvar — conta e data vêm
 *  com padrão (primeira conta, hoje). Cada toque a mais aqui é um toque a mais
 *  dez vezes por dia.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, SectionHeader, Txt } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { OptionList } from '@/components/ui/widgets';
import { addExpense, addIncome, listAccounts, listCategories } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { today } from '@/lib/civil-date';

type Kind = 'despesa' | 'receita';

export default function Novo() {
  const t = useTheme();
  const router = useRouter();

  const [kind, setKind] = useState<Kind>('despesa');
  const [valor, setValor] = useState(0);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contas = useAsync(() => listAccounts(), ['contas']);
  const categorias = useAsync(() => listCategories(kind), ['cats', kind]);

  // Padrão: primeira conta. O usuário só mexe se tiver mais de uma.
  const contaEfetiva = contaId ?? contas.data?.[0]?.id ?? null;

  const podeSalvar = valor > 0 && Boolean(contaEfetiva) && !salvando;

  async function salvar() {
    if (!contaEfetiva) {
      setErro('Cadastre uma conta antes de lançar.');
      return;
    }
    if (valor <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const payload = {
        amountCents: valor,
        competencia: today(),
        categoryId: categoriaId,
        accountId: contaEfetiva,
      };
      if (kind === 'despesa') await addExpense(payload);
      else await addIncome(payload);
      router.back();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setSalvando(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      {/* S05 — tipo. Ícone sem texto num app de dinheiro gera lançamento no
          tipo errado, então os dois são rotulados. */}
      <View style={styles.tipos}>
        <Button
          label="Despesa"
          variant={kind === 'despesa' ? 'primary' : 'secondary'}
          onPress={() => {
            setKind('despesa');
            setCategoriaId(null);
          }}
          style={styles.metade}
        />
        <Button
          label="Receita"
          variant={kind === 'receita' ? 'primary' : 'secondary'}
          onPress={() => {
            setKind('receita');
            setCategoriaId(null);
          }}
          style={styles.metade}
        />
      </View>

      <MoneyInput valueCents={valor} onChange={setValor} kind={kind} autoFocus />

      <SectionHeader>Categoria</SectionHeader>
      {categorias.loading ? (
        <Txt variant="sm" color="textMuted">
          {'Carregando categorias…'}
        </Txt>
      ) : (
        <OptionList
          itens={categorias.data ?? []}
          selecionadoId={categoriaId}
          rotulo={(c) => c.nome}
          cor={(c) => c.cor}
          onSelect={(c) => setCategoriaId(c.id === categoriaId ? null : c.id)}
        />
      )}

      {(contas.data?.length ?? 0) > 1 ? (
        <>
          <SectionHeader>Conta</SectionHeader>
          <OptionList
            itens={contas.data ?? []}
            selecionadoId={contaEfetiva}
            rotulo={(c) => c.nome}
            onSelect={(c) => setContaId(c.id)}
          />
        </>
      ) : null}

      {erro ? (
        <Txt variant="sm" color="danger" style={{ marginTop: space[2] }}>
          {erro}
        </Txt>
      ) : null}

      <Button
        label="Salvar"
        onPress={salvar}
        disabled={!podeSalvar}
        loading={salvando}
        size="lg"
        style={{ marginTop: space[4] }}
      />
      <Button
        label="Cancelar"
        variant="ghost"
        onPress={() => router.back()}
        style={{ marginTop: space[2] }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
  tipos: { flexDirection: 'row', gap: space[3] },
  metade: { flex: 1 },
});
