/** Regras de classificação que dependem só do texto do extrato.
 *
 *  O erro que estas regras evitam: importar tudo como gasto e receita. No
 *  extrato da conta, boa parte das saídas não é gasto: é pagamento de fatura
 *  (o gasto já está no cartão), dinheiro guardado na caixinha (continua
 *  sendo seu) ou o "Pix no Crédito" (entra e sai no mesmo dia; o gasto vem
 *  na fatura). Somar isso como despesa mais que dobraria o mês.
 *
 *  O que depende do banco do app (histórico, faturas abertas, lançamentos
 *  já existentes) fica em src/data/importacao.ts.
 */

import type { LinhaExtrato, Origem } from './ler';

export type RegraFixa =
  | { tipo: 'ignorar'; motivo: string }
  | { tipo: 'pagamento_fatura' }
  /** Transferência entre esta conta e a de investimentos. O sentido vem do
   *  sinal: saída = aplicação, entrada = resgate. */
  | { tipo: 'investimento' }
  /** IOF de compra internacional: mesma categoria da compra. */
  | { tipo: 'herdar'; de: string };

export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const PIX_NO_CREDITO = /^valor adicionado na conta por cartao de credito/;

/** O "Pix no Crédito" aparece na conta como um par: o cartão põe o valor na
 *  conta e o Pix o tira no mesmo dia. Soma zero na conta, e a compra de
 *  verdade chega na fatura. As duas linhas são ignoradas.
 *
 *  O par é reconhecido pelo id: a saída é `<id da entrada>:reversal`. */
export function idsPixNoCredito(linhas: LinhaExtrato[]): Set<string> {
  const ids = new Set<string>();
  for (const l of linhas) {
    if (!PIX_NO_CREDITO.test(normalizar(l.original))) continue;
    ids.add(l.idExterno);
    ids.add(`${l.idExterno}:reversal`);
  }
  return ids;
}

export function regraFixa(l: LinhaExtrato, origem: Origem, pixNoCredito: Set<string>): RegraFixa | null {
  const t = normalizar(l.original);

  if (origem === 'cartao') {
    if (/^pagamento recebido/.test(t)) {
      return { tipo: 'ignorar', motivo: 'Pagamento da fatura: entra pelo extrato da conta.' };
    }
    const iof = /^iof de "(.+)"$/i.exec(l.original.trim());
    if (iof) return { tipo: 'herdar', de: iof[1] };
    return null;
  }

  if (pixNoCredito.has(l.idExterno)) {
    return { tipo: 'ignorar', motivo: 'Pix no Crédito: entra e sai no mesmo dia; o gasto vem na fatura.' };
  }
  if (/^pagamento de fatura/.test(t)) return { tipo: 'pagamento_fatura' };
  if (/^(aplicacao|resgate) rdb\b/.test(t) || /caixinha/.test(t)) return { tipo: 'investimento' };
  return null;
}

/** Palavra no texto -> nome de categoria padrão do app. Primeira que casar.
 *  É só o palpite da primeira vez: o que a pessoa escolher na prévia vira
 *  histórico, e o histórico tem precedência (ver importacao.ts). */
const PALAVRAS: Array<[RegExp, string]> = [
  [/\b(uber|99 ?ride|99 ?pop|99app|cabify|combustivel|estacionamento|ipiranga)|\bpostos?\b/, 'Transporte'],
  [/(supermercado|\bmercado\b|atacad|hipermarket|despensa|hortifruti|assai|carrefour)/, 'Mercado'],
  [/(ifood|99food|restaurante|lanchonete|pizzaria|marmitaria|acai|mc ?donalds|burger|ze delivery|padaria|\bbar\b)/, 'Alimentação fora'],
  [/(spotify|netflix|youtube|prime video|disney|\bhbo\b|deezer|globoplay|claude|openai|chatgpt|apple\.com)/, 'Assinaturas'],
  [/(\benel\b|energia|\bagua\b|saneamento|internet|fibra|\bgas\b|imobiliaria|aluguel|condominio)/, 'Moradia'],
  [/(farmacia|drogaria|dental|clinica|hospital|saude|laboratorio|drogasil|pague menos)/, 'Saúde'],
  [/(cinema|ingresso|steam|playstation|xbox)/, 'Lazer'],
];

export function categoriaPorPalavra(descricao: string): string | null {
  const t = normalizar(descricao);
  for (const [re, nome] of PALAVRAS) if (re.test(t)) return nome;
  return null;
}
