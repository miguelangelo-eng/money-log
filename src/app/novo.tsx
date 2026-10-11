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
import { diaMes, mesCurto, OptionList } from '@/components/ui/widgets';
import { addExpense, addIncome, cards, listAccounts, listCategories } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { PARCELAS_MAX, planoDeCompra } from '@/lib/card';
import { today } from '@/lib/civil-date';
import { formatCents } from '@/lib/money';

type Kind = 'despesa' | 'receita';
type Fonte = 'conta' | 'cartao';

export default function Novo() {
  const t = useTheme();
  const router = useRouter();

  const [kind, setKind] = useState<Kind>('despesa');
  const [valor, setValor] = useState(0);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [fonte, setFonte] = useState<Fonte>('conta');
  const [cartaoId, setCartaoId] = useState<string | null>(null);
  const [parcelas, setParcelas] = useState(1);

  const contas = useAsync(() => listAccounts(), ['contas']);
  const categorias = useAsync(() => listCategories(kind), ['cats', kind]);
  const cartoes = useAsync(() => cards.listCards(), ['cartoes']);

  // Receita no cartão (estorno) ainda não tem fluxo próprio: só conta.
  const fonteEfetiva: Fonte = kind === 'receita' ? 'conta' : fonte;
  const temCartao = (cartoes.data?.length ?? 0) > 0;
  const cartao = cartoes.data?.find((c) => c.id === cartaoId) ?? cartoes.data?.[0] ?? null;

  /** Prévia da compra no cartão, calculada pela mesma função que grava —
   *  o que a tela promete é exatamente o que vai para o banco. */
  const plano =
    fonteEfetiva === 'cartao' && cartao && valor > 0
      ? planoDeCompra(
          today(),
          { diaFechamento: cartao.diaFechamento, diaVencimento: cartao.diaVencimento },
          valor,
          parcelas,
        )
      : null;

  /** Sair da tela sem supor que existe pilha.
   *
   *  `router.back()` cru estoura "GO_BACK was not handled by any navigator"
   *  quando esta é a primeira rota — por exemplo ao abrir o app direto num
   *  deep link para /novo, ou depois de um reload do Metro em cima desta
   *  tela. O fallback leva para o Início, que é o destino certo nos dois
   *  casos. */
  function sair() {
    if (router.canGoBack()) router.back();
    // `/index`, não `/`: com o grupo (tabs), as rotas tipadas do expo-router
    // geram `/(tabs)/index` e `/index`, e o caminho nu `/` não existe no tipo.
    else router.replace('/index');
  }

  // Padrão: primeira conta. O usuário só mexe se tiver mais de uma.
  const contaEfetiva = contaId ?? contas.data?.[0]?.id ?? null;

  const destinoOk = fonteEfetiva === 'cartao' ? Boolean(cartao) : Boolean(contaEfetiva);
  const podeSalvar = valor > 0 && destinoOk && !salvando;

  async function salvar() {
    if (valor <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    if (!destinoOk) {
      setErro(
        fonteEfetiva === 'cartao' ? 'Escolha um cartão.' : 'Cadastre uma conta antes de lançar.',
      );
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      if (fonteEfetiva === 'cartao' && cartao) {
        await cards.addCardPurchase({
          cardId: cartao.id,
          amountCents: valor,
          competencia: today(),
          parcelas,
          categoryId: categoriaId,
        });
      } else {
        const payload = {
          amountCents: valor,
          competencia: today(),
          categoryId: categoriaId,
          accountId: contaEfetiva!,
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

      {kind === 'despesa' && temCartao ? (
        <>
          <SectionHeader>Pagar com</SectionHeader>
          <View style={styles.tipos}>
            <Button
              label="Conta"
              variant={fonteEfetiva === 'conta' ? 'primary' : 'secondary'}
              onPress={() => setFonte('conta')}
              style={styles.metade}
            />
            <Button
              label="Cartão"
              variant={fonteEfetiva === 'cartao' ? 'primary' : 'secondary'}
              onPress={() => setFonte('cartao')}
              style={styles.metade}
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
      ) : (contas.data?.length ?? 0) > 1 ? (
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
        onPress={sair}
        style={{ marginTop: space[2] }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
  tipos: { flexDirection: 'row', gap: space[3] },
  metade: { flex: 1 },
  parcelas: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  passo: { width: 56 },
  parcelasRotulo: { flex: 1, textAlign: 'center' },
});
