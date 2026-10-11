/** S02 — Entrar / criar conta. E-mail e senha (Supabase Auth).
 *
 *  Não é rota: o portão do _layout a mostra no lugar da pilha enquanto o
 *  aparelho não tem dono. Assim não existe caminho de navegação que pule o
 *  login no primeiro uso.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Field, Txt } from '@/components/ui/primitives';
import { space, useTheme } from '@/design/theme';
import { mensagemDeAuth, supabase } from '@/sync/supabase';

const SENHA_MIN = 6;

export function Entrar({ temDadosLocais }: { temDadosLocais: boolean }) {
  const t = useTheme();
  const [modo, setModo] = useState<'entrar' | 'criar'>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const senhaOk = senha.length >= SENHA_MIN;

  async function enviar() {
    setTentou(true);
    setErro(null);
    setAviso(null);
    if (!supabase || !emailOk || !senhaOk) return;
    setEnviando(true);
    try {
      const credencial = { email: email.trim(), password: senha };
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword(credencial);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp(credencial);
        if (error) throw error;
        // Com "Confirm email" ligado no projeto, o cadastro não devolve sessão.
        if (!data.session) {
          setAviso(`Enviamos um link de confirmação para ${credencial.email}. Confirme e depois entre.`);
          setModo('entrar');
        }
      }
      // Com sessão, o portão do _layout percebe pela mudança de estado do
      // auth e segue sozinho. Nada a fazer aqui.
    } catch (e) {
      setErro(mensagemDeAuth(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.tela} keyboardShouldPersistTaps="handled">
        <Txt variant="xl" style={{ fontWeight: '700' }}>
          {modo === 'entrar' ? 'Entrar' : 'Criar conta'}
        </Txt>
        <Txt variant="sm" color="textMuted" style={{ marginBottom: space[4] }}>
          {temDadosLocais
            ? 'Os lançamentos que já estão neste aparelho vão junto para a sua conta, como backup.'
            : 'Seus dados ficam neste aparelho e com cópia na sua conta. Cada conta só vê os próprios dados.'}
        </Txt>

        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          erro={tentou && !emailOk ? 'Digite um e-mail válido.' : null}
        />
        <Field
          label="Senha"
          value={senha}
          onChangeText={setSenha}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
          erro={tentou && !senhaOk ? `Pelo menos ${SENHA_MIN} caracteres.` : null}
        />

        {erro ? (
          <Txt variant="sm" color="danger" style={{ marginBottom: space[3] }}>
            {erro}
          </Txt>
        ) : null}
        {aviso ? (
          <Txt variant="sm" style={{ marginBottom: space[3] }}>
            {aviso}
          </Txt>
        ) : null}

        <Button
          label={modo === 'entrar' ? 'Entrar' : 'Criar conta'}
          onPress={enviar}
          loading={enviando}
          disabled={enviando}
        />
        <View style={{ height: space[3] }} />
        <Button
          label={modo === 'entrar' ? 'Ainda não tenho conta' : 'Já tenho conta'}
          variant="secondary"
          onPress={() => {
            setModo(modo === 'entrar' ? 'criar' : 'entrar');
            setErro(null);
            setAviso(null);
          }}
          disabled={enviando}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[6], paddingTop: space[8], gap: space[1] },
});
