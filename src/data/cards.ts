/** Cartão de crédito: cadastro, compra (à vista e parcelada), faturas e
 *  pagamento. Telas S10, S11 e S12; fluxo F03.
 *
 *  Duas escolhas de construção, e o motivo de cada uma:
 *
 *  1. O banco e o gerador de id chegam por INJEÇÃO (`createCardsRepo`), em vez
 *     de este módulo importar src/db/client. O cliente importa o expo-sqlite,
 *     que não carrega no Node; injetando, cards.test.ts roda estas mesmas
 *     funções contra o SQLite real (node:sqlite) com a migração real.
 *
 *  2. As escritas que precisam ser atômicas usam `db.transaction` com callback
 *     SÍNCRONO e `.run()/.get()/.all()`. O driver do expo-sqlite no Drizzle é
 *     síncrono ('sync'): callback async dentro da transação faz o Drizzle
 *     lançar erro em tempo de execução — no aparelho, não no typecheck.
 *
 *  Toda leitura e escrita filtra por userId. Não há RLS no SQLite local; esta
 *  checagem é a mesma regra do RLS do Postgres, aplicada na camada de dados,
 *  e cards.test.ts verifica que um usuário não lê nem paga fatura do outro.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  accounts,
  creditCards,
  invoices,
  transactions,
  type CreditCard,
  type Invoice,
  type Transaction,
} from '@/db/schema';
import type * as schema from '@/db/schema';
import {
  limiteDisponivel,
  planoDeCompra,
  statusDaFatura,
  totalDaFatura,
  type StatusFatura,
} from '@/lib/card';
import { parse, type CivilDate } from '@/lib/civil-date';
import { invoiceForPurchase, type CardCycle, type InvoiceRef } from '@/lib/invoice';
import type { Cents } from '@/lib/money';

// O tipo de "run result" difere entre drivers (expo, better-sqlite3); o que
// importa aqui é o modo 'sync' e o schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncDb = BaseSQLiteDatabase<'sync', any, typeof schema>;

/** O que um helper precisa para ler e escrever — vale para o `db` e para o
 *  `tx` de dentro de uma transação. */
export type Q = Pick<SyncDb, 'select' | 'insert' | 'update'>;

export interface CardsDeps {
  db: SyncDb;
  newId: () => string;
  nowIso: () => string;
  /** Usuário padrão das chamadas. Os testes passam outro explicitamente para
   *  verificar o isolamento. */
  userId: string;
}

export interface NovoCartao {
  nome: string;
  limiteCents: Cents;
  diaFechamento: number;
  diaVencimento: number;
  contaPagamentoId: string | null;
}

export interface CompraNoCartao {
  cardId: string;
  amountCents: Cents;
  competencia: CivilDate;
  parcelas: number;
  categoryId?: string | null;
  descricao?: string;
  /** Crédito no cartão (estorno): abate da fatura. Só à vista. */
  estorno?: boolean;
  /** Importação de extrato. Só à vista: a linha da fatura é uma parcela. */
  idExterno?: string;
  /** Importação: data que decide a fatura, quando não é a da compra. A
   *  linha veio numa fatura do banco, e é nela que tem que ficar — o Nubank
   *  lança as parcelas no dia do fechamento, que pela regra do app cairiam
   *  na fatura anterior. Só à vista. */
  dataDaFatura?: CivilDate;
  importBatchId?: string;
}

export interface PagamentoDeFatura {
  invoiceId: string;
  accountId: string;
  data: CivilDate;
  idExterno?: string;
  importBatchId?: string;
}

/** Pagamento de fatura em qualquer valor: o banco aceita pagar antes do
 *  fechamento e em partes. A fatura que ele quita é escolhida como o banco
 *  faz — ver faturaDoPagamento. */
export interface PagamentoAvulso {
  cardId: string;
  accountId: string;
  data: CivilDate;
  amountCents: Cents;
  idExterno?: string;
  importBatchId?: string;
}

export interface FaturaResumo {
  id: string | null; // null = fatura que ainda não tem nenhuma compra
  mesReferencia: CivilDate;
  dataFechamento: CivilDate;
  dataVencimento: CivilDate;
  totalCents: Cents;
  /** Soma dos pagamentos ligados a ela (antecipados e parciais incluídos). */
  pagoCents: Cents;
  /** O que falta pagar: total − pago, nunca negativo. */
  devidoCents: Cents;
  status: StatusFatura;
}

export interface ResumoDoCartao {
  cartao: CreditCard;
  /** A fatura em que uma compra feita hoje entra. */
  faturaAtual: FaturaResumo;
  /** A fatura fechada mais antiga com valor a pagar, se houver. */
  faturaAPagar: FaturaResumo | null;
  usadoCents: Cents;
  disponivelCents: Cents;
}

const dataBr = (d: CivilDate) => {
  const { day, month } = parse(d);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
/** '2026-08-01' -> 'agosto de 2026'. */
export const mesPorExtenso = (d: CivilDate) => `${MESES[parse(d).month - 1]} de ${parse(d).year}`;

const ciclo = (c: CreditCard): CardCycle => ({
  diaFechamento: c.diaFechamento,
  diaVencimento: c.diaVencimento,
});

type Item = { id: string; kind: Transaction['kind']; amountCents: Cents; competencia: CivilDate; createdAt: string };

function itensDaFatura(q: Q, invoiceId: string): Item[] {
  return q
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amountCents: transactions.amountCents,
      competencia: transactions.competencia,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(and(eq(transactions.invoiceId, invoiceId), isNull(transactions.deletedAt)))
    .all();
}

const pagoDe = (itens: Item[]) =>
  itens.filter((i) => i.kind === 'pagamento_fatura').reduce((a, i) => a + i.amountCents, 0);

/** Regrava o status da fatura a partir dos pagamentos.
 *
 *  Paga = os pagamentos cobrem o total E o último foi DEPOIS do fechamento.
 *  Um pagamento antecipado que cobre o que já foi gasto não fecha a fatura:
 *  compras novas do mesmo ciclo ainda entram nela (e uma fatura paga não
 *  aceita compra). Chamado depois de qualquer mudança em pagamento ou compra.
 */
export function recalcularStatusDaFatura(q: Q, invoiceId: string, ts: string): void {
  const f = q.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!f) return;
  const itens = itensDaFatura(q, invoiceId);
  const total = totalDaFatura(itens);
  const pagamentos = itens
    .filter((i) => i.kind === 'pagamento_fatura')
    .sort((a, b) => a.competencia.localeCompare(b.competencia) || a.createdAt.localeCompare(b.createdAt));
  const ultimo = pagamentos.at(-1);
  const paga = total > 0 && pagoDe(itens) >= total && !!ultimo && ultimo.competencia > f.dataFechamento;
  const status = paga ? 'paga' : 'aberta';
  const pagamentoTxId = paga ? ultimo!.id : null;
  if (f.status === status && f.pagamentoTxId === pagamentoTxId) return;
  q.update(invoices).set({ status, pagamentoTxId, updatedAt: ts }).where(eq(invoices.id, invoiceId)).run();
}

function validarDia(nome: string, v: number) {
  if (!Number.isInteger(v) || v < 1 || v > 31) {
    throw new Error(`O ${nome} precisa ser um dia entre 1 e 31.`);
  }
}

export function createCardsRepo({ db, newId, nowIso, userId: padrao }: CardsDeps) {
  // ---------------------------------------------------------------- leitura

  function buscarCartao(q: Q, cardId: string, userId: string): CreditCard | undefined {
    return q
      .select()
      .from(creditCards)
      .where(
        and(
          eq(creditCards.id, cardId),
          eq(creditCards.userId, userId),
          isNull(creditCards.deletedAt),
        ),
      )
      .get();
  }

  /** Faturas do cartão com total, pago e status calculados, da mais antiga
   *  para a mais nova. */
  function faturasDoCartao(cardId: string, userId: string, hoje: CivilDate, q: Q = db): FaturaResumo[] {
    const faturas = q
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.creditCardId, cardId),
          eq(invoices.userId, userId),
          isNull(invoices.deletedAt),
        ),
      )
      .orderBy(asc(invoices.mesReferencia))
      .all();

    return faturas.map((f) => {
      const itens = itensDaFatura(q, f.id);
      const totalCents = totalDaFatura(itens);
      const pagoCents = pagoDe(itens);
      return {
        id: f.id,
        mesReferencia: f.mesReferencia,
        dataFechamento: f.dataFechamento,
        dataVencimento: f.dataVencimento,
        totalCents,
        pagoCents,
        devidoCents: Math.max(0, totalCents - pagoCents),
        status: statusDaFatura(f.dataFechamento, f.status === 'paga', hoje),
      };
    });
  }

  /** Que fatura um pagamento feito em `data` quita, como o banco faz: a mais
   *  antiga já fechada que ainda deve; se nenhuma deve, a do ciclo em curso
   *  (pagamento antecipado). `pendente` soma pagamentos ainda não gravados,
   *  por chave — a prévia da importação simula o extrato inteiro. */
  function faturaDoPagamento(
    q: Q,
    card: CreditCard,
    data: CivilDate,
    userId: string,
    pendente: Map<string, Cents> = new Map(),
  ): { chave: string; id: string | null; ref: InvoiceRef; antecipado: boolean } {
    for (const f of faturasDoCartao(card.id, userId, data, q)) {
      if (!f.id || f.dataFechamento >= data) continue;
      if (f.devidoCents - (pendente.get(f.id) ?? 0) > 0) {
        return { chave: f.id, id: f.id, ref: f, antecipado: false };
      }
    }
    const ref = invoiceForPurchase(data, ciclo(card));
    const existente = q
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.creditCardId, card.id), eq(invoices.mesReferencia, ref.mesReferencia), isNull(invoices.deletedAt)))
      .get();
    return { chave: existente?.id ?? `mes:${ref.mesReferencia}`, id: existente?.id ?? null, ref, antecipado: true };
  }

  /** Busca a fatura do cartão naquele mês; cria se ainda não existir.
   *  O índice único (cartão, mês) no banco garante uma só por mês. */
  function garantirFatura(q: Q, userId: string, card: CreditCard, ref: InvoiceRef, ts: string): Invoice {
    const achar = () =>
      q
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.creditCardId, card.id),
            eq(invoices.mesReferencia, ref.mesReferencia),
            isNull(invoices.deletedAt),
          ),
        )
        .get();

    const existente = achar();
    if (existente) return existente;

    // Fatura do mês excluída (o caso real: "começar do zero" no servidor,
    // trazido pelo pull). Revive a MESMA linha, zerada: criar outra esbarraria
    // na regra uma-por-mês, e o status/pagamento antigos não valem mais.
    const excluida = q
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.creditCardId, card.id), eq(invoices.mesReferencia, ref.mesReferencia)))
      .get();
    if (excluida) {
      q.update(invoices)
        .set({
          deletedAt: null,
          status: 'aberta',
          pagamentoTxId: null,
          dataFechamento: ref.dataFechamento,
          dataVencimento: ref.dataVencimento,
          updatedAt: ts,
        })
        .where(eq(invoices.id, excluida.id))
        .run();
      const revivida = achar();
      if (!revivida) throw new Error('Falha ao reabrir a fatura.');
      return revivida;
    }

    q.insert(invoices)
      .values({
        id: newId(),
        userId,
        creditCardId: card.id,
        mesReferencia: ref.mesReferencia,
        dataFechamento: ref.dataFechamento,
        dataVencimento: ref.dataVencimento,
        status: 'aberta',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const criada = achar();
    if (!criada) throw new Error('Falha ao criar a fatura.');
    return criada;
  }

  function comprar(tx: Q, input: CompraNoCartao, userId: string): string[] {
    const card = buscarCartao(tx, input.cardId, userId);
    if (!card) throw new Error('Cartão não encontrado.');
    if ((input.estorno || input.idExterno || input.dataDaFatura) && input.parcelas !== 1) {
      throw new Error('Estorno e linha importada são à vista.');
    }

    const plano = planoDeCompra(input.competencia, ciclo(card), input.amountCents, input.parcelas);
    if (input.dataDaFatura) plano[0] = { ...plano[0], fatura: invoiceForPurchase(input.dataDaFatura, ciclo(card)) };
    const parcelado = plano.length > 1;
    const seriesId = parcelado ? newId() : null;
    const ts = nowIso();
    const ids: string[] = [];

    for (const p of plano) {
      const fatura = garantirFatura(tx, userId, card, p.fatura, ts);
      if (fatura.status === 'paga') {
        // Não deveria acontecer com data de hoje (só paga fatura fechada),
        // mas lançamento retroativo pode cair numa fatura já quitada.
        // Aceitar silenciosamente faria a fatura paga "crescer".
        throw new Error(
          `A fatura de ${mesPorExtenso(fatura.mesReferencia)} já foi paga; ` +
            `a parcela ${p.n}/${p.de} não pode entrar nela.`,
        );
      }

      const id = newId();
      tx.insert(transactions)
        .values({
          id,
          userId,
          kind: input.estorno ? 'receita' : 'despesa',
          amountCents: p.amountCents,
          currency: 'BRL',
          competencia: p.competencia,
          descricao: input.descricao ?? '',
          categoryId: input.categoryId ?? null,
          accountId: null,
          creditCardId: card.id,
          invoiceId: fatura.id,
          // A compra aconteceu; a dívida mora na fatura. Marcar como não
          // paga faria toda compra no cartão aparecer "pendente" na lista.
          pago: true,
          pagoEm: null,
          seriesId,
          parcelaN: parcelado ? p.n : null,
          parcelaDe: parcelado ? p.de : null,
          importBatchId: input.importBatchId ?? null,
          idExterno: input.idExterno ?? null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      ids.push(id);
    }
    return ids;
  }

  function contaDoUsuario(tx: Q, accountId: string, userId: string) {
    const conta = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
      .get();
    if (!conta) throw new Error('Conta de pagamento não encontrada.');
  }

  function inserirPagamento(
    tx: Q,
    fatura: Invoice,
    card: CreditCard | undefined,
    input: { accountId: string; data: CivilDate; amountCents: Cents; idExterno?: string; importBatchId?: string },
    userId: string,
  ): string {
    const ts = nowIso();
    const id = newId();
    tx.insert(transactions)
      .values({
        id,
        userId,
        kind: 'pagamento_fatura',
        amountCents: input.amountCents,
        currency: 'BRL',
        competencia: input.data,
        descricao: `Fatura ${card?.nome ?? 'do cartão'}`,
        categoryId: null,
        accountId: input.accountId,
        creditCardId: fatura.creditCardId,
        invoiceId: fatura.id,
        pago: true,
        pagoEm: input.data,
        importBatchId: input.importBatchId ?? null,
        idExterno: input.idExterno ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    recalcularStatusDaFatura(tx, fatura.id, ts);
    return id;
  }

  /** Paga o que FALTA de uma fatura fechada (o total, se nada foi pago). */
  function pagar(tx: Q, input: PagamentoDeFatura, userId: string): string {
    const fatura = tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.userId, userId),
          isNull(invoices.deletedAt),
        ),
      )
      .get();
    if (!fatura) throw new Error('Fatura não encontrada.');
    if (fatura.status === 'paga') throw new Error('Esta fatura já foi paga.');
    if (statusDaFatura(fatura.dataFechamento, false, input.data) !== 'fechada') {
      throw new Error(
        `A fatura fecha em ${dataBr(fatura.dataFechamento)}. ` +
          'O pagamento fica disponível depois do fechamento.',
      );
    }
    contaDoUsuario(tx, input.accountId, userId);

    const itens = itensDaFatura(tx, fatura.id);
    const devido = totalDaFatura(itens) - pagoDe(itens);
    if (devido <= 0) throw new Error('Não há valor a pagar nesta fatura.');

    return inserirPagamento(tx, fatura, buscarCartao(tx, fatura.creditCardId, userId), { ...input, amountCents: devido }, userId);
  }

  /** Pagamento em qualquer valor, na fatura que o banco quitaria. */
  function pagarParte(tx: Q, input: PagamentoAvulso, userId: string): string {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error('Informe um valor maior que zero.');
    }
    const card = buscarCartao(tx, input.cardId, userId);
    if (!card) throw new Error('Cartão não encontrado.');
    contaDoUsuario(tx, input.accountId, userId);

    const escolha = faturaDoPagamento(tx, card, input.data, userId);
    const fatura = escolha.id
      ? tx.select().from(invoices).where(eq(invoices.id, escolha.id)).get()!
      : garantirFatura(tx, userId, card, escolha.ref, nowIso());
    return inserirPagamento(tx, fatura, card, input, userId);
  }

  // ---------------------------------------------------------------- API

  return {
    async listCards(userId = padrao): Promise<CreditCard[]> {
      return db
        .select()
        .from(creditCards)
        .where(
          and(
            eq(creditCards.userId, userId),
            isNull(creditCards.deletedAt),
            eq(creditCards.arquivado, false),
          ),
        )
        .orderBy(asc(creditCards.nome))
        .all();
    },

    async getCard(cardId: string, userId = padrao): Promise<CreditCard | null> {
      return buscarCartao(db, cardId, userId) ?? null;
    },

    async addCard(input: NovoCartao, userId = padrao): Promise<string> {
      const nome = input.nome.trim();
      if (nome.length === 0) throw new Error('Dê um nome ao cartão.');
      validarDia('dia de fechamento', input.diaFechamento);
      validarDia('dia de vencimento', input.diaVencimento);
      if (!Number.isInteger(input.limiteCents) || input.limiteCents < 0) {
        throw new Error('O limite não pode ser negativo.');
      }

      if (input.contaPagamentoId) {
        const conta = db
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, input.contaPagamentoId),
              eq(accounts.userId, userId),
              isNull(accounts.deletedAt),
            ),
          )
          .get();
        if (!conta) throw new Error('Conta de pagamento não encontrada.');
      }

      const ts = nowIso();
      const id = newId();
      db.insert(creditCards)
        .values({
          id,
          userId,
          nome,
          icone: 'card',
          limiteCents: input.limiteCents,
          diaFechamento: input.diaFechamento,
          diaVencimento: input.diaVencimento,
          contaPagamentoId: input.contaPagamentoId,
          arquivado: false,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    },

    /** Compra no cartão. Uma linha por parcela, cada uma já ligada à sua
     *  fatura — o invoice_id é gravado AGORA e nunca recalculado (nota [F] do
     *  schema.sql). Tudo numa transação: ou entram todas as parcelas, ou
     *  nenhuma. */
    async addCardPurchase(input: CompraNoCartao, userId = padrao): Promise<string[]> {
      return db.transaction((tx) => comprar(tx, input, userId));
    },

    async invoices(cardId: string, hoje: CivilDate, userId = padrao): Promise<FaturaResumo[]> {
      return faturasDoCartao(cardId, userId, hoje);
    },

    /** Itens de uma fatura: compras e estornos, sem o próprio pagamento. */
    async invoiceItems(invoiceId: string, userId = padrao): Promise<Transaction[]> {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.invoiceId, invoiceId),
            eq(transactions.userId, userId),
            isNull(transactions.deletedAt),
            inArray(transactions.kind, ['despesa', 'receita']),
          ),
        )
        .orderBy(desc(transactions.competencia), desc(transactions.createdAt))
        .all();
    },

    /** Paga o que falta da fatura. Atômico: cria o pagamento (que tira o
     *  dinheiro da conta) e marca a fatura como paga, ou não faz nada.
     *
     *  Pela tela, só fatura FECHADA. Pagamento antecipado e em partes, como o
     *  banco aceita, entra pela importação do extrato (`em.pagarParte`). */
    async payInvoice(input: PagamentoDeFatura, userId = padrao): Promise<string> {
      return db.transaction((tx) => pagar(tx, input, userId));
    },

    /** As mesmas escritas, dentro de uma transação aberta por quem chama —
     *  a importação de extrato grava o lote inteiro ou nada. */
    em: {
      compra: (q: Q, input: CompraNoCartao, userId = padrao) => comprar(q, input, userId),
      pagarFatura: (q: Q, input: PagamentoDeFatura, userId = padrao) => pagar(q, input, userId),
      pagarParte: (q: Q, input: PagamentoAvulso, userId = padrao) => pagarParte(q, input, userId),
    },

    /** Só leitura: que fatura um pagamento quitaria (para a prévia). */
    async faturaDoPagamento(cardId: string, data: CivilDate, pendente: Map<string, Cents>, userId = padrao) {
      const card = buscarCartao(db, cardId, userId);
      if (!card) throw new Error('Cartão não encontrado.');
      return faturaDoPagamento(db, card, data, userId, pendente);
    },

    /** Resumo para a lista de cartões (S10). */
    async summaries(hoje: CivilDate, userId = padrao): Promise<ResumoDoCartao[]> {
      const cartoes = db
        .select()
        .from(creditCards)
        .where(
          and(
            eq(creditCards.userId, userId),
            isNull(creditCards.deletedAt),
            eq(creditCards.arquivado, false),
          ),
        )
        .orderBy(asc(creditCards.nome))
        .all();

      return cartoes.map((cartao) => {
        const faturas = faturasDoCartao(cartao.id, userId, hoje);
        const ref = invoiceForPurchase(hoje, ciclo(cartao));
        const faturaAtual: FaturaResumo = faturas.find(
          (f) => f.mesReferencia === ref.mesReferencia,
        ) ?? {
          id: null,
          ...ref,
          totalCents: 0,
          pagoCents: 0,
          devidoCents: 0,
          status: statusDaFatura(ref.dataFechamento, false, hoje),
        };
        const naoPagas = faturas.filter((f) => f.status !== 'paga');
        const faturaAPagar =
          naoPagas.find((f) => f.status === 'fechada' && f.devidoCents > 0) ?? null;

        // O limite volta com o que já foi pago, inclusive em parte.
        return {
          cartao,
          faturaAtual,
          faturaAPagar,
          usadoCents: naoPagas.reduce((a, f) => a + f.devidoCents, 0),
          disponivelCents: limiteDisponivel(
            cartao.limiteCents,
            naoPagas.map((f) => f.devidoCents),
          ),
        };
      });
    },
  };
}

export type CardsRepo = ReturnType<typeof createCardsRepo>;
