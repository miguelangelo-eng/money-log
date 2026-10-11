/** S11 — Cadastrar cartão.
 *
 *  Além do formulário, uma prévia ao vivo: em que fatura uma compra de hoje
 *  entraria e quando ela vence. O erro mais comum aqui é inverter
 *  fechamento e vencimento, e a prévia o torna visível antes de salvar.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, Field, SectionHeader, Txt } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { diaMes, mesCurto, OptionList } from '@/components/ui/widgets';
import { cards, listAccounts } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { space, useTheme } from '@/design/theme';
import { today } from '@/lib/civil-date';
import { invoiceForPurchase } from '@/lib/invoice';

/** '05' -> 5; vazio ou fora de 1..31 -> null. */
function dia(txt: string): number | null {
  if (!/^\d{1,2}$/.test(txt)) return null;
  const n = Number(txt);
  return n >= 1 && n <= 31 ? n : null;
}

export default function NovoCartao() {
  const t = useTheme();
  const router = useRouter();

  const [nome, setNome] = useState('');
  const [limite, setLimite] = useState(0);
  const [fechamentoTxt, setFechamentoTxt] = useState('');
  const [vencimentoTxt, setVencimentoTxt] = useState('');
  const [contaId, setContaId] = useState<string | null>(null);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contas = useAsync(() => listAccounts(), ['contas']);
  const contaEfetiva = contaId ?? contas.data?.[0]?.id ?? null;

  const fechamento = dia(fechamentoTxt);
  const vencimento = dia(vencimentoTxt);

  // Erros só aparecem depois da primeira tentativa: vermelho num campo que a
  // pessoa ainda nem começou a preencher é ruído.
  const erroNome = tentouSalvar && nome.trim() === '' ? 'Dê um nome ao cartão.' : null;
  const erroFech = tentouSalvar && fechamento === null ? 'Um dia entre 1 e 31.' : null;
  const erroVenc = tentouSalvar && vencimento === null ? 'Um dia entre 1 e 31.' : null;

  const previa =
    fechamento !== null && vencimento !== null
      ? invoiceForPurchase(today(), { diaFechamento: fechamento, diaVencimento: vencimento })
      : null;

  function sair() {
    if (router.canGoBack()) router.back();
    else router.replace('/cartoes');
  }

  async function salvar() {
    setTentouSalvar(true);
    if (nome.trim() === '' || fechamento === null || vencimento === null) return;
    setSalvando(true);
    setErro(null);
    try {
      await cards.addCard({
        nome,
        limiteCents: limite,
        diaFechamento: fechamento,
        diaVencimento: vencimento,
        contaPagamentoId: contaEfetiva,
      });
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
      <Field
        label="Nome do cartão"
        value={nome}
        onChangeText={setNome}
        placeholder="Ex.: Nubank, Inter"
        maxLength={40}
        erro={erroNome}
      />

      <Txt variant="sm" style={{ fontWeight: '600' }}>
        Limite
      </Txt>
      <MoneyInput valueCents={limite} onChange={setLimite} kind="neutro" />

      <View style={styles.dias}>
        <View style={styles.flex}>
          <Field
            label="Fecha no dia"
            value={fechamentoTxt}
            onChangeText={setFechamentoTxt}
            keyboardType="number-pad"
            maxLength={2}
            erro={erroFech}
          />
        </View>
        <View style={styles.flex}>
          <Field
            label="Vence no dia"
            value={vencimentoTxt}
            onChangeText={setVencimentoTxt}
            keyboardType="number-pad"
            maxLength={2}
            erro={erroVenc}
          />
        </View>
      </View>

      {previa ? (
        <Card style={{ marginBottom: space[3] }}>
          <Txt variant="sm">
            {`Uma compra hoje entra na fatura de ${mesCurto(previa.mesReferencia)}, ` +
              `que fecha em ${diaMes(previa.dataFechamento)} e vence em ${diaMes(previa.dataVencimento)}.`}
          </Txt>
          {fechamento !== null && fechamento > 28 ? (
            <Txt variant="xs" color="textMuted" style={{ marginTop: space[2] }}>
              {`Nos meses sem dia ${fechamento}, a fatura fecha no último dia do mês.`}
            </Txt>
          ) : null}
        </Card>
      ) : null}

      {(contas.data?.length ?? 0) > 0 ? (
        <>
          <SectionHeader>Conta que paga a fatura</SectionHeader>
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
        label="Salvar cartão"
        onPress={salvar}
        loading={salvando}
        disabled={salvando}
        size="lg"
        style={{ marginTop: space[4] }}
      />
      <Button label="Cancelar" variant="ghost" onPress={sair} style={{ marginTop: space[2] }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], paddingBottom: space[8] },
  dias: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  flex: { flex: 1 },
});
