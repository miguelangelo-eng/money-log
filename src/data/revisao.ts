/** "Os dados mudaram por fora da tela."
 *
 *  As telas recarregam ao ganhar foco (use-async.ts). Isso cobre o que a
 *  própria pessoa faz, mas não o que chega do servidor com a tela aberta. O
 *  sync chama `avisarMudanca()` depois de um pull, e o useAsync recarrega em
 *  silêncio, sem trocar o conteúdo por um spinner.
 */

type Ouvinte = () => void;
const ouvintes = new Set<Ouvinte>();

export function avisarMudanca() {
  for (const o of ouvintes) o();
}

export function ouvirMudancas(o: Ouvinte): () => void {
  ouvintes.add(o);
  return () => {
    ouvintes.delete(o);
  };
}
