/** S14 — Nova categoria.
 *
 *  A cor vem dos 8 slots categóricos validados (ordem fixa, separação para
 *  daltonismo medida), não de um seletor livre: cor escolhida à mão quase
 *  sempre cai perto de outra e some no relatório. Ícone por categoria fica
 *  para quando o app tiver um conjunto de ícones — hoje a categoria é
 *  identificada por cor e nome.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Field, SectionHeader, Txt } from '@/components/ui/primitives';
import { addCategory } from '@/data/ledger';
import { categorical, radius, space, TARGET_MIN, useTheme } from '@/design/theme';

const NOMES_COR = ['azul', 'laranja', 'verde-água', 'amarelo', 'rosa', 'verde', 'roxo', 'vermelho'];

export default function NovaCategoria() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ tipo?: string }>();

  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'despesa' | 'receita'>(
    params.tipo === 'receita' ? 'receita' : 'despesa',
  );
  // Guarda o hex do modo claro, como a semente: é o valor de referência dos
  // slots; o escuro é o mesmo slot com outro passo.
  const [cor, setCor] = useState<string>(categorical.light[0]);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function sair() {
    if (router.canGoBack()) router.back();
    else router.replace('/categorias');
  }

  async function salvar() {
    setTentou(true);
    if (nome.trim() === '') return;
    setSalvando(true);
    setErro(null);
    try {
      await addCategory({ nome, tipo, cor });
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
        label="Nome"
        value={nome}
        onChangeText={setNome}
        placeholder={tipo === 'despesa' ? 'Ex.: Pet, Academia' : 'Ex.: Freelas'}
        maxLength={30}
        erro={tentou && nome.trim() === '' ? 'Dê um nome à categoria.' : null}
      />

      <SectionHeader>Tipo</SectionHeader>
      <View style={styles.linha}>
        <Button
          label="Despesa"
          size="sm"
          variant={tipo === 'despesa' ? 'primary' : 'secondary'}
          onPress={() => setTipo('despesa')}
          style={styles.flex}
        />
        <Button
          label="Receita"
          size="sm"
          variant={tipo === 'receita' ? 'primary' : 'secondary'}
          onPress={() => setTipo('receita')}
          style={styles.flex}
        />
      </View>

      <SectionHeader>Cor</SectionHeader>
      <View style={styles.cores}>
        {categorical.light.map((hex, i) => {
          const ativa = hex === cor;
          return (
            <Pressable
              key={hex}
              onPress={() => setCor(hex)}
              accessibilityRole="radio"
              accessibilityLabel={NOMES_COR[i]}
              accessibilityState={{ selected: ativa }}
              style={[
                styles.cor,
                {
                  backgroundColor: hex,
                  borderColor: ativa ? t.text : t.surface,
                  borderWidth: ativa ? 3 : 2,
                },
              ]}>
              {/* Selecionada tem marca, não só a borda. A marca vai num círculo
                  na cor da superfície: branco direto sobre o amarelo (#eda100)
                  ficaria em ~2:1, abaixo do piso. */}
              {ativa ? (
                <View style={[styles.marca, { backgroundColor: t.surface }]}>
                  <Txt variant="sm" style={{ fontWeight: '700' }}>
                    {'✓'}
                  </Txt>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {erro ? (
        <Txt variant="sm" color="danger" style={{ marginTop: space[2] }}>
          {erro}
        </Txt>
      ) : null}

      <Button
        label="Salvar categoria"
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
  linha: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  cores: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[2] },
  marca: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cor: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
