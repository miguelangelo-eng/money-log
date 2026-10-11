/** Contas, categorias e lançamentos — tudo que não é específico de cartão.
 *
 *  Mesmo padrão de ./cards.ts: banco, gerador de id, relógio e usuário chegam
 *  por injeção, para que ledger-repo.test.ts rode estas funções contra SQLite
 *  real (node:sqlite) com a migração real. src/data/ledger.ts só liga isto ao
 *  banco do aparelho e reexporta os mesmos nomes que as telas já usam.
 *
 *  Escrita que precisa ser atômica usa `db.transaction` com callback
 *  SÍNCRONO: o driver do expo-sqlite no Drizzle é 'sync', e callback async
 *  dentro da transação quebra em tempo de execução, não no typecheck.
 *
 *  Toda leitura filtra `deletedAt is null` (soft delete existe para o sync
 *  propagar a exclusão) e toda operação filtra por userId (a mesma regra do
 *  RLS do Postgres, aplicada na camada de dados).
 */

import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import {
  accounts,
  categories,
  invoices,
  profiles,
  transactions,
  type Account,
  type Category,
  type Transaction,
} from '@/db/schema';
import { saldoDaConta, type LinhaAgregada } from '@/lib/balance';
import { clampDay, daysInMonth, monthStart, parse, type CivilDate } from '@/lib/civil-date';
import type { Cents } from '@/lib/money';

import type { SyncDb } from './cards';

export interface LedgerDeps {
  db: SyncDb;
  newId: () => string;
  nowIso: () => string;
  userId: string;
  /** "Hoje" do usuário. Injetado para os testes fixarem a data. */
  hoje: () => CivilDate;
}

export const TIPOS_CONTA = ['corrente', 'poupanca', 'dinheiro', 'investimento'] as const;
export type TipoConta = (typeof TIPOS_CONTA)[number];

export const ROTULO_TIPO_CONTA: Record<TipoConta, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  dinheiro: 'Dinheiro',
  investimento: 'Investimento',
};

/** Intervalo [primeiro, último] dia de um mês, como data civil. */
export function monthRange(anyDayOfMonth: string): [string, string] {
  const { year, month } = parse(anyDayOfMonth);
  return [monthStart(anyDayOfMonth), clampDay(year, month, daysInMonth(year, month))];
}

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

export interface MonthTotals {
  receitaCents: Cents;
  despesaCents: Cents;
}

export interface CategorySlice {
  categoryId: string | null;
  nome: string;
  cor: string;
  totalCents: Cents;
}

export interface NovaDespesa {
  amountCents: Cents;
  competencia?: CivilDate;
  descricao?: string;
  categoryId?: string | null;
  accountId: string;
  pago?: boolean;
}

export interface NovaTransferencia {
  amountCents: Cents;
  competencia?: CivilDate;
  deContaId: string;
  paraContaId: string;
  descricao?: string;
}

/** Campos editáveis. O que cada tipo de lançamento aceita é decidido em
 *  updateTransaction, não aqui. */
export interface EdicaoLancamento {
  amountCents?: Cents;
  competencia?: CivilDate;
  descricao?: string;
  categoryId?: string | null;
  accountId?: string;
  transferAccountId?: string;
}

export type ResultadoExclusao =
  | { tipo: 'simples' }
  | { tipo: 'compra'; parcelas: number }
  | { tipo: 'pagamento_desfeito' };

function validarValor(v: Cents) {
  if (!Number.isInteger(v) || v <= 0) throw new Error('Informe um valor maior que zero.');
}

function validarData(d: CivilDate) {
  try {
    parse(d);
  } catch {
    throw new Error('Data inválida.');
  }
}

const mesPorExtenso = (d: CivilDate) =>
  [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ][parse(d).month - 1];

export function createLedgerRepo({ db, newId, nowIso, userId: padrao, hoje }: LedgerDeps) {
  type Q = Pick<SyncDb, 'select' | 'insert' | 'update'>;

  // ------------------------------------------------------------ verificações

  function contaDoUsuario(q: Q, id: string, userId: string): Account {
    const c = q
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
      .get();
    if (!c) throw new Error('Conta não encontrada.');
    return c;
  }

  /** Categoria tem que ser do usuário e do mesmo tipo do lançamento — a
   *  mesma regra do trigger [T] do Postgres. Sem isso, um gasto poderia ser
   *  classificado como "Salário" e o relatório mentiria. */
  function categoriaValida(q: Q, id: string | null | undefined, tipo: 'despesa' | 'receita', userId: string) {
    if (!id) return;
    const c = q
      .select({ tipo: categories.tipo })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId), isNull(categories.deletedAt)))
      .get();
    if (!c) throw new Error('Categoria não encontrada.');
    if (c.tipo !== tipo) throw new Error(`Essa categoria é de ${c.tipo}, não de ${tipo}.`);
  }

  function buscar(q: Q, id: string, userId: string): Transaction | undefined {
    return q
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
      .get();
  }

  /** Data futura é previsto, não realizado. */
  const pagoPelaData = (competencia: CivilDate) => competencia <= hoje();

  function inserirSimples(kind: 'despesa' | 'receita', input: NovaDespesa, userId: string): string {
    validarValor(input.amountCents);
    const competencia = input.competencia ?? hoje();
    validarData(competencia);

    return db.transaction((tx) => {
      contaDoUsuario(tx, input.accountId, userId);
      categoriaValida(tx, input.categoryId, kind, userId);

      const pago = input.pago ?? pagoPelaData(competencia);
      const ts = nowIso();
      const id = newId();
      tx.insert(transactions)
        .values({
          id,
          userId,
          kind,
          amountCents: input.amountCents,
          currency: 'BRL',
          competencia,
          descricao: (input.descricao ?? '').trim(),
          categoryId: input.categoryId ?? null,
          accountId: input.accountId,
          pago,
          pagoEm: pago ? competencia : null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    });
  }

  // --------------------------------------------------------------------- API

  return {
    /** Idempotente: pode rodar a cada abertura do app. */
    async ensureSeed(userId = padrao): Promise<void> {
      const ts = nowIso();

      if (!db.select().from(profiles).where(eq(profiles.id, userId)).get()) {
        db.insert(profiles)
          .values({ id: userId, nome: 'Eu', currency: 'BRL', createdAt: ts, updatedAt: ts })
          .run();
      }

      if (!db.select().from(categories).where(eq(categories.userId, userId)).get()) {
        db.insert(categories)
          .values(
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
          )
          .run();
      }

      if (!db.select().from(accounts).where(eq(accounts.userId, userId)).get()) {
        db.insert(accounts)
          .values({
            id: newId(),
            userId,
            nome: 'Carteira',
            tipo: 'dinheiro',
            icone: 'wallet',
            saldoInicialCents: 0,
            createdAt: ts,
            updatedAt: ts,
          })
          .run();
      }
    },

    // ------------------------------------------------------------- leitura

    async listAccounts(userId = padrao): Promise<Account[]> {
      return db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
        .orderBy(accounts.nome)
        .all();
    },

    async listCategories(tipo?: 'despesa' | 'receita', userId = padrao): Promise<Category[]> {
      const cond = [eq(categories.userId, userId), isNull(categories.deletedAt)];
      if (tipo) cond.push(eq(categories.tipo, tipo));
      return db.select().from(categories).where(and(...cond)).orderBy(categories.nome).all();
    },

    async listByMonth(mes: CivilDate, userId = padrao): Promise<Transaction[]> {
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
        .orderBy(desc(transactions.competencia), desc(transactions.createdAt))
        .all();
    },

    async getTransaction(id: string, userId = padrao): Promise<Transaction | null> {
      return buscar(db, id, userId) ?? null;
    },

    /** Totais do mês. Transferência e pagamento de fatura NÃO entram: a
     *  primeira só move dinheiro entre contas do próprio usuário, e o segundo
     *  quita uma compra que já contou como despesa na data dela. */
    async monthTotals(mes: CivilDate, userId = padrao): Promise<MonthTotals> {
      const [ini, fim] = monthRange(mes);
      const rows = db
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
        .groupBy(transactions.kind)
        .all();

      const get = (k: string) => Number(rows.find((r) => r.kind === k)?.total ?? 0);
      return { receitaCents: get('receita'), despesaCents: get('despesa') };
    },

    /** Gastos por categoria no mês, do maior para o menor. Só despesa. */
    async expensesByCategory(mes: CivilDate, userId = padrao): Promise<CategorySlice[]> {
      const [ini, fim] = monthRange(mes);
      const rows = db
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
        .orderBy(sql`sum(${transactions.amountCents}) desc`)
        .all();

      return rows.map((r) => ({
        categoryId: r.categoryId,
        // Despesa sem categoria é possível (o campo é opcional): rotular, não ocultar.
        nome: r.nome ?? 'Sem categoria',
        cor: r.cor ?? '#898781',
        totalCents: Number(r.totalCents),
      }));
    },

    /** Saldo por conta. A consulta só agrega; a regra de sinal e de "pago"
     *  mora em src/lib/balance.ts. */
    async accountBalances(userId = padrao): Promise<Array<Account & { saldoCents: Cents }>> {
      const contas = db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
        .orderBy(accounts.nome)
        .all();

      const rows = db
        .select({
          accountId: transactions.accountId,
          transferAccountId: transactions.transferAccountId,
          kind: transactions.kind,
          pago: transactions.pago,
          total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
        })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
        .groupBy(
          transactions.accountId,
          transactions.transferAccountId,
          transactions.kind,
          transactions.pago,
        )
        .all();

      const linhas: LinhaAgregada[] = rows.map((r) => ({
        accountId: r.accountId,
        transferAccountId: r.transferAccountId,
        kind: r.kind,
        pago: Boolean(r.pago),
        total: Number(r.total),
      }));

      return contas.map((c) => ({
        ...c,
        saldoCents: saldoDaConta(c.id, c.saldoInicialCents, linhas),
      }));
    },

    // ---------------------------------------------------- contas e categorias

    async addAccount(
      input: { nome: string; tipo: TipoConta; saldoInicialCents: Cents },
      userId = padrao,
    ): Promise<string> {
      const nome = input.nome.trim();
      if (nome === '') throw new Error('Dê um nome à conta.');
      if (!TIPOS_CONTA.includes(input.tipo)) throw new Error('Tipo de conta inválido.');
      if (!Number.isInteger(input.saldoInicialCents)) throw new Error('Saldo inicial inválido.');

      // O índice único do SQLite diferencia maiúsculas; "Nubank" e "nubank"
      // como duas contas só confundem.
      const repetida = db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            isNull(accounts.deletedAt),
            sql`lower(${accounts.nome}) = lower(${nome})`,
          ),
        )
        .get();
      if (repetida) throw new Error(`Já existe uma conta chamada "${nome}".`);

      const ts = nowIso();
      const id = newId();
      db.insert(accounts)
        .values({
          id,
          userId,
          nome,
          tipo: input.tipo,
          icone: 'wallet',
          saldoInicialCents: input.saldoInicialCents,
          arquivada: false,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    },

    async addCategory(
      input: { nome: string; tipo: 'despesa' | 'receita'; cor: string },
      userId = padrao,
    ): Promise<string> {
      const nome = input.nome.trim();
      if (nome === '') throw new Error('Dê um nome à categoria.');
      if (input.tipo !== 'despesa' && input.tipo !== 'receita') {
        throw new Error('Tipo de categoria inválido.');
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(input.cor)) throw new Error('Cor inválida.');

      const repetida = db
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.userId, userId),
            eq(categories.tipo, input.tipo),
            isNull(categories.deletedAt),
            sql`lower(${categories.nome}) = lower(${nome})`,
          ),
        )
        .get();
      if (repetida) throw new Error(`Já existe uma categoria de ${input.tipo} chamada "${nome}".`);

      const ts = nowIso();
      const id = newId();
      db.insert(categories)
        .values({
          id,
          userId,
          nome,
          tipo: input.tipo,
          icone: 'tag',
          cor: input.cor,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    },

    // ----------------------------------------------------------- lançamentos

    async addExpense(input: NovaDespesa, userId = padrao): Promise<string> {
      return inserirSimples('despesa', input, userId);
    },

    async addIncome(input: NovaDespesa, userId = padrao): Promise<string> {
      return inserirSimples('receita', input, userId);
    },

    /** Transferência: UMA linha com origem e destino, nunca duas. Duas linhas
     *  (uma despesa e uma receita) somariam no relatório como gasto e entrada
     *  — o erro clássico desta classe de app. */
    async addTransfer(input: NovaTransferencia, userId = padrao): Promise<string> {
      validarValor(input.amountCents);
      const competencia = input.competencia ?? hoje();
      validarData(competencia);
      if (input.deContaId === input.paraContaId) {
        throw new Error('Origem e destino precisam ser contas diferentes.');
      }

      return db.transaction((tx) => {
        contaDoUsuario(tx, input.deContaId, userId);
        contaDoUsuario(tx, input.paraContaId, userId);

        const pago = pagoPelaData(competencia);
        const ts = nowIso();
        const id = newId();
        tx.insert(transactions)
          .values({
            id,
            userId,
            kind: 'transferencia',
            amountCents: input.amountCents,
            currency: 'BRL',
            competencia,
            descricao: (input.descricao ?? '').trim(),
            categoryId: null,
            accountId: input.deContaId,
            transferAccountId: input.paraContaId,
            pago,
            pagoEm: pago ? competencia : null,
            createdAt: ts,
            updatedAt: ts,
          })
          .run();
        return id;
      });
    },

    /** Edita um lançamento. O que pode mudar depende do tipo:
     *
     *  - despesa/receita em conta: valor, data, categoria, conta, descrição;
     *  - transferência: valor, data, origem, destino, descrição;
     *  - compra no cartão: só categoria e descrição. Valor e data definem em
     *    que fatura a parcela caiu, e essa fatura foi gravada na escrita e não
     *    se recalcula (nota [F] do schema.sql). Para mudar, exclui e lança de
     *    novo;
     *  - pagamento de fatura: nada — desfaz e paga de novo.
     *
     *  Mudar a data recalcula "pago": data futura vira previsto. */
    async updateTransaction(id: string, patch: EdicaoLancamento, userId = padrao): Promise<void> {
      db.transaction((tx) => {
        const atual = buscar(tx, id, userId);
        if (!atual) throw new Error('Lançamento não encontrado.');

        if (atual.kind === 'pagamento_fatura') {
          throw new Error('Pagamento de fatura não se edita. Desfaça o pagamento e pague de novo.');
        }

        const mudou = <K extends keyof EdicaoLancamento>(k: K) =>
          patch[k] !== undefined && patch[k] !== (atual as unknown as Record<string, unknown>)[k];

        if (atual.creditCardId) {
          if (mudou('amountCents') || mudou('competencia') || mudou('accountId')) {
            throw new Error(
              'Valor e data de compra no cartão definem a fatura em que ela caiu. ' +
                'Para mudar, exclua a compra e lance de novo.',
            );
          }
        }

        const amountCents = patch.amountCents ?? atual.amountCents;
        const competencia = patch.competencia ?? atual.competencia;
        validarValor(amountCents);
        validarData(competencia);

        const set: Partial<Transaction> = {
          amountCents,
          competencia,
          descricao: (patch.descricao ?? atual.descricao).trim(),
          updatedAt: nowIso(),
        };

        if (atual.kind === 'transferencia') {
          const de = patch.accountId ?? atual.accountId!;
          const para = patch.transferAccountId ?? atual.transferAccountId!;
          if (de === para) throw new Error('Origem e destino precisam ser contas diferentes.');
          contaDoUsuario(tx, de, userId);
          contaDoUsuario(tx, para, userId);
          set.accountId = de;
          set.transferAccountId = para;
        } else {
          const categoryId = patch.categoryId !== undefined ? patch.categoryId : atual.categoryId;
          categoriaValida(tx, categoryId, atual.kind, userId);
          set.categoryId = categoryId;
          if (!atual.creditCardId) {
            const conta = patch.accountId ?? atual.accountId!;
            contaDoUsuario(tx, conta, userId);
            set.accountId = conta;
          }
        }

        if (!atual.creditCardId && competencia !== atual.competencia) {
          const pago = pagoPelaData(competencia);
          set.pago = pago;
          set.pagoEm = pago ? competencia : null;
        }

        tx.update(transactions).set(set).where(eq(transactions.id, atual.id)).run();
      });
    },

    /** Exclui um lançamento (soft delete). Três casos:
     *
     *  - comum: só ele;
     *  - compra no cartão: a compra INTEIRA, todas as parcelas. Uma parcela
     *    solta faria a soma da série deixar de bater com o valor comprado.
     *    Recusado se alguma parcela estiver em fatura já paga: excluir mudaria
     *    um valor já quitado;
     *  - pagamento de fatura: desfaz o pagamento — a fatura volta a ficar em
     *    aberto, na mesma transação.
     */
    async deleteTransaction(id: string, userId = padrao): Promise<ResultadoExclusao> {
      return db.transaction((tx): ResultadoExclusao => {
        const atual = buscar(tx, id, userId);
        if (!atual) throw new Error('Lançamento não encontrado.');
        const ts = nowIso();
        const apagar = (ids: string[]) =>
          tx.update(transactions)
            .set({ deletedAt: ts, updatedAt: ts })
            .where(and(inArray(transactions.id, ids), eq(transactions.userId, userId)))
            .run();

        if (atual.kind === 'pagamento_fatura') {
          apagar([atual.id]);
          if (atual.invoiceId) {
            tx.update(invoices)
              .set({ status: 'aberta', pagamentoTxId: null, updatedAt: ts })
              .where(and(eq(invoices.id, atual.invoiceId), eq(invoices.pagamentoTxId, atual.id)))
              .run();
          }
          return { tipo: 'pagamento_desfeito' };
        }

        if (atual.creditCardId) {
          const parcelas = atual.seriesId
            ? tx
                .select()
                .from(transactions)
                .where(
                  and(
                    eq(transactions.seriesId, atual.seriesId),
                    eq(transactions.userId, userId),
                    isNull(transactions.deletedAt),
                  ),
                )
                .all()
            : [atual];

          const faturaIds = [...new Set(parcelas.map((p) => p.invoiceId).filter((x): x is string => !!x))];
          if (faturaIds.length > 0) {
            const paga = tx
              .select({ mes: invoices.mesReferencia })
              .from(invoices)
              .where(and(inArray(invoices.id, faturaIds), eq(invoices.status, 'paga')))
              .get();
            if (paga) {
              throw new Error(
                `A fatura de ${mesPorExtenso(paga.mes)} já foi paga. ` +
                  'Desfaça o pagamento antes de excluir esta compra.',
              );
            }
          }

          apagar(parcelas.map((p) => p.id));
          return { tipo: 'compra', parcelas: parcelas.length };
        }

        apagar([atual.id]);
        return { tipo: 'simples' };
      });
    },
  };
}

export type LedgerRepo = ReturnType<typeof createLedgerRepo>;
