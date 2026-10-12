/** Leitura das mensagens do WhatsApp. Puro: sem Deno, sem rede, sem banco —
 *  roda na Edge Function e nos testes do Node (src/... importa daqui).
 *
 *  Gramática, pensada para o polegar e não para o parser:
 *
 *    mercado 42,90            despesa de R$ 42,90, categoria por palavra
 *    uber 18 ontem            data: hoje (padrão), "ontem" ou dd/mm
 *    recebi salário 5000      receita: recebi, receita, entrada, ganhei
 *    2 pizzas 50              o valor é o ÚLTIMO número: 50
 *    vincular 123456          liga o número à conta (código do app)
 *    desfazer                 apaga o último lançamento feito pelo bot
 *    ajuda
 */

export type Comando =
  | { tipo: 'vincular'; codigo: string }
  | { tipo: 'desfazer' }
  | { tipo: 'ajuda' }
  | {
      tipo: 'lancar';
      kind: 'despesa' | 'receita';
      valorCents: number;
      /** 'YYYY-MM-DD' */
      data: string;
      /** Palavras para casar com o nome da categoria (no banco). */
      palavras: string[];
      descricao: string;
    }
  | { tipo: 'nao_entendi' };

const RECEITA = new Set(['recebi', 'receita', 'recebido', 'entrada', 'entrou', 'ganhei']);
const AJUDA = new Set(['ajuda', 'help', 'menu', 'oi', 'ola', 'olá', '?', 'comandos']);
const DESFAZER = new Set(['desfazer', 'desfaz', 'apagar', 'cancelar']);

/** Valor em reais escrito à brasileira (ou com ponto decimal) -> centavos.
 *  null se o token não é um valor. */
export function valorEmCentavos(token: string): number | null {
  const t = token.toLowerCase().replace(/^r\$/, '');
  // 1.234,56 · 1234,56 · 42,9 · 42
  let m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (m) {
    const inteiro = Number(m[1].replace(/\./g, ''));
    const cent = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
    return inteiro * 100 + cent;
  }
  // 42.90 · 42.9 — ponto com 1 ou 2 casas é decimal (3 casas seria milhar,
  // e já caiu acima)
  m = /^(\d+)\.(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 100 + Number(m[2].padEnd(2, '0'));
  return null;
}

function addDias(d: string, n: number): string {
  const [a, m, dia] = d.split('-').map(Number);
  const u = new Date(Date.UTC(a, m - 1, dia) + n * 86_400_000);
  return u.toISOString().slice(0, 10);
}

/** "dd/mm" -> data no ano de hoje; se cair no futuro, ano anterior: pelo
 *  WhatsApp se registra o que já aconteceu. */
function dataDoToken(token: string, hoje: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(token);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1) return null;
  let ano = Number(hoje.slice(0, 4));
  const montar = (a: number) => {
    const ultimo = new Date(Date.UTC(a, mes, 0)).getUTCDate();
    if (dia > ultimo) return null;
    return `${a}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  };
  let d = montar(ano);
  if (d && d > hoje) d = montar(--ano);
  return d;
}

/** `hoje` é a data civil de quem manda ('YYYY-MM-DD', fuso de São Paulo). */
export function lerMensagem(texto: string, hoje: string): Comando {
  const limpo = texto.trim().replace(/\s+/g, ' ');
  const minus = limpo.toLowerCase();

  const vinc = /^vincular\s+(\d{6})$/.exec(minus);
  if (vinc) return { tipo: 'vincular', codigo: vinc[1] };
  // Código digitado errado ("vincular 12345") NUNCA vira lançamento: sem
  // isto, seria uma despesa de R$ 12.345,00 chamada "Vincular".
  if (/^vincular\b/.test(minus)) return { tipo: 'nao_entendi' };
  if (DESFAZER.has(minus)) return { tipo: 'desfazer' };
  if (AJUDA.has(minus)) return { tipo: 'ajuda' };

  // "R$ 42" vira um token só.
  const tokens = limpo.replace(/r\$\s+/gi, 'R$').split(' ').filter(Boolean);

  let kind: 'despesa' | 'receita' = 'despesa';
  let data = hoje;
  let iValor = -1;
  let valorCents = 0;
  const usados = new Set<number>();

  tokens.forEach((tok, i) => {
    const t = tok.toLowerCase();
    if (RECEITA.has(t)) {
      kind = 'receita';
      usados.add(i);
    } else if (t === 'ontem') {
      data = addDias(hoje, -1);
      usados.add(i);
    } else if (t === 'hoje') {
      usados.add(i);
    } else {
      const d = dataDoToken(t, hoje);
      if (d) {
        data = d;
        usados.add(i);
        return;
      }
      const v = valorEmCentavos(t);
      if (v !== null) {
        iValor = i;
        valorCents = v;
      }
    }
  });

  if (iValor < 0 || valorCents <= 0) return { tipo: 'nao_entendi' };
  usados.add(iValor);

  const resto = tokens.filter((_, i) => !usados.has(i));
  const descricao = resto.join(' ');
  return {
    tipo: 'lancar',
    kind,
    valorCents,
    data,
    palavras: resto.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean),
    descricao: descricao ? descricao[0].toUpperCase() + descricao.slice(1) : '',
  };
}

// --------------------------------------------------------------- respostas

export function reais(cents: number): string {
  const s = (cents / 100).toFixed(2).split('.');
  return `R$ ${s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${s[1]}`;
}

const dataCurta = (d: string, hoje: string) =>
  d === hoje ? 'hoje' : d === addDias(hoje, -1) ? 'ontem' : `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export const AJUDA_TEXTO = [
  'Mande o gasto e o valor:',
  '• mercado 42,90',
  '• uber 18 ontem',
  '• farmácia 35 05/10',
  '• recebi salário 5000',
  '',
  'A categoria vem do nome dela na mensagem. Sem casar, entra sem categoria.',
  '• desfazer — apaga o último lançamento feito por aqui',
].join('\n');

export function respostaDoLancamento(
  r: { tipo: string; valor: number; data: string; categoria: string | null; conta: string },
  hoje: string,
): string {
  const tipo = r.tipo === 'receita' ? 'Receita' : 'Despesa';
  const cat = r.categoria ? ` em ${r.categoria}` : ' sem categoria';
  return `✅ ${tipo} de ${reais(r.valor)}${cat}, ${dataCurta(r.data, hoje)}, na conta ${r.conta}.\nMande "desfazer" para apagar.`;
}
