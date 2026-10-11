/** S05 + S06 — escolher o tipo e preencher o lançamento.
 *
 *  Meta do fluxo F02: 5 toques. Valor, categoria, salvar — conta e data vêm
 *  com padrão (primeira conta, hoje). Cada toque a mais aqui é um toque a mais
 *  dez vezes por dia, então tudo que não é obrigatório tem padrão.
 *
 *  Três tipos: despesa, receita e transferência. Despesa pode ir para conta ou
 *  cartão (com parcelas). Transferência move dinheiro entre duas contas do
 *  próprio usuário e não tem categoria — não é gasto nem entrada.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { DateField } from '@/components/ui/date-field';
import { MoneyInput } from '@/components/ui/money-input';
import { Button, Field, SectionHeader, Txt } from '@/components/ui/primitives';
import { diaMes, mesCurto, OptionList } from '@/components/ui/widgets';
import {
  addExpense,
  addIncome,
  addTransfer,
  cards,
  listAccounts,
  listCategories,
} from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { PARCELAS_MAX, planoDeCompra } from '@/lib/card';
import { today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';

type Kind = 'despesa' | 'receita' | 'transferencia';
type Fonte = 'conta' | 'cartao';

const ROTULO_KIND: Record<Kind, string> = {
  despesa: 'Despesa',
  receita: 'Receita',
  transferencia: 'Transferência',
};

export default function Novo() {
  const t = useTheme();
  const router = useRouter();

  const [kind, setKind] = useState<Kind>('despesa');
  const [valor, setValor] = useState(0);
  const [data, setData] = useState(today());
  const [descricao, setDescricao] = useState('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [fonte, setFonte] = useState<Fonte>('conta');
  const [cartaoId, setCartaoId] = useState<string | null>(null);
  const [parcelas, setParcelas] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contas = useAsync(() => listAccounts(), ['contas']);
  const categorias = useAsync(
    () => (kind === 'transferencia' ? Promise.resolve([]) : listCategories(kind)),
    ['cats', kind],
  );
  const cartoes = useAsync(() => cards.listCards(), ['cartoes']);

  const listaContas = contas.data ?? [];
  const transferencia = kind === 'transferencia';

  // Cartão só para despesa: receita no cartão (estorno) ainda não tem fluxo.
  const fonteEfetiva: Fonte = kind === 'despesa' ? fonte : 'conta';
  const temCartao = (cartoes.data?.length ?? 0) > 0;
  const cartao = cartoes.data?.find((c) => c.id === cartaoId) ?? cartoes.data?.[0] ?? null;

  // Padrão: primeira conta como origem; destino, a primeira que não é a origem.
  const contaEfetiva = contaId ?? listaContas[0]?.id ?? null;
  const destinoEfetivo =
    destinoId && destinoId !== contaEfetiva
      ? destinoId
      : (listaContas.find((c) => c.id !== contaEfetiva)?.id ?? null);

  /** Prévia da compra no cartão, calculada pela mesma função que grava —
   *  o que a tela promete é exatamente o que vai para o banco. */
  const plano =
    fonteEfetiva === 'cartao' && cartao && valor > 0
      ? planoDeCompra(
          data,
          { diaFechamento: cartao.diaFechamento, diaVencimento: cartao.diaVencimento },
          valor,
          parcelas,
        )
      : null;

  /** Sair sem supor que existe pilha: `router.back()` cru estoura quando esta
   *  é a primeira rota (deep link direto, ou reload do Metro em cima dela). */
  function sair() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function trocarTipo(k: Kind) {
    setKind(k);
    setCategoriaId(null);
    setErro(null);
  }

  const destinoOk = transferencia
    ? Boolean(contaEfetiva && destinoEfetivo)
    : fonteEfetiva === 'cartao'
      ? Boolean(cartao)
      : Boolean(contaEfetiva);
  const podeSalvar = valor > 0 && destinoOk && !salvando;

  async function salvar() {
    if (valor <= 0) return setErro('Informe um valor maior que zero.');
    if (!destinoOk) {
      return setErro(
        transferencia
          ? 'Transferência precisa de duas contas.'
          : fonteEfetiva === 'cartao'
            ? 'Escolha um cartão.'
            : 'Cadastre uma conta antes de lançar.',
      );
    }
    setSalvando(true);
    setErro(null);
    try {
      if (transferencia) {
        await addTransfer({
          amountCents: valor,
          competencia: data,
          deContaId: contaEfetiva!,
          paraContaId: destinoEfetivo!,
          descricao,
        });
      } else if (fonteEfetiva === 'cartao' && cartao) {
        await cards.addCardPurchase({
          cardId: cartao.id,
          amountCents: valor,
          competencia: data,
          parcelas,
          categoryId: categoriaId,
          descricao,
        });
      } else {
        const payload = {
          amountCents: valor,
          competencia: data,
          categoryId: categoriaId,
          accountId: contaEfetiva!,
          descricao,
        };
        if (kind === 'despesa') await addExpense(payload);
        else await addIncome(payload);
      }
      sair();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setSalvando(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.tela}
      keyboardShouldPersistTaps="handled">
      {/* S05 — tipo. Rotulado: ícone sem texto num app de dinheiro gera
          lançamento no tipo errado. */}
      <View style={styles.linha}>
        {(Object.keys(ROTULO_KIND) as Kind[]).map((k) => (
          <Button
            key={k}
            label={ROTULO_KIND[k]}
            size="sm"
            variant={kind === k ? 'primary' : 'secondary'}
            onPress={() => trocarTipo(k)}
            style={styles.flex}
          />
        ))}
      </View>

      <MoneyInput
        valueCents={valor}
        onChange={setValor}
        kind={transferencia ? 'neutro' : kind}
        autoFocus
      />

      {transferencia ? (
        listaContas.length < 2 ? (
          <View style={{ marginTop: space[2] }}>
            <Txt variant="sm" color="textMuted">
              Transferência move dinheiro entre duas contas suas, e você tem só uma.
            </Txt>
            <Button
              label="Criar outra conta"
              variant="secondary"
              onPress={() => router.push('/conta-nova')}
              style={{ marginTop: space[2] }}
            />
          </View>
        ) : (
          <>
            <SectionHeader>Sai de</SectionHeader>
            <OptionList
              itens={listaContas}
              selecionadoId={contaEfetiva}
              rotulo={(c) => c.nome}
              onSelect={(c) => setContaId(c.id)}
            />
            <SectionHeader>Entra em</SectionHeader>
            <OptionList
              itens={listaContas.filter((c) => c.id !== contaEfetiva)}
              selecionadoId={destinoEfetivo}
              rotulo={(c) => c.nome}
              onSelect={(c) => setDestinoId(c.id)}
            />
          </>
        )
      ) : (
        <>
          <SectionHeader>Categoria</SectionHeader>
          {categorias.loading && !categorias.data ? (
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
          {/* Criar categoria sem abandonar o lançamento: ao voltar, a lista
              recarrega pelo foco. */}
          <Button
            label="+ Nova categoria"
            variant="ghost"
            size="sm"
            onPress={() =>
              router.push({ pathname: '/categoria-nova', params: { tipo: kind } })
            }
          />
        </>
      )}

      {kind === 'despesa' && temCartao ? (
        <>
          <SectionHeader>Pagar com</SectionHeader>
          <View style={styles.linha}>
            <Button
              label="Conta"
              variant={fonteEfetiva === 'conta' ? 'primary' : 'secondary'}
              onPress={() => setFonte('conta')}
              style={styles.flex}
            />
            <Button
              label="Cartão"
              variant={fonteEfetiva === 'cartao' ? 'primary' : 'secondary'}
              onPress={() => setFonte('cartao')}
              style={styles.flex}
            />
          </View>
        </>
      ) : null}

      {fonteEfetiva === 'cartao' ? (
        <>
          {(cartoes.data?.length ?? 0) > 1 ? (
            <>
              <SectionHeader>Cartão</SectionHeader>
              <OptionList
                itens={cartoes.data ?? []}
                selecionadoId={cartao?.id ?? null}
                rotulo={(c) => c.nome}
                onSelect={(c) => setCartaoId(c.id)}
              />
            </>
          ) : null}

          <SectionHeader>Parcelas</SectionHeader>
          <View style={styles.parcelas}>
            <Button
              label={'−'}
              variant="secondary"
              size="sm"
              disabled={parcelas <= 1}
              onPress={() => setParcelas((n) => Math.max(1, n - 1))}
              style={styles.passo}
            />
            <Txt variant="lg" style={styles.parcelasRotulo}>
              {parcelas === 1 ? 'à vista' : `${parcelas}x`}
            </Txt>
            <Button
              label="+"
              variant="secondary"
              size="sm"
              disabled={parcelas >= PARCELAS_MAX}
              onPress={() => setParcelas((n) => Math.min(PARCELAS_MAX, n + 1))}
              style={styles.passo}
            />
          </View>

          {plano ? (
            <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
              {(parcelas > 1
                ? `${parcelas}x: ${formatCents(plano[0].amountCents)}` +
                  (plano[0].amountCents !== plano[plano.length - 1].amountCents
                    ? ` na primeira, ${formatCents(plano[plano.length - 1].amountCents)} nas demais. `
                    : ' cada. ')
                : '') +
                `Entra na fatura de ${mesCurto(plano[0].fatura.mesReferencia)}, ` +
                `que vence em ${diaMes(plano[0].fatura.dataVencimento)}.`}
            </Txt>
          ) : null}
        </>
      ) : !transferencia && listaContas.length > 1 ? (
        <>
          <SectionHeader>Conta</SectionHeader>
          <OptionList
            itens={listaContas}
            selecionadoId={contaEfetiva}
            rotulo={(c) => c.nome}
            onSelect={(c) => setContaId(c.id)}
          />
        </>
      ) : null}

      <DateField value={data} onChange={setData} />

      <View style={{ marginTop: space[3] }}>
        <Field
          label="Descrição (opcional)"
          value={descricao}
          onChangeText={setDescricao}
          placeholder={transferencia ? 'Ex.: reserva do mês' : 'Ex.: feira de sábado'}
          maxLength={80}
        />
      </View>

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
      <Button label="Cancelar" variant="ghost" onPress={sair} style={{ marginTop: space[2] }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
  linha: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  parcelas: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  passo: { width: 56 },
  parcelasRotulo: { flex: 1, textAlign: 'center' },
});
