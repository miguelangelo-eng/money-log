/** Data civil: um dia no calendário, sem hora e sem fuso.
 *
 *  Por que não usar `Date`: `new Date('2026-10-01')` é interpretado como UTC
 *  meia-noite, e em America/Sao_Paulo (UTC−3) isso é 30 de setembro às 21h.
 *  Um lançamento do dia 1º cairia no mês anterior e o relatório mensal
 *  fecharia diferente do extrato. É o mesmo motivo pelo qual `competencia` é
 *  `date` no banco e não `timestamptz` — ver a nota [D] em replica/schema.sql.
 *
 *  Representação: string 'YYYY-MM-DD'. É o que o SQLite guarda, é ordenável
 *  como texto, e não tem fuso para dar errado.
 */

export type CivilDate = string; // 'YYYY-MM-DD'

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Parts {
  year: number;
  /** 1–12, não 0–11. O mês base-zero do `Date` é a origem de metade dos bugs
   *  de data em JavaScript, e aqui ele não entra. */
  month: number;
  day: number;
}

export function parse(d: CivilDate): Parts {
  const m = RE.exec(d);
  if (!m) throw new RangeError(`data civil inválida: ${d}`);
  const parts = { year: +m[1], month: +m[2], day: +m[3] };
  if (parts.month < 1 || parts.month > 12) {
    throw new RangeError(`mês fora de faixa: ${d}`);
  }
  if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
    throw new RangeError(`dia não existe nesse mês: ${d}`);
  }
  return parts;
}

export function format({ year, month, day }: Parts): CivilDate {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  // Regra gregoriana completa: 2000 é bissexto, 1900 não é, 2100 não será.
  if (month === 2) {
    const bissexto = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return bissexto ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Grampeia o dia ao último dia existente do mês.
 *
 *  É a função que resolve o bug que só aparece em fevereiro: cartão com
 *  fechamento no dia 31 não tem dia 31 em fevereiro, abril, junho, setembro
 *  nem novembro. Sem isto, a geração de fatura produz data inválida ou pula
 *  um mês — e o sintoma chega seis meses depois do lançamento.
 */
export function clampDay(year: number, month: number, day: number): CivilDate {
  return format({ year, month, day: Math.min(day, daysInMonth(year, month)) });
}

/** Soma meses preservando a intenção do dia (grampeado ao fim do mês). */
export function addMonths(d: CivilDate, n: number): CivilDate {
  const { year, month, day } = parse(d);
  const zero = year * 12 + (month - 1) + n;
  return clampDay(Math.floor(zero / 12), (zero % 12) + 1, day);
}

export function addDays(d: CivilDate, n: number): CivilDate {
  const { year, month, day } = parse(d);
  // Aritmética via UTC é segura aqui porque entra e sai no mesmo fuso fixo.
  const t = Date.UTC(year, month - 1, day) + n * 86_400_000;
  const u = new Date(t);
  return format({
    year: u.getUTCFullYear(),
    month: u.getUTCMonth() + 1,
    day: u.getUTCDate(),
  });
}

/** Ordenação lexicográfica funciona por construção no formato ISO. */
export function compare(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a: CivilDate, b: CivilDate) => compare(a, b) < 0;
export const isAfter = (a: CivilDate, b: CivilDate) => compare(a, b) > 0;
export const isSameOrBefore = (a: CivilDate, b: CivilDate) => compare(a, b) <= 0;

/** Primeiro dia do mês — o formato que `invoices.mes_referencia` guarda. */
export function monthStart(d: CivilDate): CivilDate {
  const { year, month } = parse(d);
  return format({ year, month, day: 1 });
}

/** Data civil -> `Date` à MEIA-NOITE LOCAL do dia, para o seletor nativo.
 *
 *  Construído com o construtor de componentes (ano, mês, dia), que é local.
 *  `new Date('2026-10-01')` seria meia-noite UTC — 21h do dia 30 em São
 *  Paulo — e o seletor abriria no dia anterior. */
export function toLocalDate(d: CivilDate): Date {
  const { year, month, day } = parse(d);
  return new Date(year, month - 1, day);
}

/** Hoje, no fuso do aparelho, como data civil.
 *  Usa os getters locais de propósito: "hoje" para o usuário é o dia do
 *  relógio dele, não o dia em UTC. */
export function today(now = new Date()): CivilDate {
  return format({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}
