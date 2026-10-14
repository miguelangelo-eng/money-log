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

import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

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
import { PARCELAS_MAX } from '@/lib/card';
import { ICONE_PADRAO, iconeValido } from '@/lib/categoria-icones';
import { clampDay, daysInMonth, monthStart, parse, type CivilDate } from '@/lib/civil-date';
import { splitInstallments, type Cents } from '@/lib/money';
import {
  dataDaOcorrencia,
  horizonte,
  indiceDaOcorrencia,
  ocorrenciasAte,
  tipoDaSerie,
  type Escopo,
} from '@/lib/serie';

import { recalcularStatusDaFatura, type SyncDb } from './cards';

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
  icone: string | null;
  totalCents: Cents;
}

/** Como o lançamento se repete. Ver src/lib/serie.ts. */
export type Repeticao =
  | { tipo: 'unica' }
  | { tipo: 'mensal' }
  | { tipo: 'parcelado'; parcelas: number };

export interface NovaDespesa {
  amountCents: Cents;
  competencia?: CivilDate;
  descricao?: string;
  categoryId?: string | null;
  accountId: string;
  /** Vale para a primeira ocorrência; as seguintes seguem a data. Omitido,
   *  segue a data também: futuro é pendente. */
  pago?: boolean;
  repeticao?: Repeticao;
  /** Importação de extrato: id da linha no banco e o lote. Só em lançamento
   *  único — uma linha do extrato é uma ocorrência. */
  idExterno?: string;
  importBatchId?: string;
}

export interface NovaTransferencia {
  amountCents: Cents;
  competencia?: CivilDate;
  deContaId: string;
  paraContaId: string;
  descricao?: string;
  idExterno?: string;
  importBatchId?: string;
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
  | { tipo: 'serie'; removidos: number }
  | { tipo: 'pagamento_desfeito' };

/** Quantas linhas cada escopo atinge, para a tela dizer antes de agir. */
export type ContagemDeEscopo = Record<Escopo, number>;

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
  const maior = (a: CivilDate, b: CivilDate) => (a > b ? a : b);

  function inserirSimples(q: Q, kind: 'despesa' | 'receita', input: NovaDespesa, userId: string): string {
    validarValor(input.amountCents);
    const competencia = input.competencia ?? hoje();
    validarData(competencia);
    const rep = input.repeticao ?? { tipo: 'unica' };
    if (input.idExterno && rep.tipo !== 'unica') {
      throw new Error('Lançamento importado não se repete.');
    }
    if (
      rep.tipo === 'parcelado' &&
      (!Number.isInteger(rep.parcelas) || rep.parcelas < 2 || rep.parcelas > PARCELAS_MAX)
    ) {
      throw new Error(`Parcelas: de 2 a ${PARCELAS_MAX}.`);
    }

    // Uma linha por ocorrência. Parcelado divide o valor (resto nas
    // primeiras); recorrente repete o valor cheio até o horizonte.
    const linhas: Array<{ competencia: CivilDate; amountCents: Cents; n: number | null; de: number | null }> =
      rep.tipo === 'parcelado'
        ? splitInstallments(input.amountCents, rep.parcelas).map((v, i) => ({
            competencia: dataDaOcorrencia(competencia, i),
            amountCents: v,
            n: i + 1,
            de: rep.parcelas,
          }))
        : rep.tipo === 'mensal'
          ? ocorrenciasAte(competencia, 0, maior(horizonte(hoje()), competencia)).map((k) => ({
              competencia: dataDaOcorrencia(competencia, k),
              amountCents: input.amountCents,
              n: null,
              de: null,
            }))
          : [{ competencia, amountCents: input.amountCents, n: null, de: null }];

    contaDoUsuario(q, input.accountId, userId);
    categoriaValida(q, input.categoryId, kind, userId);

    const seriesId = rep.tipo === 'unica' ? null : newId();
    const ts = nowIso();
    const ids: string[] = [];
    linhas.forEach((l, i) => {
      const pago = i === 0 && input.pago !== undefined ? input.pago : pagoPelaData(l.competencia);
      const id = newId();
      q.insert(transactions)
        .values({
          id,
          userId,
          kind,
          amountCents: l.amountCents,
          currency: 'BRL',
          competencia: l.competencia,
          descricao: (input.descricao ?? '').trim(),
          categoryId: input.categoryId ?? null,
          accountId: input.accountId,
          pago,
          pagoEm: pago ? (l.competencia <= hoje() ? l.competencia : hoje()) : null,
          seriesId,
          parcelaN: l.n,
          parcelaDe: l.de,
          importBatchId: input.importBatchId ?? null,
          idExterno: input.idExterno ?? null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      ids.push(id);
    });
    return ids[0];
  }

  /** Transferência: UMA linha com origem e destino, nunca duas. Duas linhas
   *  (uma despesa e uma receita) somariam no relatório como gasto e entrada
   *  — o erro clássico desta classe de app. */
  function inserirTransferencia(q: Q, input: NovaTransferencia, userId: string): string {
    validarValor(input.amountCents);
    const competencia = input.competencia ?? hoje();
    validarData(competencia);
    if (input.deContaId === input.paraContaId) {
      throw new Error('Origem e destino precisam ser contas diferentes.');
    }
    contaDoUsuario(q, input.deContaId, userId);
    contaDoUsuario(q, input.paraContaId, userId);

    const pago = pagoPelaData(competencia);
    const ts = nowIso();
    const id = newId();
    q.insert(transactions)
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
        importBatchId: input.importBatchId ?? null,
        idExterno: input.idExterno ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    return id;
  }

  /** Todas as linhas da série, INCLUSIVE as excluídas, em ordem de data. As
   *  excluídas contam: são elas que dizem que a recorrência foi encerrada e
   *  quais meses já existiram. */
  function linhasDaSerie(q: Q, seriesId: string, userId: string): Transaction[] {
    return q
      .select()
      .from(transactions)
      .where(and(eq(transactions.seriesId, seriesId), eq(transactions.userId, userId)))
      .orderBy(transactions.competencia, transactions.parcelaN)
      .all();
  }

  /** Cria as ocorrências que faltam de uma recorrência até `ate`, copiando a
   *  última (valor, categoria, conta, descrição — uma edição "desta e das
   *  próximas" vale para o que ainda vai ser gerado).
   *
   *  Encerrada = a última ocorrência está excluída ("excluir esta e as
   *  próximas"). Nesse caso não gera nada. */
  function estenderSerie(q: Q, seriesId: string, ate: CivilDate, userId: string): number {
    const linhas = linhasDaSerie(q, seriesId, userId);
    const ultima = linhas[linhas.length - 1];
    if (!ultima || ultima.deletedAt || ultima.parcelaN !== null) return 0;

    const inicio = linhas[0].competencia;
    const ks = ocorrenciasAte(inicio, indiceDaOcorrencia(inicio, ultima.competencia) + 1, ate);
    const ts = nowIso();
    for (const k of ks) {
      const competencia = dataDaOcorrencia(inicio, k);
      const pago = pagoPelaData(competencia);
      q.insert(transactions)
        .values({
          id: newId(),
          userId,
          kind: ultima.kind,
          amountCents: ultima.amountCents,
          currency: ultima.currency,
          competencia,
          descricao: ultima.descricao,
          categoryId: ultima.categoryId,
          accountId: ultima.accountId,
          pago,
          pagoEm: pago ? competencia : null,
          seriesId,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
    }
    return ks.length;
  }

  /** As linhas que um escopo atinge, só as não excluídas. */
  function alvos(q: Q, atual: Transaction, escopo: Escopo, userId: string): Transaction[] {
    if (!atual.seriesId || escopo === 'esta') return [atual];
    return linhasDaSerie(q, atual.seriesId, userId).filter(
      (l) => !l.deletedAt && (escopo === 'todas' || l.competencia >= atual.competencia),
    );
  }

  /** Aplica uma edição a UMA linha, com as regras do tipo dela. */
  function editarLinha(q: Q, atual: Transaction, patch: EdicaoLancamento, userId: string) {
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
      contaDoUsuario(q, de, userId);
      contaDoUsuario(q, para, userId);
      set.accountId = de;
      set.transferAccountId = para;
    } else {
      const categoryId = patch.categoryId !== undefined ? patch.categoryId : atual.categoryId;
      categoriaValida(q, categoryId, atual.kind as 'despesa' | 'receita', userId);
      set.categoryId = categoryId;
      if (!atual.creditCardId) {
        const conta = patch.accountId ?? atual.accountId!;
        contaDoUsuario(q, conta, userId);
        set.accountId = conta;
      }
    }

    if (!atual.creditCardId && competencia !== atual.competencia) {
      const pago = pagoPelaData(competencia);
      set.pago = pago;
      set.pagoEm = pago ? competencia : null;
    }

    q.update(transactions).set(set).where(eq(transactions.id, atual.id)).run();
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
          icone: categories.icone,
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
        .groupBy(transactions.categoryId, categories.nome, categories.cor, categories.icone)
        .orderBy(sql`sum(${transactions.amountCents}) desc`)
        .all();

      return rows.map((r) => ({
        categoryId: r.categoryId,
        // Despesa sem categoria é possível (o campo é opcional): rotular, não ocultar.
        nome: r.nome ?? 'Sem categoria',
        cor: r.cor ?? '#898781',
        icone: r.icone,
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
      input: { nome: string; tipo: 'despesa' | 'receita'; cor: string; icone?: string },
      userId = padrao,
    ): Promise<string> {
      const nome = input.nome.trim();
      if (nome === '') throw new Error('Dê um nome à categoria.');
      if (input.tipo !== 'despesa' && input.tipo !== 'receita') {
        throw new Error('Tipo de categoria inválido.');
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(input.cor)) throw new Error('Cor inválida.');
      const icone = input.icone ?? ICONE_PADRAO;
      if (!iconeValido(icone)) throw new Error('Ícone inválido.');

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
          icone,
          cor: input.cor,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    },

    // ----------------------------------------------------------- lançamentos

    async addExpense(input: NovaDespesa, userId = padrao): Promise<string> {
      return db.transaction((tx) => inserirSimples(tx, 'despesa', input, userId));
    },

    async addIncome(input: NovaDespesa, userId = padrao): Promise<string> {
      return db.transaction((tx) => inserirSimples(tx, 'receita', input, userId));
    },

    /** As mesmas escritas, dentro de uma transação aberta por quem chama —
     *  a importação de extrato grava o lote inteiro ou nada. */
    em: {
      despesa: (q: Q, input: NovaDespesa, userId = padrao) => inserirSimples(q, 'despesa', input, userId),
      receita: (q: Q, input: NovaDespesa, userId = padrao) => inserirSimples(q, 'receita', input, userId),
      transferencia: (q: Q, input: NovaTransferencia, userId = padrao) =>
        inserirTransferencia(q, input, userId),
    },

    async addTransfer(input: NovaTransferencia, userId = padrao): Promise<string> {
      return db.transaction((tx) => inserirTransferencia(tx, input, userId));
    },

    /** Edita um lançamento — ou vários, numa série. O que pode mudar depende
     *  do tipo:
     *
     *  - despesa/receita em conta: valor, data, categoria, conta, descrição;
     *  - transferência: valor, data, origem, destino, descrição;
     *  - compra no cartão: só categoria e descrição. Valor e data definem em
     *    que fatura a parcela caiu, e essa fatura foi gravada na escrita e não
     *    se recalcula (nota [F] do schema.sql). Para mudar, exclui e lança de
     *    novo;
     *  - pagamento de fatura: nada — desfaz e paga de novo.
     *
     *  Numa série (parcelado ou recorrente), `escopo` diz quais ocorrências
     *  mudam: só esta, esta e as próximas, ou todas. A DATA muda uma
     *  ocorrência por vez e só dentro do mesmo mês: uma série tem uma linha
     *  por mês, e é isso que permite gerar as próximas sem pular nem repetir.
     *
     *  Mudar a data recalcula "pago": data futura vira previsto. */
    async updateTransaction(
      id: string,
      patch: EdicaoLancamento,
      escopo: Escopo = 'esta',
      userId = padrao,
    ): Promise<void> {
      db.transaction((tx) => {
        const atual = buscar(tx, id, userId);
        if (!atual) throw new Error('Lançamento não encontrado.');

        if (atual.kind === 'pagamento_fatura') {
          throw new Error('Pagamento de fatura não se edita. Desfaça o pagamento e pague de novo.');
        }

        const mudouData = patch.competencia !== undefined && patch.competencia !== atual.competencia;
        if (mudouData && atual.seriesId) {
          if (escopo !== 'esta') {
            throw new Error('A data muda uma ocorrência por vez. Escolha "só esta".');
          }
          if (monthStart(patch.competencia!) !== monthStart(atual.competencia)) {
            throw new Error('Numa série, a data só muda dentro do mesmo mês.');
          }
        }

        for (const linha of alvos(tx, atual, escopo, userId)) {
          editarLinha(
            tx,
            linha,
            linha.id === atual.id ? patch : { ...patch, competencia: undefined },
            userId,
          );
        }
      });
    },

    /** Marca como pago ou pendente. Compra no cartão não tem esse estado (quem
     *  é paga é a fatura), e pagamento de fatura é sempre pago. */
    async marcarPago(id: string, pago: boolean, userId = padrao): Promise<void> {
      db.transaction((tx) => {
        const atual = buscar(tx, id, userId);
        if (!atual) throw new Error('Lançamento não encontrado.');
        if (atual.kind === 'pagamento_fatura' || atual.creditCardId) {
          throw new Error('Compra no cartão é paga pela fatura, não uma a uma.');
        }
        tx.update(transactions)
          .set({ pago, pagoEm: pago ? hoje() : null, updatedAt: nowIso() })
          .where(eq(transactions.id, atual.id))
          .run();
      });
    },

    /** Quantas ocorrências cada escopo atinge — para a tela dizer "Excluir as
     *  9 restantes?" antes de agir. Fora de série, tudo é 1. */
    async escoposDaSerie(id: string, userId = padrao): Promise<ContagemDeEscopo> {
      const atual = buscar(db, id, userId);
      if (!atual) throw new Error('Lançamento não encontrado.');
      return {
        esta: 1,
        proximas: alvos(db, atual, 'proximas', userId).length,
        todas: alvos(db, atual, 'todas', userId).length,
      };
    },

    /** Mantém as recorrências materializadas até o horizonte (12 meses à
     *  frente). Idempotente: roda a cada abertura do app. Devolve quantas
     *  ocorrências criou. */
    async estenderRecorrencias(userId = padrao): Promise<number> {
      return db.transaction((tx) => {
        const series = tx
          .selectDistinct({ seriesId: transactions.seriesId })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              isNotNull(transactions.seriesId),
              isNull(transactions.parcelaN),
            ),
          )
          .all();
        const ate = horizonte(hoje());
        return series.reduce((n, s) => n + estenderSerie(tx, s.seriesId!, ate, userId), 0);
      });
    },

    /** Exclui (soft delete). Casos:
     *
     *  - pagamento de fatura: desfaz o pagamento — a fatura volta a ficar em
     *    aberto, na mesma transação. Escopo não se aplica;
     *  - série: `escopo` escolhe só esta, esta e as próximas, ou todas.
     *    "Esta e as próximas" numa recorrência é como ela se encerra;
     *  - compra no cartão (parcelada ou não): recusado se alguma linha
     *    atingida estiver em fatura já paga — excluir mudaria um valor já
     *    quitado.
     */
    async deleteTransaction(
      id: string,
      escopo: Escopo = 'esta',
      userId = padrao,
    ): Promise<ResultadoExclusao> {
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
          // Pode ter sido um de vários pagamentos: a fatura é recalculada,
          // não simplesmente reaberta.
          if (atual.invoiceId) recalcularStatusDaFatura(tx, atual.invoiceId, ts);
          return { tipo: 'pagamento_desfeito' };
        }

        const linhas = alvos(tx, atual, escopo, userId);

        const faturaIds = [
          ...new Set(linhas.map((l) => l.invoiceId).filter((x): x is string => !!x)),
        ];
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

        // Excluir SÓ a última ocorrência gerada de uma recorrência não pode
        // encerrá-la (a regra de encerramento é "a última está excluída").
        // Gera a seguinte antes; a série continua viva.
        if (escopo === 'esta' && tipoDaSerie(atual) === 'recorrente') {
          const todas = linhasDaSerie(tx, atual.seriesId!, userId);
          if (todas[todas.length - 1].id === atual.id) {
            const inicio = todas[0].competencia;
            const proxima = dataDaOcorrencia(
              inicio,
              indiceDaOcorrencia(inicio, atual.competencia) + 1,
            );
            estenderSerie(tx, atual.seriesId!, proxima, userId);
          }
        }

        apagar(linhas.map((l) => l.id));
        // Compra a menos pode deixar a fatura coberta pelo que já foi pago.
        for (const f of faturaIds) recalcularStatusDaFatura(tx, f, ts);
        return atual.seriesId ? { tipo: 'serie', removidos: linhas.length } : { tipo: 'simples' };
      });
    },
  };
}

export type LedgerRepo = ReturnType<typeof createLedgerRepo>;
