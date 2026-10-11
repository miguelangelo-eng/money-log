/** Cliente do Supabase e o transporte do sync sobre ele.
 *
 *  URL e chave vêm de `.env.local` (fora do git), lidas em tempo de bundle:
 *
 *      EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *      EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_...   (ou a chave "anon")
 *
 *  A chave pública vai dentro do app por definição: quem protege os dados é a
 *  RLS, não o segredo da chave. A `service_role` / `sb_secret_` NUNCA entra
 *  aqui — ela ignora a RLS.
 *
 *  Sem as duas variáveis o app roda só local, como antes do M1.
 */

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { RespostaPull, Transporte } from '@/sync/engine';

// Acesso direto e literal: o Expo só substitui `process.env.EXPO_PUBLIC_X`
// escrito assim, não por desestruturação nem por índice dinâmico.
const URL_SUPABASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const CHAVE_SUPABASE = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const supabase: SupabaseClient | null =
  URL_SUPABASE && CHAVE_SUPABASE
    ? createClient(URL_SUPABASE, CHAVE_SUPABASE, {
        auth: {
          storage: AsyncStorage,
          persistSession: true,
          autoRefreshToken: true,
          // Não há URL de retorno num app nativo.
          detectSessionInUrl: false,
        },
      })
    : null;

// No React Native o refresh automático do token só deve rodar em primeiro
// plano; em segundo plano o timer não é confiável e gasta bateria.
if (supabase) {
  AppState.addEventListener('change', (estado) => {
    if (estado === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export function transporteSupabase(client: SupabaseClient): Transporte {
  return {
    async push(mudancas) {
      const { data, error } = await client.rpc('push_changes', { mudancas });
      if (error) throw new Error(error.message);
      return data;
    },
    async pull(desde) {
      const { data, error } = await client.rpc('pull_changes', { desde });
      if (error) throw new Error(error.message);
      return data as RespostaPull;
    },
  };
}

/** Mensagens do Supabase Auth em português. As que não estão aqui passam como
 *  vieram — melhor em inglês do que escondidas. */
export function mensagemDeAuth(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'Confirme o e-mail pelo link que enviamos antes de entrar.';
  if (/user already registered/i.test(m)) return 'Já existe uma conta com este e-mail. Use "Entrar".';
  if (/password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/unable to validate email|invalid email/i.test(m)) return 'E-mail inválido.';
  if (/network request failed|fetch failed/i.test(m)) return 'Sem conexão com a internet.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  return m;
}
