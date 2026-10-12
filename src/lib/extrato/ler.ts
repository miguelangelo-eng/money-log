/** Extrato de banco -> linhas num formato só.
 *
 *  Três formatos reconhecidos pelo conteúdo, não pelo nome do arquivo:
 *
 *  - OFX de conta (ou de cartão, `CCSTMTRS`) — o preferido: tem id único por
 *    transação e o saldo final;
 *  - CSV da conta do Nubank: `Data,Valor,Identificador,Descrição`, data
 *    dd/mm/aaaa, valor com ponto decimal e sinal (negativo = saída);
 *  - CSV da fatura do Nubank: `date,title,amount`, data ISO, valor com
 *    vírgula decimal entre aspas e POSITIVO = gasto ("- 1.234,56" é
 *    pagamento). Não tem id: o id vem de uma impressão digital da linha.
 *
 *  Convenção de saída, igual nos três: `valorCents` negativo = dinheiro que
 *  saiu (gasto na conta ou compra no cartão), positivo = que entrou (receita,
 *  estorno, pagamento recebido pelo cartão).
 *
 *  `idExterno` é o que impede importar a mesma linha duas vezes, inclusive
 *  vinda de arquivos diferentes com períodos sobrepostos. Os CSVs e o OFX da
 *  conta do Nubank geram o MESMO id para a mesma transação, então trocar de
 *  formato no meio do caminho também não duplica.
 */

import { parse, type CivilDate } from '../civil-date';
import { parseAmount, type Cents } from '../money';
import { lerCsv } from './csv';
import { lerOfx } from './ofx';

export type Origem = 'conta' | 'cartao';

export interface LinhaExtrato {
  idExterno: string;
  data: CivilDate;
  valorCents: Cents;
  /** Texto como o banco mandou. As regras olham para ele. */
  original: string;
  /** Texto limpo, que vira a descrição do lançamento. */
  descricao: string;
  /** "Parcela 7/10" na fatura. */
  parcela: { n: number; de: number } | null;
}

export interface Extrato {
  formato: 'ofx' | 'csv';
  origem: Origem;
  /** Para a tela: "Conta Nubank (OFX)". */
  nome: string;
  linhas: LinhaExtrato[];
  saldoFinal: { cents: Cents; data: CivilDate } | null;
}

const NUBANK = '260';

const espacos = (s: string) => s.replace(/\s+/g, ' ').trim();

/** CNPJ-raiz de MEI que o banco gruda no nome: "50.853.763 Fulano". */
const semCnpjRaiz = (s: string) => s.replace(/^\d{2}\.\d{3}\.\d{3}\s+/, '');

/** O memo da conta do Nubank segue "Tipo - Nome - documento - banco - ...".
 *  Para a descrição só interessa o nome. */
const PADROES_CONTA: RegExp[] = [
  /^Transfer[êe]ncia (?:enviada|recebida)(?: pelo Pix)? - (.+?) - /i,
  /^Pagamento de boleto efetuado - (.+)$/i,
  /^Compra no d[ée]bito - (.+)$/i,
];

export function descricaoDaConta(memo: string): string {
  const m = espacos(memo);
  for (const re of PADROES_CONTA) {
    const r = re.exec(m);
    if (r) return semCnpjRaiz(espacos(r[1]));
  }
  return m;
}

/** "Dl*Uberrides" -> "Uberrides"; "EBW*Spotify - NuPay" -> "Spotify". O
 *  prefixo é do intermediário do pagamento, não da loja. */
export function descricaoDaFatura(titulo: string): { descricao: string; parcela: LinhaExtrato['parcela'] } {
  let t = espacos(titulo);
  let parcela: LinhaExtrato['parcela'] = null;
  const p = / - Parcela (\d+)\/(\d+)$/i.exec(t);
  if (p) {
    parcela = { n: Number(p[1]), de: Number(p[2]) };
    t = t.slice(0, p.index);
  }
  t = t
    .replace(/ - NuPay$/i, '')
    .replace(/^Pix no Cr[ée]dito - /i, '')
    .replace(/^(?:pg|dl|mp|ebw|pag)\s*\*\s*/i, '');
  return { descricao: semCnpjRaiz(espacos(t)) || espacos(titulo), parcela };
}

/** dd/mm/aaaa -> aaaa-mm-dd, validado. */
function dataBr(s: string): CivilDate {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`Data inválida no extrato: ${s}`);
  const d = `${m[3]}-${m[2]}-${m[1]}`;
  parse(d);
  return d;
}

function dataIso(s: string): CivilDate {
  const d = s.trim();
  parse(d);
  return d;
}

/** Valor "1.234,56" / "-150.00" / "- 1.234,56" -> centavos com sinal. */
function valor(s: string): Cents {
  const v = parseAmount(s);
  if (v === 0 && !/\d/.test(s)) throw new Error(`Valor inválido no extrato: ${s}`);
  return v;
}

const normCabecalho = (cols: string[]) =>
  cols.map((c) => c.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')).join(',');

function contaNubankCsv(linhas: string[][]): Extrato {
  const vistos = new Map<string, number>();
  return {
    formato: 'csv',
    origem: 'conta',
    nome: 'Conta Nubank (CSV)',
    saldoFinal: null,
    linhas: linhas.slice(1).map(([data, v, id, desc = '']) => {
      // O CSV repete o identificador no par do "Pix no Crédito" (entrada e
      // saída). O OFX distingue a segunda com o sufixo ":reversal"; aqui
      // fazemos igual, para os dois formatos darem os mesmos ids.
      const n = (vistos.get(id) ?? 0) + 1;
      vistos.set(id, n);
      const fitid = n === 1 ? id : n === 2 ? `${id}:reversal` : `${id}:${n}`;
      return {
        idExterno: `conta:${NUBANK}:${fitid}`,
        data: dataBr(data),
        valorCents: valor(v),
        original: espacos(desc),
        descricao: descricaoDaConta(desc),
        parcela: null,
      };
    }),
  };
}

function faturaNubankCsv(linhas: string[][]): Extrato {
  const vistos = new Map<string, number>();
  return {
    formato: 'csv',
    origem: 'cartao',
    nome: 'Fatura Nubank (CSV)',
    saldoFinal: null,
    linhas: linhas.slice(1).map(([data, titulo, v]) => {
      const d = dataIso(data);
      const valorCents = -valor(v); // na fatura, positivo é gasto
      const original = espacos(titulo);
      // Sem id no arquivo: data + valor + texto, e a ordem entre linhas
      // idênticas (duas corridas iguais no mesmo dia são duas compras).
      const chave = `${d}|${valorCents}|${original}`;
      const n = (vistos.get(chave) ?? 0) + 1;
      vistos.set(chave, n);
      return {
        idExterno: `cartao:${NUBANK}:${chave}#${n}`,
        data: d,
        valorCents,
        original,
        ...descricaoDaFatura(titulo),
      };
    }),
  };
}

function ofx(texto: string): Extrato {
  const o = lerOfx(texto);
  const origem: Origem = o.cartao ? 'cartao' : 'conta';
  const banco = o.bancoId ?? 'ofx';
  const nubank = banco === NUBANK;
  const vistos = new Map<string, number>();
  return {
    formato: 'ofx',
    origem,
    nome: `${origem === 'conta' ? 'Conta' : 'Cartão'}${nubank ? ' Nubank' : ''} (OFX)`,
    saldoFinal: o.saldoFinal,
    linhas: o.transacoes.map((t) => {
      let id = t.fitid;
      if (!id) {
        const chave = `${t.data}|${t.valorCents}|${t.memo}`;
        const n = (vistos.get(chave) ?? 0) + 1;
        vistos.set(chave, n);
        id = `${chave}#${n}`;
      }
      const base = { idExterno: `${origem}:${banco}:${id}`, data: t.data, valorCents: t.valorCents, original: t.memo };
      if (origem === 'cartao') return { ...base, ...descricaoDaFatura(t.memo) };
      return { ...base, descricao: nubank ? descricaoDaConta(t.memo) : t.memo, parcela: null };
    }),
  };
}

/** Lê o arquivo e diz o que ele é. Erro com mensagem para a tela quando o
 *  formato não é reconhecido. */
export function lerExtrato(texto: string): Extrato {
  if (/<OFX>/i.test(texto) || /^\s*OFXHEADER/i.test(texto)) return ofx(texto);

  const linhas = lerCsv(texto);
  const cab = linhas.length > 0 ? normCabecalho(linhas[0]) : '';
  if (cab === 'data,valor,identificador,descricao') return contaNubankCsv(linhas);
  if (cab === 'date,title,amount') return faturaNubankCsv(linhas);

  throw new Error(
    'Formato não reconhecido. Use o OFX ou o CSV do extrato da conta, ou o CSV da fatura do cartão.',
  );
}
