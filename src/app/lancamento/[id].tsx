/** S07 — Lançamento: ver, editar, excluir.
 *
 *  O que pode mudar depende do tipo, e a regra mora em updateTransaction /
 *  deleteTransaction (src/data/ledger-repo.ts), não aqui — a tela só não
 *  oferece o que o repositório recusaria, e explica por quê:
 *
 *  - despesa/receita em conta: valor, data, categoria, conta, descrição;
 *  - transferência: valor, data, origem, destino, descrição;
 *  - compra no cartão: categoria e descrição. Valor e data definem a fatura;
 *    excluir apaga a compra inteira, todas as parcelas;
 *  - pagamento de fatura: não se edita; excluir desfaz o pagamento.
 *
 *  Toda exclusão pede confirmação dizendo exatamente o que sai.
 */

import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { DateField, dataCurta } from '@/components/ui/date-field';
import { MoneyInput } from '@/components/ui/money-input';
import { Button, Card, EmptyState, Field, SectionHeader, Txt } from '@/components/ui/primitives';
import { OptionList } from '@/components/ui/widgets';
import {
  deleteTransaction,
  getTransaction,
  listAccounts,
  listCategories,
  updateTransaction,
} from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import type { Transaction } from '@/db/schema';
import { formatCents, formatSigned } from '@/lib/money';

const TITULO: Record<Transaction['kind'], string> = {
  despesa: 'Despesa',
  receita: 'Receita',
  transferencia: 'Transferência',
  pagamento_fatura: 'Pagamento de fatura',
};

function textoDeConfirmacao(tx: Transaction): { titulo: string; corpo: string; acao: string } {
  if (tx.kind === 'pagamento_fatura') {
    return {
      titulo: 'Desfazer o pagamento?',
      corpo: `${formatCents(tx.amountCents)} voltam para a conta e a fatura fica em aberto de novo.`,
      acao: 'Desfazer',
    };
  }
  if (tx.creditCardId && tx.parcelaDe && tx.parcelaDe > 1) {
    return {
      titulo: 'Excluir a compra inteira?',
      corpo: `As ${tx.parcelaDe} parcelas saem das faturas. Não dá para excluir só uma parcela.`,
      acao: 'Excluir compra',
    };
  }
  if (tx.creditCardId) {
    return { titulo: 'Excluir esta compra?', corpo: 'Ela sai da fatura do cartão.', acao: 'Excluir' };
  }
  return {
    titulo: 'Excluir este lançamento?',
    corpo: `${formatCents(tx.amountCents)} de ${dataCurta(tx.competencia)}.`,
    acao: 'Excluir',
  };
}

export default function Lancamento() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const lanc = useAsync(() => getTransaction(id), ['tx', id]);
  const tx = lanc.data ?? null;
  const contas = useAsync(() => listAccounts(), ['contas']);
  const categorias = useAsync(
    () =>
      tx && (tx.kind === 'despesa' || tx.kind === 'receita')
        ? listCategories(tx.kind)
        : Promise.resolve([]),
    ['cats', tx?.kind ?? null],
  );

  // Formulário, preenchido uma vez quando o lançamento chega.
  const [pronto, setPronto] = useState(false);
  const [valor, setValor] = useState(0);
  const [data, setData] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!tx || pronto) return;
    setValor(tx.amountCents);
    setData(tx.competencia);
    setDescricao(tx.descricao);
    setCategoriaId(tx.categoryId);
    setContaId(tx.accountId);
    setDestinoId(tx.transferAccountId);
    setPronto(true);
  }, [tx, pronto]);

  function sair() {
    if (router.canGoBack()) router.back();
    else router.replace('/lancamentos');
  }

  async function salvar() {
    if (!tx) return;
    setOcupado(true);
    setErro(null);
    try {
      const noCartao = Boolean(tx.creditCardId);
      await updateTransaction(tx.id, {
        descricao,
        ...(tx.kind !== 'transferencia' ? { categoryId: categoriaId } : {}),
        ...(noCartao ? {} : { amountCents: valor, competencia: data }),
        ...(noCartao || !contaId ? {} : { accountId: contaId }),
        ...(tx.kind === 'transferencia' && destinoId ? { transferAccountId: destinoId } : {}),
      });
      sair();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  function excluir() {
    if (!tx) return;
    const c = textoDeConfirmacao(tx);
    Alert.alert(c.titulo, c.corpo, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: c.acao,
        style: 'destructive',
        onPress: async () => {
          setOcupado(true);
          setErro(null);
          try {
            await deleteTransaction(tx.id);
            sair();
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
            setOcupado(false);
          }
        },
      },
    ]);
  }

  if (lanc.error) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="lg" color="danger">
          Não foi possível carregar o lançamento
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
          {lanc.error.message}
        </Txt>
      </View>
    );
  }

  if (!lanc.loading && !tx) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <EmptyState
          titulo="Lançamento não encontrado"
          texto="Ele pode ter sido excluído."
          acao={{ label: 'Voltar', onPress: sair }}
        />
      </View>
    );
  }

  if (!tx || !pronto) {
    return (
      <View style={[styles.tela, { backgroundColor: t.bg, flex: 1 }]}>
        <Txt variant="sm" color="textMuted">
          {'Carregando…'}
        </Txt>
      </View>
    );
  }

  const noCartao = Boolean(tx.creditCardId) && tx.kind !== 'pagamento_fatura';
  const pagamento = tx.kind === 'pagamento_fatura';
  const transferencia = tx.kind === 'transferencia';
  const listaContas = contas.data ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.tela}
      keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: TITULO[tx.kind] }} />

      {pagamento || noCartao ? (
        // Valor e data travados: mostrados, não editáveis, com o motivo.
        <Card>
          <Txt variant="money" color={pagamento ? 'textMuted' : 'danger'}>
            {formatSigned(tx.amountCents, 'despesa')}
          </Txt>
          <Txt variant="sm" color="textMuted" style={{ marginTop: space[1] }}>
            {dataCurta(tx.competencia)}
            {tx.parcelaN && tx.parcelaDe ? ` · parcela ${tx.parcelaN} de ${tx.parcelaDe}` : ''}
          </Txt>
          <Txt variant="xs" color="textMuted" style={{ marginTop: space[2] }}>
            {pagamento
              ? 'Pagamento de fatura não se edita. Para corrigir, desfaça e pague de novo.'
              : 'Valor e data de compra no cartão definem a fatura em que ela caiu. Para mudar, exclua e lance de novo.'}
          </Txt>
        </Card>
      ) : (
        <>
          <MoneyInput
            valueCents={valor}
            onChange={setValor}
            kind={transferencia ? 'neutro' : (tx.kind as 'despesa' | 'receita')}
          />
          <DateField value={data} onChange={setData} />
        </>
      )}

      {transferencia ? (
        <>
          <SectionHeader>Sai de</SectionHeader>
          <OptionList
            itens={listaContas}
            selecionadoId={contaId}
            rotulo={(c) => c.nome}
            onSelect={(c) => setContaId(c.id)}
          />
          <SectionHeader>Entra em</SectionHeader>
          <OptionList
            itens={listaContas.filter((c) => c.id !== contaId)}
            selecionadoId={destinoId}
            rotulo={(c) => c.nome}
            onSelect={(c) => setDestinoId(c.id)}
          />
        </>
      ) : !pagamento ? (
        <>
          <SectionHeader>Categoria</SectionHeader>
          <OptionList
            itens={categorias.data ?? []}
            selecionadoId={categoriaId}
            rotulo={(c) => c.nome}
            cor={(c) => c.cor}
            onSelect={(c) => setCategoriaId(c.id === categoriaId ? null : c.id)}
          />
          {!noCartao && listaContas.length > 1 ? (
            <>
              <SectionHeader>Conta</SectionHeader>
              <OptionList
                itens={listaContas}
                selecionadoId={contaId}
                rotulo={(c) => c.nome}
                onSelect={(c) => setContaId(c.id)}
              />
            </>
          ) : null}
        </>
      ) : null}

      {!pagamento ? (
        <View style={{ marginTop: space[3] }}>
          <Field
            label="Descrição (opcional)"
            value={descricao}
            onChangeText={setDescricao}
            maxLength={80}
          />
        </View>
      ) : null}

      {erro ? (
        <Txt variant="sm" color="danger" style={{ marginTop: space[2] }}>
          {erro}
        </Txt>
      ) : null}

      {!pagamento ? (
        <Button
          label="Salvar alterações"
          onPress={salvar}
          loading={ocupado}
          disabled={ocupado || (!noCartao && valor <= 0)}
          size="lg"
          style={{ marginTop: space[4] }}
        />
      ) : null}
      <Button
        label={pagamento ? 'Desfazer pagamento' : noCartao ? 'Excluir compra' : 'Excluir'}
        variant="danger"
        onPress={excluir}
        disabled={ocupado}
        style={{ marginTop: space[3] }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
});
