/** Liga o motor de sync ao banco do aparelho e ao Supabase, e mantém o estado
 *  que as telas mostram (sincronizando, último erro, pendências).
 *
 *  `sync` é null quando o Supabase não está configurado: o app roda só local.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { db } from '@/db/client';
import { LOCAL_USER_ID, nowIso } from '@/data/ledger';
import { avisarMudanca } from '@/data/revisao';
import { createSync } from '@/sync/engine';
import { mensagemDeAuth, supabase, transporteSupabase } from '@/sync/supabase';

export const sync = supabase
  ? createSync({ db, transporte: transporteSupabase(supabase), localUserId: LOCAL_USER_ID, nowIso })
  : null;

// ------------------------------------------------------------- estado da UI

export type StatusSync = {
  sincronizando: boolean;
  /** Mensagem da última falha; limpa no próximo sucesso. */
  erro: string | null;
  /** Sem sessão válida: o aparelho tem dono, mas o login expirou. */
  semSessao: boolean;
};

let status: StatusSync = { sincronizando: false, erro: null, semSessao: false };
const ouvintes = new Set<() => void>();

function mudar(p: Partial<StatusSync>) {
  status = { ...status, ...p };
  for (const o of ouvintes) o();
}

export function useStatusSync(): StatusSync {
  return useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => {
        ouvintes.delete(o);
      };
    },
    () => status,
  );
}

/** Push + pull, se houver sessão. Nunca lança: o erro vai para o status. O
 *  app é local-first — falhar em sincronizar não pode travar nada. */
export async function sincronizarAgora(): Promise<void> {
  if (!sync || !supabase) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    mudar({ semSessao: true });
    return;
  }
  mudar({ sincronizando: true, semSessao: false });
  try {
    const r = await sync.sincronizar(data.session.user.id);
    mudar({ erro: null });
    if (r.recebidas > 0) avisarMudanca();
  } catch (e) {
    mudar({ erro: mensagemDeAuth(e) });
  } finally {
    mudar({ sincronizando: false });
  }
}

const INTERVALO_MS = 15_000;

/** Sincroniza ao abrir, ao voltar para o primeiro plano, ao ir para o segundo
 *  plano (a última chance de subir o que acabou de ser lançado) e, com o app
 *  aberto, a cada 15 s se houver algo na fila. */
export function useAutoSync(ativo: boolean) {
  useEffect(() => {
    if (!ativo || !sync) return;
    const s = sync;

    void sincronizarAgora();

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void sincronizarAgora();
      else if (estado === 'background' && s.pendentes() > 0) void sincronizarAgora();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && s.pendentes() > 0) void sincronizarAgora();
    }, INTERVALO_MS);

    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [ativo]);
}
