import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/** Carrega dados quando a tela ganha foco.
 *
 *  Por que foco e não `useLiveQuery` do Drizzle: a camada de dados é de
 *  Promises de propósito, para que a troca pela camada de sync (M1) não toque
 *  em tela nenhuma. `useLiveQuery` exigiria expor construtor de query para a
 *  UI, o que amarra a tela ao Drizzle.
 *
 *  Refocar cobre o caso do slice: salvar, voltar, lista atualizada.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  const chave = JSON.stringify(deps);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      setLoading(true);
      fn()
        .then((r) => {
          if (!vivo) return;
          setData(r);
          setError(null);
        })
        .catch((e) => {
          if (!vivo) return;
          setError(e instanceof Error ? e : new Error(String(e)));
        })
        .finally(() => {
          if (vivo) setLoading(false);
        });
      return () => {
        // Evita setState depois de a tela sair: o await pode terminar depois.
        vivo = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chave, tick]),
  );

  return { data, loading, error, reload: () => setTick((n) => n + 1) };
}
