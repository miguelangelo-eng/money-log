/** Catálogo de ícones de categoria.
 *
 *  O banco guarda a CHAVE (`categories.icone`), não o nome do glifo: a chave é
 *  nossa e estável, o glifo é do Ionicons e pode mudar de biblioteca sem
 *  migração. As dez primeiras chaves são as das categorias padrão semeadas
 *  desde o M0 (`cart`, `utensils`, `smile`…), por isso nem todas batem com o
 *  nome do glifo.
 *
 *  `rotulo` é o que o leitor de tela fala na grade de escolha.
 */

export interface IconeDeCategoria {
  chave: string;
  glifo: string;
  rotulo: string;
}

export const ICONES_CATEGORIA: readonly IconeDeCategoria[] = [
  { chave: 'cart', glifo: 'cart', rotulo: 'carrinho' },
  { chave: 'home', glifo: 'home', rotulo: 'casa' },
  { chave: 'car', glifo: 'car', rotulo: 'carro' },
  { chave: 'utensils', glifo: 'restaurant', rotulo: 'talheres' },
  { chave: 'heart', glifo: 'medkit', rotulo: 'saúde' },
  { chave: 'smile', glifo: 'happy', rotulo: 'lazer' },
  { chave: 'repeat', glifo: 'repeat', rotulo: 'assinatura' },
  { chave: 'tag', glifo: 'pricetag', rotulo: 'etiqueta' },
  { chave: 'briefcase', glifo: 'briefcase', rotulo: 'trabalho' },
  { chave: 'plus', glifo: 'add-circle', rotulo: 'outras entradas' },
  { chave: 'cash', glifo: 'cash', rotulo: 'dinheiro' },
  { chave: 'trending-up', glifo: 'trending-up', rotulo: 'investimento' },
  { chave: 'fast-food', glifo: 'fast-food', rotulo: 'lanche' },
  { chave: 'cafe', glifo: 'cafe', rotulo: 'café' },
  { chave: 'beer', glifo: 'beer', rotulo: 'bar' },
  { chave: 'bus', glifo: 'bus', rotulo: 'ônibus' },
  { chave: 'bicycle', glifo: 'bicycle', rotulo: 'bicicleta' },
  { chave: 'airplane', glifo: 'airplane', rotulo: 'viagem' },
  { chave: 'flash', glifo: 'flash', rotulo: 'energia' },
  { chave: 'water', glifo: 'water', rotulo: 'água' },
  { chave: 'wifi', glifo: 'wifi', rotulo: 'internet' },
  { chave: 'phone', glifo: 'phone-portrait', rotulo: 'celular' },
  { chave: 'school', glifo: 'school', rotulo: 'educação' },
  { chave: 'book', glifo: 'book', rotulo: 'livros' },
  { chave: 'fitness', glifo: 'barbell', rotulo: 'academia' },
  { chave: 'medical', glifo: 'fitness', rotulo: 'bem-estar' },
  { chave: 'shirt', glifo: 'shirt', rotulo: 'roupas' },
  { chave: 'cut', glifo: 'cut', rotulo: 'beleza' },
  { chave: 'paw', glifo: 'paw', rotulo: 'pet' },
  { chave: 'people', glifo: 'people', rotulo: 'família' },
  { chave: 'gift', glifo: 'gift', rotulo: 'presente' },
  { chave: 'game', glifo: 'game-controller', rotulo: 'jogos' },
  { chave: 'film', glifo: 'film', rotulo: 'cinema' },
  { chave: 'bag', glifo: 'bag-handle', rotulo: 'compras' },
  { chave: 'store', glifo: 'storefront', rotulo: 'loja' },
  { chave: 'construct', glifo: 'construct', rotulo: 'manutenção' },
];

const POR_CHAVE = new Map(ICONES_CATEGORIA.map((i) => [i.chave, i]));

export const ICONE_PADRAO = 'tag';

export function iconeValido(chave: string): boolean {
  return POR_CHAVE.has(chave);
}

/** Glifo do Ionicons para uma chave. Chave desconhecida (veio de outra versão
 *  do app pelo sync, por exemplo) cai na etiqueta, nunca num quadrado vazio. */
export function glifoDoIcone(chave: string | null | undefined): string {
  return POR_CHAVE.get(chave ?? '')?.glifo ?? 'pricetag';
}

export function rotuloDoIcone(chave: string | null | undefined): string {
  return POR_CHAVE.get(chave ?? '')?.rotulo ?? 'etiqueta';
}
