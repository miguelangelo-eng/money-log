/** Camada de dados. As telas só falam com estas funções — nenhuma tela monta
 *  query. Quando a sincronização com o Supabase entrar (M1), o que muda é a
 *  implementação daqui; assinatura e telas ficam iguais.
 *
 *  Todas as leituras filtram `deletedAt is null`: soft delete existe para o
 *  sync poder propagar a exclusão, e esquecer esse filtro é como um lançamento
 *  apagado reaparece na lista.
 */

import * as Crypto from 'expo-crypto';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  accounts,
  categories,
  profiles,
  transactions,
  type Account,
  type Category,
  type Transaction,
} from '@/db/schema';
import { clampDay, daysInMonth, monthStart, parse, today } from '@/lib/civil-date';
import type { Cents } from '@/lib/money';

/** Id gerado no cliente, sempre. É o que torna o push do sync idempotente:
 *  reenviar o mesmo lote é upsert na mesma chave, não duplicata. */
export const newId = () => Crypto.randomUUID();

const nowIso = () => new Date().toISOString();

/** Usuário local, enquanto não há autenticação.
 *
 *  TODO(auth): quando o Supabase Auth entrar, este id passa a ser o
 *  `auth.uid()` e esta função some. O schema já está escopado por user_id, então
 *  a troca é de valor, não de estrutura — nenhuma query muda.
 */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

/** Intervalo [primeiro, último] dia de um mês, como data civil. */
export function monthRange(anyDayOfMonth: string): [string, string] {
  const { year, month } = parse(anyDayOfMonth);
  return [monthStart(anyDayOfMonth), clampDay(year, month, daysInMonth(year, month))];
}

// ---------------------------------------------------------------------------
// Semente
// ---------------------------------------------------------------------------

/** Categorias padrão. Nomes e cores são nossos — a lista do original não foi
 *  copiada palavra por palavra. Cores saem dos 8 slots categóricos validados,
 *  em ordem fixa (ver src/design/tokens.ts). */
const CATEGORIAS_PADRAO: Array<[string, 'despesa' | 'receita', string, string]> = [
  ['Mercado', 'despesa', 'cart', '#2a78d6'],
  ['Moradia', 'despesa', 'home', '#eb6834'],
  ['Transporte', 'despesa', 'car', '#1baf7a'],
  ['Alimentação fora', 'despesa', 'utensils', '#eda100'],
  ['Saúde', 'despesa', 'heart', '#e87ba4'],
  ['Lazer', 'despesa', 'smile', '#008300'],
  ['Assinaturas', 'despesa', 'repeat', '#4a3aa7'],
  ['Outros gastos', 'despesa', 'tag', '#e34948'],
  ['Salário', 'receita', 'briefcase', '#008300'],
  ['Outras entradas', 'receita', 'plus', '#2a78d6'],
];

/** Idempotente: pode rodar a cada abertura do app. */
export async function ensureSeed(userId = LOCAL_USER_ID): Promise<void> {
  const ts = nowIso();

  const perfil = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (perfil.length === 0) {
    await db.insert(profiles).values({
      id: userId,
      nome: 'Eu',
      currency: 'BRL',
      createdAt: ts,
      updatedAt: ts,
    });
  }

  const cats = await db.select().from(categories).where(eq(categories.userId, userId)).limit(1);
  if (cats.length === 0) {
    await db.insert(categories).values(
      CATEGORIAS_PADRAO.map(([nome, tipo, icone, cor]) => ({
        id: newId(),
        userId,
        nome,
        tipo,
        icone,
        cor,
        createdAt: ts,
        updatedAt: ts,
      })),
    );
  }

  const contas = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
  if (contas.length === 0) {
    await db.insert(accounts).values({
      id: newId(),
      userId,
      nome: 'Carteira',
      tipo: 'dinheiro',
      icone: 'wallet',
      saldoInicialCents: 0,
      createdAt: ts,
      updatedAt: ts,
    });
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function listAccounts(userId = LOCAL_USER_ID): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .orderBy(accounts.nome);
}

export async function listCategories(
  tipo?: 'despesa' | 'receita',
  userId = LOCAL_USER_ID,
): Promise<Category[]> {
  const cond = [eq(categories.userId, userId), isNull(categories.deletedAt)];
  if (tipo) cond.push(eq(categories.tipo, tipo));
  return db.select().from(categories).where(and(...cond)).orderBy(categories.nome);
}

export async function listByMonth(
  mes: string,
  userId = LOCAL_USER_ID,
): Promise<Transaction[]> {
  const [ini, fim] = monthRange(mes);
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        gte(transactions.competencia, ini),
        lte(transactions.competencia, fim),
      ),
    )
    .orderBy(desc(transactions.competencia), desc(transactions.createdAt));
}

export interface MonthTotals {
  receitaCents: Cents;
  despesaCents: Cents;
}

/** Totais do mês. Transferência NÃO entra: ela move dinheiro entre contas do
 *  próprio usuário e contá-la duplicaria o valor — é o erro clássico desta
 *  classe de app, e está travado também por check constraint no Postgres. */
export async function monthTotals(
  mes: string,
  userId = LOCAL_USER_ID,
): Promise<MonthTotals> {
  const [ini, fim] = monthRange(mes);
  const rows = await db
    .select({
      kind: transactions.kind,
      total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        gte(transactions.competencia, ini),
        lte(transactions.competencia, fim),
      ),
    )
    .groupBy(transactions.kind);

  const get = (k: string) => Number(rows.find((r) => r.kind === k)?.total ?? 0);
  return { receitaCents: get('receita'), despesaCents: get('despesa') };
}

export interface CategorySlice {
  categoryId: string | null;
  nome: string;
  cor: string;
  totalCents: Cents;
}

/** Gastos por categoria no mês, do maior para o menor. Alimenta a rosca e a
 *  lista ranqueada da S15. Só despesa. */
export async function expensesByCategory(
  mes: string,
  userId = LOCAL_USER_ID,
): Promise<CategorySlice[]> {
  const [ini, fim] = monthRange(mes);
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      nome: categories.nome,
      cor: categories.cor,
      totalCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.kind, 'despesa'),
        gte(transactions.competencia, ini),
        lte(transactions.competencia, fim),
      ),
    )
    .groupBy(transactions.categoryId, categories.nome, categories.cor)
    .orderBy(sql`sum(${transactions.amountCents}) desc`);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    // Despesa sem categoria é possível (o campo é opcional): rotular, não ocultar.
    nome: r.nome ?? 'Sem categoria',
    cor: r.cor ?? '#898781',
    totalCents: Number(r.totalCents),
  }));
}

/** Saldo por conta: saldo inicial + receitas − despesas + entradas de
 *  transferência − saídas de transferência. Só o que está marcado como pago;
 *  previsto não é saldo. */
export async function accountBalances(
  userId = LOCAL_USER_ID,
): Promise<Array<Account & { saldoCents: Cents }>> {
  const contas = await listAccounts(userId);
  const rows = await db
    .select({
      accountId: transactions.accountId,
      transferTo: transactions.transferAccountId,
      kind: transactions.kind,
      total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.pago, true),
      ),
    )
    .groupBy(transactions.accountId, transactions.transferAccountId, transactions.kind);

  return contas.map((c) => {
    let saldo = c.saldoInicialCents;
    for (const r of rows) {
      const total = Number(r.total);
      if (r.accountId === c.id) {
        if (r.kind === 'receita') saldo += total;
        if (r.kind === 'despesa') saldo -= total;
        if (r.kind === 'transferencia') saldo -= total;
      }
      if (r.transferTo === c.id && r.kind === 'transferencia') saldo += total;
    }
    return { ...c, saldoCents: saldo };
  });
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export interface NovaDespesa {
  amountCents: Cents;
  competencia?: string;
  descricao?: string;
  categoryId?: string | null;
  accountId: string;
  pago?: boolean;
}

/** Insere uma despesa. Data futura vira automaticamente "não pago": é
 *  previsto, não realizado — e a UI avisa isso ao usuário. */
export async function addExpense(
  input: NovaDespesa,
  userId = LOCAL_USER_ID,
): Promise<string> {
  const ts = nowIso();
  const competencia = input.competencia ?? today();
  const pago = input.pago ?? competencia <= today();
  const id = newId();

  await db.insert(transactions).values({
    id,
    userId,
    kind: 'despesa',
    amountCents: input.amountCents,
    currency: 'BRL',
    competencia,
    descricao: input.descricao ?? '',
    categoryId: input.categoryId ?? null,
    accountId: input.accountId,
    pago,
    pagoEm: pago ? competencia : null,
    createdAt: ts,
    updatedAt: ts,
  });
  return id;
}

export async function addIncome(
  input: NovaDespesa,
  userId = LOCAL_USER_ID,
): Promise<string> {
  const ts = nowIso();
  const competencia = input.competencia ?? today();
  const pago = input.pago ?? competencia <= today();
  const id = newId();

  await db.insert(transactions).values({
    id,
    userId,
    kind: 'receita',
    amountCents: input.amountCents,
    currency: 'BRL',
    competencia,
    descricao: input.descricao ?? '',
    categoryId: input.categoryId ?? null,
    accountId: input.accountId,
    pago,
    pagoEm: pago ? competencia : null,
    createdAt: ts,
    updatedAt: ts,
  });
  return id;
}

/** Exclusão é SOFT. Nunca `delete from` em tabela sincronizada. */
export async function softDelete(id: string, userId = LOCAL_USER_ID): Promise<void> {
  const ts = nowIso();
  await db
    .update(transactions)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
}
