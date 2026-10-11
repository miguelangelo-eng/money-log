/** Saldo de uma conta a partir das linhas agregadas do banco.
 *
 *  Função pura, sem banco e sem React, de propósito: é onde um erro de sinal
 *  faz o app mentir sobre dinheiro, e precisa de teste que não dependa de
 *  SQLite. A consulta em src/data/ledger.ts só agrupa; a regra mora aqui.
 *
 *  Regra:
 *    - receita entra na conta de origem (accountId)
 *    - despesa sai da conta de origem
 *    - transferência sai da origem e entra no destino (transferAccountId)
 *    - pagamento de fatura sai da conta que pagou
 *    - só o que está pago conta; previsto não é saldo
 *    - compra no cartão (accountId nulo) não move conta corrente: quem move é
 *      o pagamento da fatura, que é uma linha própria
 */

import type { Cents } from './money';

export interface LinhaAgregada {
  accountId: string | null;
  transferAccountId: string | null;
  kind: 'despesa' | 'receita' | 'transferencia' | 'pagamento_fatura';
  pago: boolean;
  total: Cents;
}

export function saldoDaConta(
  contaId: string,
  saldoInicial: Cents,
  linhas: LinhaAgregada[],
): Cents {
  let saldo = saldoInicial;

  for (const l of linhas) {
    if (!l.pago) continue;

    if (l.accountId === contaId) {
      if (l.kind === 'receita') saldo += l.total;
      if (l.kind === 'despesa') saldo -= l.total;
      if (l.kind === 'transferencia') saldo -= l.total;
      if (l.kind === 'pagamento_fatura') saldo -= l.total;
    }

    if (l.kind === 'transferencia' && l.transferAccountId === contaId) {
      saldo += l.total;
    }
  }

  return saldo;
}
