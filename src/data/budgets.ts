/** Orçamento: limite de gasto por categoria (S16).
 *
 *  Dois tipos de limite, como o schema prevê (`budgets.mes_referencia`):
 *    recorrente  mes_referencia nulo — vale para todo mês;
 *    do mês      mes_referencia = dia 1 do mês — vale só nele e tem
 *                prioridade sobre o recorrente ("em dezembro, mais").
 *
 *  Gasto = todas as despesas da categoria no mês (conta e cartão, pagas e
 *  previstas), o mesmo número do relatório por categoria. Transferência e
 *  pagamento de fatura não são despesa e não entram.
 *
 *  Os índices únicos do SQLite não ignoram linha excluída. Por isso remover
 *  é soft delete e definir de novo REAPROVEITA a linha (mesmo id), em vez de
 *  inserir outra e esbarrar no índice. O id estável também é o que o sync
 *  espera: é a mesma linha mudando, não uma nova.
 */

import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { budgets, categories, transactions, type Category } from '@/db/schema';
import { monthStart, type CivilDate } from '@/lib/civil-date';
import type { Cents } from '@/lib/money';

import type { SyncDb } from './cards';
import { monthRange } from './ledger-repo';

export interface LimiteDoMes {
  categoria: Category;
  gastoCents: Cents;
  /** null = categoria sem limite. */
  limiteCents: Cents | null;
  /** De onde veio o limite que vale neste mês. */
  origem: 'mes' | 'recorrente' | null;
}

export function createBudgetsRepo({
  db,
  newId,
  nowIso,
  userId,
}: {
  db: SyncDb;
  newId: () => string;
  nowIso: () => string;
  userId: string;
}) {
  function categoriaDeDespesa(categoryId: string): Category {
    const c = db
      .select()
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId), isNull(categories.deletedAt)))
      .get();
    if (!c) throw new Error('Categoria não encontrada.');
    if (c.tipo !== 'despesa') throw new Error('Limite de gasto é só para categoria de despesa.');
    return c;
  }

  /** A linha do limite, VIVA OU EXCLUÍDA — para reaproveitar. */
  function linha(categoryId: string, mes: CivilDate | null) {
    return db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.userId, userId),
          eq(budgets.categoryId, categoryId),
          mes === null ? isNull(budgets.mesReferencia) : eq(budgets.mesReferencia, mes),
        ),
      )
      .get();
  }

  return {
    /** Todas as categorias de despesa do usuário, com o gasto do mês e o
     *  limite que vale nele (o do mês, senão o recorrente, senão nenhum). */
    async doMes(mes: CivilDate): Promise<LimiteDoMes[]> {
      const ref = monthStart(mes);
      const [ini, fim] = monthRange(mes);

      const cats = db
        .select()
        .from(categories)
        .where(
          and(eq(categories.userId, userId), eq(categories.tipo, 'despesa'), isNull(categories.deletedAt)),
        )
        .orderBy(categories.nome)
        .all();

      const gastos = db
        .select({
          categoryId: transactions.categoryId,
          total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            isNull(transactions.deletedAt),
            eq(transactions.kind, 'despesa'),
            gte(transactions.competencia, ini),
            lte(transactions.competencia, fim),
          ),
        )
        .groupBy(transactions.categoryId)
        .all();
      const gastoPor = new Map(gastos.map((g) => [g.categoryId, Number(g.total)]));

      const limites = db
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.userId, userId),
            isNull(budgets.deletedAt),
            or(isNull(budgets.mesReferencia), eq(budgets.mesReferencia, ref)),
          ),
        )
        .all();

      return cats.map((categoria) => {
        const doMes = limites.find((l) => l.categoryId === categoria.id && l.mesReferencia === ref);
        const recorrente = limites.find((l) => l.categoryId === categoria.id && l.mesReferencia === null);
        const vale = doMes ?? recorrente;
        return {
          categoria,
          gastoCents: gastoPor.get(categoria.id) ?? 0,
          limiteCents: vale?.limiteCents ?? null,
          origem: doMes ? 'mes' : recorrente ? 'recorrente' : null,
        };
      });
    },

    /** Define (cria ou altera) um limite. `mes` nulo = todo mês; senão,
     *  qualquer dia do mês (é normalizado para o dia 1). */
    async definir(input: { categoryId: string; limiteCents: Cents; mes: CivilDate | null }): Promise<string> {
      if (!Number.isInteger(input.limiteCents) || input.limiteCents <= 0) {
        throw new Error('Informe um limite maior que zero.');
      }
      categoriaDeDespesa(input.categoryId);
      const mes = input.mes === null ? null : monthStart(input.mes);
      const ts = nowIso();

      const existente = linha(input.categoryId, mes);
      if (existente) {
        db.update(budgets)
          .set({ limiteCents: input.limiteCents, deletedAt: null, updatedAt: ts })
          .where(eq(budgets.id, existente.id))
          .run();
        return existente.id;
      }

      const id = newId();
      db.insert(budgets)
        .values({
          id,
          userId,
          categoryId: input.categoryId,
          mesReferencia: mes,
          limiteCents: input.limiteCents,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    },

    /** Remove um limite (soft delete). Remover o do mês faz o recorrente
     *  voltar a valer naquele mês; remover o recorrente não mexe nos do mês. */
    async remover(input: { categoryId: string; mes: CivilDate | null }): Promise<void> {
      const mes = input.mes === null ? null : monthStart(input.mes);
      const existente = linha(input.categoryId, mes);
      if (!existente || existente.deletedAt) return;
      const ts = nowIso();
      db.update(budgets).set({ deletedAt: ts, updatedAt: ts }).where(eq(budgets.id, existente.id)).run();
    },
  };
}

export type BudgetsRepo = ReturnType<typeof createBudgetsRepo>;
