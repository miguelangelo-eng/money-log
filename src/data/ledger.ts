/** Camada de dados do app: liga os repositórios ao banco do aparelho.
 *
 *  A lógica mora em ./ledger-repo.ts e ./cards.ts, que recebem banco, id,
 *  relógio e usuário por injeção — é isso que permite testá-los no Node
 *  contra SQLite real. Aqui só se instancia com o expo-sqlite e reexporta os
 *  nomes que as telas usam. Quando a sincronização com o Supabase entrar
 *  (M1), o que muda é dentro dos repositórios; telas ficam iguais.
 */

import * as Crypto from 'expo-crypto';

import { db } from '@/db/client';
import { createCardsRepo } from '@/data/cards';
import { createLedgerRepo } from '@/data/ledger-repo';
import { today } from '@/lib/civil-date';

/** Id gerado no cliente, sempre. É o que torna o push do sync idempotente:
 *  reenviar o mesmo lote é upsert na mesma chave, não duplicata. */
export const newId = () => Crypto.randomUUID();

export const nowIso = () => new Date().toISOString();

/** O user_id gravado no aparelho. Fixo, mesmo com login.
 *
 *  O banco local tem os dados de uma pessoa só, por construção; quem diz de
 *  quem é cada linha é o token da sessão, no servidor (`push_changes` carimba
 *  o `auth.uid()`). Ver nota [Y] em replica/schema.sql. Por isso os
 *  repositórios não dependem de quem está logado.
 */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

const ledger = createLedgerRepo({
  db,
  newId,
  nowIso,
  userId: LOCAL_USER_ID,
  hoje: () => today(),
});

export const {
  ensureSeed,
  listAccounts,
  listCategories,
  listByMonth,
  getTransaction,
  monthTotals,
  expensesByCategory,
  accountBalances,
  addAccount,
  addCategory,
  addExpense,
  addIncome,
  addTransfer,
  updateTransaction,
  deleteTransaction,
} = ledger;

export const cards = createCardsRepo({ db, newId, nowIso, userId: LOCAL_USER_ID });

export {
  monthRange,
  ROTULO_TIPO_CONTA,
  TIPOS_CONTA,
  type CategorySlice,
  type EdicaoLancamento,
  type MonthTotals,
  type NovaDespesa,
  type NovaTransferencia,
  type ResultadoExclusao,
  type TipoConta,
} from '@/data/ledger-repo';
