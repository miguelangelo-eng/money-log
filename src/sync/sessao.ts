import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/sync/supabase';

/** Sessão do Supabase Auth, persistida no AsyncStorage pelo cliente. */
export function useSessao(): { carregando: boolean; sessao: Session | null } {
  const [carregando, setCarregando] = useState(!!supabase);
  const [sessao, setSessao] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let vivo = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (vivo) setSessao(data.session);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => {
      if (vivo) setSessao(s);
    });
    return () => {
      vivo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { carregando, sessao };
}
