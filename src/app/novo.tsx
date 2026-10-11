/** S05 + S06 — escolher o tipo e preencher o lançamento.
 *
 *  Meta do fluxo F02: 5 toques. Valor, categoria, salvar — conta e data vêm
 *  com padrão (primeira conta, hoje). Cada toque a mais aqui é um toque a mais
 *  dez vezes por dia, então tudo que não é obrigatório tem padrão.
 *
 *  Três tipos: despesa, receita e transferência. Despesa pode ir para conta ou
 *  cartão (com parcelas). Transferência move dinheiro entre duas contas do
 *  próprio usuário e não tem categoria — não é gasto nem entrada.
 *
 *  Em conta, despesa e receita podem repetir (todo mês, sem fim) e despesa
 *  pode ser parcelada; e o status (pago/a pagar) vem da data, mas pode ser
 *  trocado — o boleto que vence hoje e ainda não foi pago. Tudo com padrão:
 *  o caminho de 5 toques não ganhou nenhum.
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
import { formatCents, splitInstallments } from '@/lib/money';

type Kind = 'despesa' | 'receita' | 'transferencia';
type Fonte = 'conta' | 'cartao';
type Repetir = 'unica' | 'mensal' | 'parcelado';

/** − n + para parcelas. O mesmo controle no cartão e na conta. */
function SeletorDeParcelas({
  valor,
  min,
  onChange,
}: {
  valor: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <View style={styles.parcelas}>
      <Button
        label={'−'}
        variant="secondary"
        size="sm"
        disabled={valor <= min}
        onPress={() => onChange(Math.max(min, valor - 1))}
        style={styles.passo}
      />
      <Txt variant="lg" style={styles.parcelasRotulo}>
        {valor === 1 ? 'à vista' : `${valor}x`}
      </Txt>
      <Button
        label="+"
        variant="secondary"
        size="sm"
        disabled={valor >= PARCELAS_MAX}
        onPress={() => onChange(Math.min(PARCELAS_MAX, valor + 1))}
        style={styles.passo}
      />
    </View>
  );
}

/** "3x: R$ 33,34 na primeira, R$ 33,33 nas demais." */
function textoDasParcelas(valores: number[]): string {
  const [primeira] = valores;
  const ultima = valores[valores.length - 1];
  return (
    `${valores.length}x: ${formatCents(primeira)}` +
    (primeira !== ultima ? ` na primeira, ${formatCents(ultima)} nas demais.` : ' cada.')
  );
}

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
  const [repetir, setRepetir] = useState<Repetir>('unica');
  const [parcelasConta, setParcelasConta] = useState(2);
  /** null = segue a data (futuro é pendente). */
  const [pagoEscolhido, setPagoEscolhido] = useState<boolean | null>(null);
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

  // Em conta, despesa e receita podem repetir; parcelado só despesa.
  const emConta = !transferencia && fonteEfetiva === 'conta';
  const repetirEfetivo: Repetir =
    !emConta || (repetir === 'parcelado' && kind !== 'despesa') ? 'unica' : repetir;
  const pagoEfetivo = pagoEscolhido ?? data <= today();
  const recebe = kind === 'receita';

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
          pago: pagoEfetivo,
          repeticao:
            repetirEfetivo === 'parcelado'
              ? { tipo: 'parcelado' as const, parcelas: parcelasConta }
              : { tipo: repetirEfetivo },
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
          <SeletorDeParcelas valor={parcelas} min={1} onChange={setParcelas} />

          {plano ? (
            <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
              {(parcelas > 1 ? `${textoDasParcelas(plano.map((x) => x.amountCents))} ` : '') +
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

      {emConta ? (
        <>
          <SectionHeader>Repetir</SectionHeader>
          <View style={styles.linha}>
            {(
              [
                ['unica', 'Uma vez'],
                ['mensal', 'Todo mês'],
                ...(kind === 'despesa' ? [['parcelado', 'Parcelado']] : []),
              ] as Array<[Repetir, string]>
            ).map(([r, rotulo]) => (
              <Button
                key={r}
                label={rotulo}
                size="sm"
                variant={repetirEfetivo === r ? 'primary' : 'secondary'}
                onPress={() => setRepetir(r)}
                style={styles.flex}
              />
            ))}
          </View>
          {repetirEfetivo === 'parcelado' ? (
            <>
              <View style={{ height: space[2] }} />
              <SeletorDeParcelas valor={parcelasConta} min={2} onChange={setParcelasConta} />
              {valor > 0 ? (
                <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
                  {`${textoDasParcelas(splitInstallments(valor, parcelasConta))} Uma por mês, a partir da data abaixo.`}
                </Txt>
              ) : null}
            </>
          ) : repetirEfetivo === 'mensal' ? (
            <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
              {'Lançado todo mês, no mesmo dia, sem data para acabar. Para parar, exclua "esta e as próximas".'}
            </Txt>
          ) : null}
        </>
      ) : null}

      <DateField value={data} onChange={setData} />

      {emConta ? (
        <View style={[styles.linha, { marginTop: space[3] }]}>
          <Button
            label={recebe ? 'Recebido' : 'Pago'}
            size="sm"
            variant={pagoEfetivo ? 'primary' : 'secondary'}
            onPress={() => setPagoEscolhido(true)}
            style={styles.flex}
          />
          <Button
            label={recebe ? 'A receber' : 'A pagar'}
            size="sm"
            variant={!pagoEfetivo ? 'primary' : 'secondary'}
            onPress={() => setPagoEscolhido(false)}
            style={styles.flex}
          />
        </View>
      ) : null}

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
