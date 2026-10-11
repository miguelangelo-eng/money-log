/** S09 — Nova conta. */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { MoneyInput } from '@/components/ui/money-input';
import { Button, Field, SectionHeader, Txt } from '@/components/ui/primitives';
import { addAccount, ROTULO_TIPO_CONTA, TIPOS_CONTA, type TipoConta } from '@/data/ledger';
import { space, useTheme } from '@/design/theme';
import { formatCents } from '@/lib/money';

export default function NovaConta() {
  const t = useTheme();
  const router = useRouter();

  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoConta>('corrente');
  const [saldo, setSaldo] = useState(0);
  // A entrada de valor só digita positivo; o sinal é uma escolha explícita.
  const [negativo, setNegativo] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function sair() {
    if (router.canGoBack()) router.back();
    else router.replace('/contas');
  }

  async function salvar() {
    setTentou(true);
    if (nome.trim() === '') return;
    setSalvando(true);
    setErro(null);
    try {
      await addAccount({ nome, tipo, saldoInicialCents: negativo ? -saldo : saldo });
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
        label="Nome da conta"
        value={nome}
        onChangeText={setNome}
        placeholder="Ex.: Nubank, Poupança, Carteira"
        maxLength={40}
        erro={tentou && nome.trim() === '' ? 'Dê um nome à conta.' : null}
      />

      <SectionHeader>Tipo</SectionHeader>
      <View style={styles.grade}>
        {TIPOS_CONTA.map((k) => (
          <Button
            key={k}
            label={ROTULO_TIPO_CONTA[k]}
            size="sm"
            variant={tipo === k ? 'primary' : 'secondary'}
            onPress={() => setTipo(k)}
            style={styles.metade}
          />
        ))}
      </View>

      <SectionHeader>Saldo hoje</SectionHeader>
      <MoneyInput valueCents={saldo} onChange={setSaldo} kind="neutro" />
      <View style={styles.grade}>
        <Button
          label="Positivo"
          size="sm"
          variant={!negativo ? 'primary' : 'secondary'}
          onPress={() => setNegativo(false)}
          style={styles.metade}
        />
        <Button
          label="Negativo"
          size="sm"
          variant={negativo ? 'primary' : 'secondary'}
          onPress={() => setNegativo(true)}
          style={styles.metade}
        />
      </View>
      <Txt variant="xs" color="textMuted" style={{ marginTop: space[2] }}>
        {negativo && saldo > 0
          ? `A conta começa em ${formatCents(-saldo)} (cheque especial, por exemplo).`
          : 'O saldo de hoje é o ponto de partida; os lançamentos somam e subtraem a partir dele.'}
      </Txt>

      {erro ? (
        <Txt variant="sm" color="danger" style={{ marginTop: space[2] }}>
          {erro}
        </Txt>
      ) : null}

      <Button
        label="Salvar conta"
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
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  metade: { flexBasis: '47%', flexGrow: 1 },
});
