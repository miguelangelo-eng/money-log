/** Schema do SQLite local — a FONTE DA VERDADE do app (local-first).
 *
 *  Espelha replica/schema.sql, com as diferenças de dialeto documentadas no
 *  fim daquele arquivo:
 *    uuid        -> text (gerado no cliente, para o sync ser upsert idempotente)
 *    timestamptz -> text ISO-8601 em UTC
 *    date        -> text 'YYYY-MM-DD'  (ver src/lib/civil-date.ts)
 *    boolean     -> integer 0/1
 *    sem RLS: o banco local tem os dados de um usuário só, por construção
 *
 *  O Postgres do Supabase recebe o MESMO modelo com RLS. Ao mudar algo aqui,
 *  mude lá também — são dois lados do mesmo contrato.
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Toda linha nasce com id no cliente. É isso que torna o push idempotente:
 *  reenviar o mesmo lote é um upsert sobre a mesma chave, não uma duplicata. */
const id = () => text('id').primaryKey();
const userId = () => text('user_id').notNull();
const stamps = () => ({
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** Soft delete. DELETE físico não tem como ser propagado: o outro lado não
   *  sabe que a linha existiu. Ver nota [S] em replica/schema.sql. */
  deletedAt: text('deleted_at'),
});

export const profiles = sqliteTable('profiles', {
  id: id(),
  nome: text('nome').notNull(),
  avatarPath: text('avatar_path'),
  currency: text('currency').notNull().default('BRL'),
  ...stamps(),
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: id(),
    userId: userId(),
    nome: text('nome').notNull(),
    tipo: text('tipo', {
      enum: ['corrente', 'poupanca', 'dinheiro', 'investimento'],
    }).notNull(),
    instituicao: text('instituicao'),
    icone: text('icone').notNull().default('wallet'),
    cor: text('cor'),
    saldoInicialCents: integer('saldo_inicial_cents').notNull().default(0),
    arquivada: integer('arquivada', { mode: 'boolean' }).notNull().default(false),
    ...stamps(),
  },
  (t) => [
    index('accounts_user_idx').on(t.userId),
    uniqueIndex('accounts_nome_unico').on(t.userId, t.nome),
  ],
);

export const creditCards = sqliteTable(
  'credit_cards',
  {
    id: id(),
    userId: userId(),
    nome: text('nome').notNull(),
    icone: text('icone').notNull().default('card'),
    limiteCents: integer('limite_cents').notNull().default(0),
    /** 1–31. Pode ser 29/30/31 e fevereiro não tem — grampeado em
     *  src/lib/invoice.ts, nunca na UI. */
    diaFechamento: integer('dia_fechamento').notNull(),
    diaVencimento: integer('dia_vencimento').notNull(),
    contaPagamentoId: text('conta_pagamento_id').references(() => accounts.id),
    arquivado: integer('arquivado', { mode: 'boolean' }).notNull().default(false),
    ...stamps(),
  },
  (t) => [index('credit_cards_user_idx').on(t.userId)],
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: id(),
    userId: userId(),
    creditCardId: text('credit_card_id')
      .notNull()
      .references(() => creditCards.id),
    /** Sempre dia 1 do mês de referência. */
    mesReferencia: text('mes_referencia').notNull(),
    dataFechamento: text('data_fechamento').notNull(),
    dataVencimento: text('data_vencimento').notNull(),
    status: text('status', { enum: ['aberta', 'fechada', 'paga'] })
      .notNull()
      .default('aberta'),
    pagamentoTxId: text('pagamento_tx_id'),
    ...stamps(),
  },
  (t) => [
    // Uma fatura por cartão por mês. Barrado no banco, não na UI.
    uniqueIndex('invoices_card_mes_unico').on(t.creditCardId, t.mesReferencia),
    index('invoices_user_status_idx').on(t.userId, t.status),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    userId: userId(),
    nome: text('nome').notNull(),
    tipo: text('tipo', { enum: ['despesa', 'receita'] }).notNull(),
    icone: text('icone').notNull().default('tag'),
    cor: text('cor').notNull().default('#888888'),
    parentId: text('parent_id'),
    ...stamps(),
  },
  (t) => [
    index('categories_user_tipo_idx').on(t.userId, t.tipo),
    uniqueIndex('categories_nome_unico').on(t.userId, t.tipo, t.nome),
  ],
);

export const importBatches = sqliteTable(
  'import_batches',
  {
    id: id(),
    userId: userId(),
    arquivoNome: text('arquivo_nome').notNull(),
    formato: text('formato', { enum: ['ofx', 'csv'] }).notNull(),
    /** Único por usuário: reimportar o mesmo extrato é rejeitado pelo banco. */
    sha256: text('sha256').notNull(),
    accountId: text('account_id').references(() => accounts.id),
    creditCardId: text('credit_card_id').references(() => creditCards.id),
    totalLinhas: integer('total_linhas').notNull().default(0),
    importadas: integer('importadas').notNull().default(0),
    ignoradas: integer('ignoradas').notNull().default(0),
    status: text('status', { enum: ['pendente', 'concluido', 'erro'] })
      .notNull()
      .default('pendente'),
    ...stamps(),
  },
  (t) => [uniqueIndex('import_sha_unico').on(t.userId, t.sha256)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    userId: userId(),
    kind: text('kind', {
      enum: ['despesa', 'receita', 'transferencia'],
    }).notNull(),
    /** SEMPRE positivo. O sinal vem de kind. Ver nota [V]. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('BRL'),
    /** Data contábil, 'YYYY-MM-DD'. Não é instante. Ver nota [D]. */
    competencia: text('competencia').notNull(),
    descricao: text('descricao').notNull().default(''),

    categoryId: text('category_id').references(() => categories.id),
    accountId: text('account_id').references(() => accounts.id),
    creditCardId: text('credit_card_id').references(() => creditCards.id),
    invoiceId: text('invoice_id').references(() => invoices.id),
    transferAccountId: text('transfer_account_id').references(() => accounts.id),

    pago: integer('pago', { mode: 'boolean' }).notNull().default(true),
    pagoEm: text('pago_em'),

    observacao: text('observacao'),
    anexoPath: text('anexo_path'),

    /** Série de parcelamento ou recorrência. Materializada: 12 parcelas são
     *  12 linhas com o mesmo seriesId. Ver nota [P]. */
    seriesId: text('series_id'),
    parcelaN: integer('parcela_n'),
    parcelaDe: integer('parcela_de'),

    importBatchId: text('import_batch_id').references(() => importBatches.id),
    ...stamps(),
  },
  (t) => [
    // A consulta mais frequente do app: a lista do mês (S04).
    index('tx_user_competencia_idx').on(t.userId, t.competencia),
    // Relatório por categoria (S15).
    index('tx_user_cat_comp_idx').on(t.userId, t.categoryId, t.competencia),
    index('tx_account_idx').on(t.accountId),
    index('tx_invoice_idx').on(t.invoiceId),
    index('tx_transfer_account_idx').on(t.transferAccountId),
    // Editar/excluir a série toda (F08).
    index('tx_series_idx').on(t.seriesId),
    // Cursor de sincronização.
    index('tx_user_updated_idx').on(t.userId, t.updatedAt),
  ],
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: id(),
    userId: userId(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    /** null = limite recorrente, vale para todo mês. */
    mesReferencia: text('mes_referencia'),
    limiteCents: integer('limite_cents').notNull(),
    ...stamps(),
  },
  (t) => [
    /** Dois índices parciais em vez de um com `coalesce`.
     *
     *  A intenção é: um limite por categoria por mês, e no máximo um limite
     *  recorrente (mes_referencia nulo) por categoria. Um índice único simples
     *  sobre (user, category, mes_referencia) NÃO resolve, porque o SQLite
     *  considera NULLs distintos entre si e aceitaria dois recorrentes.
     *
     *  A primeira tentativa foi `coalesce(mes_referencia, '1900-01-01')` dentro
     *  do índice. O Drizzle não aceita expressão ali: ele trata o `sql` como
     *  nome de coluna, envolve em backticks e quebra na vírgula interna,
     *  gerando SQL inválido que o SQLite recusa em tempo de migração.
     *  Índice parcial expressa a mesma regra e é SQL que os dois entendem. */
    /** O nome da coluna vai LITERAL no `sql`, sem interpolar `t.mesReferencia`.
     *  Interpolando, o Drizzle emite `"budgets"."mes_referencia"`, e em
     *  CREATE INDEX o SQLite aceita apenas referência não qualificada — o
     *  nome com tabela resulta em `no such column`. */
    uniqueIndex('budgets_cat_mes_unico')
      .on(t.userId, t.categoryId, t.mesReferencia)
      .where(sql`"mes_referencia" is not null`),
    uniqueIndex('budgets_cat_recorrente_unico')
      .on(t.userId, t.categoryId)
      .where(sql`"mes_referencia" is null`),
  ],
);

export const alerts = sqliteTable(
  'alerts',
  {
    id: id(),
    userId: userId(),
    tipo: text('tipo', {
      enum: ['a_vencer', 'a_receber', 'limite_estourado', 'fatura_fechada'],
    }).notNull(),
    transactionId: text('transaction_id').references(() => transactions.id),
    budgetId: text('budget_id').references(() => budgets.id),
    invoiceId: text('invoice_id').references(() => invoices.id),
    titulo: text('titulo').notNull(),
    corpo: text('corpo'),
    lido: integer('lido', { mode: 'boolean' }).notNull().default(false),
    ...stamps(),
  },
  (t) => [index('alerts_user_lido_idx').on(t.userId, t.lido)],
);

export const pushTokens = sqliteTable('push_tokens', {
  id: id(),
  userId: userId(),
  token: text('token').notNull(),
  plataforma: text('plataforma', { enum: ['ios', 'android'] }).notNull(),
  ...stamps(),
});

/** SÓ LOCAL — não existe no Postgres.
 *
 *  Fila append-only das mudanças locais aguardando push. É o que faz a edição
 *  offline funcionar sem perder nada: a escrita vai para o SQLite e para o
 *  outbox na mesma transação, e o sync drena a fila quando houver rede.
 */
export const outbox = sqliteTable(
  'outbox',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    tabela: text('tabela').notNull(),
    rowId: text('row_id').notNull(),
    op: text('op', { enum: ['upsert', 'delete'] }).notNull(),
    payload: text('payload').notNull(), // json da linha
    tentativas: integer('tentativas').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('outbox_ordem_idx').on(t.seq)],
);

/** Cursor do sync. Uma linha só.
 *  O valor guardado é o `now()` do SERVIDOR, nunca o relógio do aparelho:
 *  relógio de celular atrasa, adianta, e o usuário mexe nele. */
export const syncState = sqliteTable('sync_state', {
  id: integer('id').primaryKey(), // sempre 1
  cursor: text('cursor'),
  ultimoPushEm: text('ultimo_push_em'),
  ultimoPullEm: text('ultimo_pull_em'),
});

export type Transaction = typeof transactions.$inferSelect;
export type NovaTransaction = typeof transactions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type CreditCard = typeof creditCards.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
