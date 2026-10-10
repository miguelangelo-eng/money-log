/** Dinheiro em centavos inteiros. Nunca float, nunca `number` fracionário.
 *
 *  0.1 + 0.2 === 0.30000000000000004. Num app de controle financeiro isso
 *  vira um saldo que não fecha com o extrato e destrói a confiança no app —
 *  que é a única coisa que ele tem para oferecer.
 */

export type Cents = number; // inteiro

export function assertCents(v: number): Cents {
  if (!Number.isInteger(v)) {
    throw new TypeError(`valor monetário deve ser inteiro em centavos: ${v}`);
  }
  if (!Number.isSafeInteger(v)) {
    throw new RangeError(`valor monetário fora da faixa segura: ${v}`);
  }
  return v;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos -> 'R$ 1.234,56'.
 *  Sempre por Intl: separador de milhar e vírgula decimal não se improvisam
 *  com template string nem com toFixed. */
export function formatCents(cents: Cents, currency = 'BRL'): string {
  const n = assertCents(cents) / 100;
  if (currency === 'BRL') return BRL.format(n);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(n);
}

/** Com sinal explícito. A cor NUNCA é a única portadora do significado —
 *  ver a regra em replica/design/components.md. O − é U+2212 (menos
 *  matemático), não hífen: alinha com os dígitos tabulares. */
export function formatSigned(cents: Cents, kind: 'despesa' | 'receita'): string {
  const sinal = kind === 'despesa' ? '−' : '+';
  return `${sinal} ${formatCents(Math.abs(cents))}`;
}

/** Texto digitado pelo usuário -> centavos.
 *
 *  Aceita o que um teclado brasileiro produz: '1.234,56', '1234,56', '1234.56',
 *  'R$ 1.234,56'. A heurística do separador: o ÚLTIMO separador presente é o
 *  decimal se tiver 1 ou 2 dígitos depois dele; qualquer outro é milhar.
 */
export function parseAmount(input: string): Cents {
  const limpo = input.replace(/[^\d.,-]/g, '').trim();
  if (limpo === '' || limpo === '-') return 0;

  const negativo = limpo.startsWith('-');
  const corpo = negativo ? limpo.slice(1) : limpo;

  const ultimoSep = Math.max(corpo.lastIndexOf(','), corpo.lastIndexOf('.'));
  let inteiros: string;
  let decimais = '';

  if (ultimoSep === -1) {
    inteiros = corpo;
  } else {
    const cauda = corpo.slice(ultimoSep + 1);
    if (cauda.length >= 1 && cauda.length <= 2 && /^\d+$/.test(cauda)) {
      inteiros = corpo.slice(0, ultimoSep);
      decimais = cauda;
    } else {
      inteiros = corpo; // separador de milhar apenas
    }
  }

  const soDigitos = (s: string) => s.replace(/\D/g, '');
  const cents =
    Number(soDigitos(inteiros) || '0') * 100 +
    Number(soDigitos(decimais).padEnd(2, '0').slice(0, 2) || '0');

  return assertCents(negativo ? -cents : cents);
}

/** Entrada por teclado numérico, preenchendo da direita para a esquerda:
 *  digitar 4, 2, 9, 0 produz 0,04 -> 0,42 -> 4,29 -> 42,90.
 *  É como todo app de banco se comporta e é o que o dedo espera. */
export function pushDigit(atual: Cents, digito: string): Cents {
  if (!/^\d$/.test(digito)) return atual;
  const proximo = atual * 10 + Number(digito);
  return Number.isSafeInteger(proximo) ? proximo : atual;
}

export function popDigit(atual: Cents): Cents {
  return Math.trunc(atual / 10);
}

/** Divide um total em N parcelas sem perder nem criar centavo.
 *
 *  R$ 100,00 em 3x = 3334 + 3333 + 3333 = 10000. O resto vai nas PRIMEIRAS
 *  parcelas, que é a convenção do comércio brasileiro: a primeira é a mais
 *  cara, nunca a última.
 *
 *  A propriedade que importa, e que o teste tem que fixar:
 *      split(total, n).reduce((a, b) => a + b) === total   para todo n >= 1
 */
export function splitInstallments(total: Cents, n: number): Cents[] {
  assertCents(total);
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`número de parcelas inválido: ${n}`);
  }
  const sinal = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const resto = abs - base * n; // 0 <= resto < n
  return Array.from({ length: n }, (_, i) =>
    sinal * (base + (i < resto ? 1 : 0)),
  );
}

export const sum = (xs: Cents[]): Cents => xs.reduce((a, b) => a + b, 0);
