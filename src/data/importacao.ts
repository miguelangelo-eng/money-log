/** Importação de extrato: prévia e gravação.
 *
 *  Duas fases, de propósito. `prever` não escreve nada: lê o extrato e o
 *  banco e sugere o que cada linha vira. A tela mostra, a pessoa corrige, e
 *  só então `importar` grava — o lote inteiro numa transação, ou nada.
 *
 *  O que cada linha pode virar, em ordem de precedência na sugestão:
 *
 *  1. já importada (mesmo `idExterno`, mesmo se excluída depois): some da
 *     prévia. É o que torna seguro importar extratos sobrepostos;
 *  2. ignorar por regra fixa: Pix no Crédito, pagamento recebido na fatura;
 *  3. conciliar: o lançamento já existe no app (lançado à mão), com mesmo
 *     valor, sentido e data até 3 dias de diferença. Não duplica: só grava o
 *     id do banco nele;
 *  4. pagamento de fatura e caixinha/RDB (transferência para a conta de
 *     investimentos, criada se não existir);
 *  5. o histórico: a última vez que um lançamento com esse texto foi
 *     classificado (categoria, ou transferência de/para tal conta). É assim
 *     que o app aprende: o Pix vindo do seu próprio nome vira transferência
 *     da outra conta a partir da segunda importação;
 *  6. palpite de categoria pela palavra (src/lib/extrato/regras.ts);
 *  7. despesa ou receita sem categoria.
 */

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import {
  accounts,
  categories,
  creditCards,
  importBatches,
  invoices,
  transactions,
  type Account,
  type Transaction,
} from '@/db/schema';
import { saldoDaConta, type LinhaAgregada } from '@/lib/balance';
import { addDays, parse, toLocalDate, type CivilDate } from '@/lib/civil-date';
import type { Extrato, LinhaExtrato } from '@/lib/extrato/ler';
import { categoriaPorPalavra, idsPixNoCredito, normalizar, regraFixa } from '@/lib/extrato/regras';
import { invoiceForPurchase } from '@/lib/invoice';
import { formatCents, type Cents } from '@/lib/money';

import { mesPorExtenso, type CardsRepo, type Q, type SyncDb } from './cards';
import type { LedgerRepo, TipoConta } from './ledger-repo';

export interface ImportacaoDeps {
  db: SyncDb;
  newId: () => string;
  nowIso: () => string;
  userId: string;
  ledger: LedgerRepo;
  cards: CardsRepo;
}

export type Destino = { tipo: 'conta'; contaId: string } | { tipo: 'cartao'; cartaoId: string };

/** Conta do outro lado de uma transferência: existente, ou a criar na hora
 *  de gravar ("Investimentos"). */
export type OutraConta = { id: string } | { nova: string; tipo: TipoConta };

export type Acao =
  | { tipo: 'despesa' | 'receita'; categoryId: string | null }
  | { tipo: 'transferencia'; outra: OutraConta }
  /** Pagamento (inteiro, parcial ou antecipado) da fatura deste cartão. A
   *  fatura quitada é a que o banco quitaria: ver cards.faturaDoPagamento. */
  | { tipo: 'pagamento_fatura'; cartaoId: string }
  | { tipo: 'conciliar'; transacaoId: string }
  | { tipo: 'ignorar' };

export interface LinhaPrevia {
  linha: LinhaExtrato;
  acao: Acao;
  /** Por que o app sugeriu isso, em uma frase para a tela. */
  motivo: string | null;
}

export interface Previa {
  extrato: Extrato;
  destino: Destino;
  linhas: LinhaPrevia[];
  /** Linhas que já estão no app por importação anterior. Não aparecem. */
  jaImportadas: number;
}

export interface Arquivo {
  nome: string;
  sha256: string;
}

export interface ResultadoImportacao {
  importadas: number;
  conciliadas: number;
  ignoradas: number;
  jaImportadas: number;
  /** Só para OFX com saldo: o app depois da importação contra o banco. */
  saldo: ConferenciaDeSaldo | null;
}

export interface ConferenciaDeSaldo {
  data: CivilDate;
  bancoCents: Cents;
  appCents: Cents;
  /** banco − app. Zero = fecha. */
  diferencaCents: Cents;
}

const dataCurta = (d: CivilDate) => {
  const { day, month } = parse(d);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};
const diasEntre = (a: CivilDate, b: CivilDate) =>
  Math.round(Math.abs(toLocalDate(a).getTime() - toLocalDate(b).getTime()) / 86_400_000);

/** Chave do histórico: o texto sem caixa, acento e sufixo de parcela. */
const chave = (descricao: string) => normalizar(descricao.replace(/\s\(\d+\/\d+\)$/, ''));

/** Prefixo do id: "conta:260:" — de que extrato a linha veio. */
const origemDoId = (id: string) => id.split(':').slice(0, 2).join(':');

/** Id por impressão digital (a fatura em CSV não tem id) em vez do FITID do
 *  OFX. A mesma compra tem um id em cada formato. */
const porImpressao = (id: string) => id.includes('|');

/** "cartao:260:<fitid>:p8" -> "cartao:260:<fitid>". */
const semParcela = (id: string) => id.replace(/:p\d+$/, '');

/** Id de uma linha do banco como o leitor de hoje o gera. Parcela de cartão
 *  importada antes de 2026-10-14 ficou com o FITID puro — que o Nubank
 *  repete em todas as parcelas da compra; o número dela está na descrição
 *  ("Loja (7/10)"). */
const idParcela = (r: { id: string | null; descricao: string }): string => {
  const id = r.id!;
  const p = /\((\d+)\/\d+\)$/.exec(r.descricao);
  return p && id.startsWith('cartao:') && !/:p\d+$/.test(id) && !porImpressao(id) ? `${id}:p${p[1]}` : id;
};

/** A data que representa a fatura do arquivo: a compra mais recente dele.
 *  Uma fatura do banco vai de um fechamento ao outro, e todas as linhas dela
 *  ficam na fatura do app que contém essa data — inclusive as parcelas, que
 *  o Nubank lança no dia do fechamento ANTERIOR (13/09 na fatura que fecha
 *  em 13/10) e que, pela data, cairiam na fatura de setembro. */
export function dataDaFaturaDoArquivo(extrato: Extrato): CivilDate | null {
  if (extrato.origem !== 'cartao') return null;
  const datas = extrato.linhas.filter((l) => l.valorCents < 0).map((l) => l.data).sort();
  return datas.at(-1) ?? null;
}

/** O texto que o lançamento recebe. Parcela fica visível: "Loja (7/10)". */
export const descricaoDoLancamento = (l: LinhaExtrato) =>
  l.parcela ? `${l.descricao} (${l.parcela.n}/${l.parcela.de})` : l.descricao;

export function createImportacaoRepo({ db, newId, nowIso, userId: padrao, ledger, cards }: ImportacaoDeps) {
  function conta(q: Q, id: string, userId: string): Account {
    const c = q
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
      .get();
    if (!c) throw new Error('Conta não encontrada.');
    return c;
  }

  /** Lotes com ao menos um lançamento não excluído. Lote com TUDO excluído
   *  é importação desfeita — o caso real foi "começar do zero": excluir tudo
   *  e importar de novo o mesmo arquivo. */
  function lotesVivos(q: Q, userId: string): Set<string> {
    const rows = q
      .select({ id: transactions.importBatchId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), isNotNull(transactions.importBatchId)))
      .all();
    return new Set(rows.map((r) => r.id!));
  }

  /** Linhas do banco que já estão no app. Excluída conta quando o lote dela
   *  segue vivo: apagar UM lançamento importado é de propósito, e ele não
   *  volta. Excluída de lote desfeito (ou sem lote) não conta. */
  function idsExistentes(q: Q, ids: string[], userId: string): Set<string> {
    if (ids.length === 0) return new Set();
    const vivos = lotesVivos(q, userId);
    // Parcela de cartão gravada antes de o id levar o número (":p7"): está
    // no banco com o FITID puro. Busca também por ele.
    const busca = [...new Set([...ids, ...ids.map(semParcela)])];
    const rows = q
      .select({
        id: transactions.idExterno,
        descricao: transactions.descricao,
        excluida: transactions.deletedAt,
        lote: transactions.importBatchId,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.idExterno, busca)))
      .all();
    return new Set(rows.filter((r) => !r.excluida || (r.lote && vivos.has(r.lote))).map(idParcela));
  }

  function saldoNaData(q: Q, contaId: string, data: CivilDate, userId: string): Cents {
    const c = conta(q, contaId, userId);
    const rows = q
      .select({
        accountId: transactions.accountId,
        transferAccountId: transactions.transferAccountId,
        kind: transactions.kind,
        pago: transactions.pago,
        total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          lte(transactions.competencia, data),
          or(eq(transactions.accountId, contaId), eq(transactions.transferAccountId, contaId)),
        ),
      )
      .groupBy(transactions.accountId, transactions.transferAccountId, transactions.kind, transactions.pago)
      .all();
    const linhas: LinhaAgregada[] = rows.map((r) => ({ ...r, pago: Boolean(r.pago), total: Number(r.total) }));
    return saldoDaConta(contaId, c.saldoInicialCents, linhas);
  }

  function conferir(contaId: string, data: CivilDate, bancoCents: Cents, userId: string): ConferenciaDeSaldo {
    const appCents = saldoNaData(db, contaId, data, userId);
    return { data, bancoCents, appCents, diferencaCents: bancoCents - appCents };
  }

  return {
    /** Não escreve nada. */
    async prever(extrato: Extrato, destino: Destino, userId = padrao): Promise<Previa> {
      if (extrato.origem === 'conta' && destino.tipo !== 'conta') {
        throw new Error('Este é um extrato de conta: escolha uma conta como destino.');
      }
      if (extrato.origem === 'cartao' && destino.tipo !== 'cartao') {
        throw new Error('Esta é uma fatura de cartão: escolha um cartão como destino.');
      }

      const existentes = idsExistentes(db, extrato.linhas.map((l) => l.idExterno), userId);
      const novas = extrato.linhas.filter((l) => !existentes.has(l.idExterno));
      const pix = idsPixNoCredito(extrato.linhas);

      const contas = db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
        .all();
      const contaAtiva = (id: string | null) => contas.find((c) => c.id === id && !c.arquivada);
      const investimento: OutraConta = (() => {
        const c = contas.find((x) => x.tipo === 'investimento' && !x.arquivada);
        return c ? { id: c.id } : { nova: 'Investimentos', tipo: 'investimento' };
      })();

      const cats = db
        .select()
        .from(categories)
        .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)))
        .all();
      const categoriaOk = (id: string | null, tipo: 'despesa' | 'receita') =>
        cats.some((c) => c.id === id && c.tipo === tipo);
      const categoriaPorNome = (nome: string | null) =>
        nome ? (cats.find((c) => c.tipo === 'despesa' && normalizar(c.nome) === normalizar(nome))?.id ?? null) : null;

      // Histórico: o mais recente por texto vence.
      const historico = new Map<string, Transaction>();
      for (const t of db
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), sql`${transactions.descricao} <> ''`))
        .orderBy(asc(transactions.competencia), asc(transactions.createdAt))
        .all()) {
        historico.set(chave(t.descricao), t);
      }

      // Candidatos a conciliação: o que existe no período, no mesmo destino.
      const datas = novas.map((l) => l.data).sort();
      const candidatos =
        datas.length === 0
          ? []
          : db
              .select()
              .from(transactions)
              .where(
                and(
                  eq(transactions.userId, userId),
                  isNull(transactions.deletedAt),
                  gte(transactions.competencia, addDays(datas[0], -10)),
                  lte(transactions.competencia, addDays(datas[datas.length - 1], 10)),
                  destino.tipo === 'conta'
                    ? or(
                        eq(transactions.accountId, destino.contaId),
                        eq(transactions.transferAccountId, destino.contaId),
                      )
                    : eq(transactions.creditCardId, destino.cartaoId),
                ),
              )
              .all();
      const usados = new Set<string>();

      function conciliavel(l: LinhaExtrato): Transaction | null {
        const valor = Math.abs(l.valorCents);
        const saida = l.valorCents < 0;
        let melhor: Transaction | null = null;
        for (const t of candidatos) {
          if (usados.has(t.id)) continue;
          // Já veio de outro extrato. Só casa em dois casos: transferência
          // (a saída de um banco é a entrada do outro) e a mesma fatura em
          // outro formato (CSV tem impressão digital, OFX tem FITID).
          if (
            t.idExterno &&
            !(t.kind === 'transferencia' && origemDoId(t.idExterno) !== origemDoId(l.idExterno)) &&
            !(origemDoId(t.idExterno) === origemDoId(l.idExterno) && porImpressao(t.idExterno) !== porImpressao(l.idExterno))
          ) {
            continue;
          }
          const tolerancia = l.parcela && t.parcelaN === l.parcela.n && t.parcelaDe === l.parcela.de ? 2 : 0;
          if (Math.abs(t.amountCents - valor) > tolerancia) continue;
          if (diasEntre(t.competencia, l.data) > (l.parcela ? 10 : 3)) continue;

          const mesmoSentido =
            destino.tipo === 'cartao'
              ? t.kind === (saida ? 'despesa' : 'receita')
              : saida
                ? t.accountId === destino.contaId &&
                  ['despesa', 'transferencia', 'pagamento_fatura'].includes(t.kind) &&
                  (t.kind === 'pagamento_fatura' || !t.creditCardId)
                : (t.accountId === destino.contaId && t.kind === 'receita') ||
                  (t.transferAccountId === destino.contaId && t.kind === 'transferencia');
          if (!mesmoSentido) continue;

          if (!melhor || diasEntre(t.competencia, l.data) < diasEntre(melhor.competencia, l.data)) melhor = t;
        }
        if (melhor) usados.add(melhor.id);
        return melhor;
      }

      // Cartão: ciclo e faturas, para não pôr compra em fatura já paga.
      const cartao =
        destino.tipo === 'cartao'
          ? db
              .select()
              .from(creditCards)
              .where(and(eq(creditCards.id, destino.cartaoId), eq(creditCards.userId, userId), isNull(creditCards.deletedAt)))
              .get()
          : undefined;
      if (destino.tipo === 'cartao' && !cartao) throw new Error('Cartão não encontrado.');
      if (destino.tipo === 'conta') conta(db, destino.contaId, userId);

      const faturasPagas = new Set(
        cartao
          ? db
              .select({ mes: invoices.mesReferencia })
              .from(invoices)
              .where(and(eq(invoices.creditCardId, cartao.id), eq(invoices.status, 'paga'), isNull(invoices.deletedAt)))
              .all()
              .map((f) => f.mes)
          : [],
      );

      // Pagamento de fatura: o banco aceita pagar antes do fechamento e em
      // partes, então o valor não precisa bater com o total. Vai para o
      // cartão que esta conta costuma pagar (ou o primeiro), e a prévia
      // simula o extrato inteiro para dizer que fatura cada um quita.
      const contaDestino = destino.tipo === 'conta' ? destino.contaId : null;
      const cartoesDoUsuario = await cards.listCards(userId);
      const cartaoDoPagamento =
        cartoesDoUsuario.find((c) => c.contaPagamentoId === contaDestino) ?? cartoesDoUsuario[0] ?? null;
      const pagamentosPendentes = new Map<string, Cents>();

      const refFatura = dataDaFaturaDoArquivo(extrato);
      const linhas: LinhaPrevia[] = [];
      const iofs: Array<{ i: number; texto?: string; id?: string }> = [];
      for (const l of novas) {
        const saida = l.valorCents < 0;
        const regra = regraFixa(l, extrato.origem, pix);
        const sugerir = (acao: Acao, motivo: string | null) => linhas.push({ linha: l, acao, motivo });

        if (regra?.tipo === 'ignorar') {
          sugerir({ tipo: 'ignorar' }, regra.motivo);
          continue;
        }

        const existente = conciliavel(l);
        if (existente) {
          sugerir(
            { tipo: 'conciliar', transacaoId: existente.id },
            `Já lançado: ${existente.descricao || 'sem descrição'} em ${dataCurta(existente.competencia)}.`,
          );
          continue;
        }

        if (cartao && faturasPagas.has(invoiceForPurchase(refFatura ?? l.data, cartao).mesReferencia)) {
          sugerir({ tipo: 'ignorar' }, 'A fatura desta data já está paga no app.');
          continue;
        }

        if (regra?.tipo === 'pagamento_fatura') {
          if (!saida || !cartaoDoPagamento) {
            sugerir({ tipo: 'ignorar' }, 'Nenhum cartão cadastrado para receber este pagamento.');
            continue;
          }
          const f = await cards.faturaDoPagamento(cartaoDoPagamento.id, l.data, pagamentosPendentes, userId);
          pagamentosPendentes.set(f.chave, (pagamentosPendentes.get(f.chave) ?? 0) + Math.abs(l.valorCents));
          const qual = `fatura ${cartaoDoPagamento.nome} de ${mesPorExtenso(f.ref.mesReferencia)}`;
          sugerir(
            { tipo: 'pagamento_fatura', cartaoId: cartaoDoPagamento.id },
            f.antecipado ? `Adianta a ${qual}, ainda aberta.` : `Paga a ${qual}.`,
          );
          continue;
        }
        if (regra?.tipo === 'investimento') {
          sugerir(
            { tipo: 'transferencia', outra: investimento },
            saida ? 'Dinheiro guardado: transferência para investimentos.' : 'Resgate: volta dos investimentos.',
          );
          continue;
        }

        // IOF: a categoria vem da compra, resolvida no fim — no OFX o IOF
        // aparece ANTES da compra. Antes do histórico, que guardaria a
        // categoria da compra do mês passado.
        if (regra?.tipo === 'herdar' && saida) {
          iofs.push({ i: linhas.length, texto: regra.texto, id: regra.id });
          sugerir({ tipo: 'despesa', categoryId: null }, 'IOF: mesma categoria da compra.');
          continue;
        }

        const h = historico.get(chave(l.descricao));
        if (h && destino.tipo === 'conta' && h.kind === 'transferencia') {
          const outra = h.accountId === destino.contaId ? h.transferAccountId : h.accountId;
          if (outra && outra !== destino.contaId && contaAtiva(outra)) {
            sugerir({ tipo: 'transferencia', outra: { id: outra } }, 'Como da última vez.');
            continue;
          }
        }
        const tipo = saida ? 'despesa' : 'receita';
        if (h && h.kind === tipo && h.categoryId && categoriaOk(h.categoryId, tipo)) {
          sugerir({ tipo, categoryId: h.categoryId }, 'Como da última vez.');
          continue;
        }

        const palpite = saida ? categoriaPorNome(categoriaPorPalavra(l.descricao)) : null;
        sugerir({ tipo, categoryId: palpite }, null);
      }

      for (const iof of iofs) {
        const compra = linhas.find(
          (x) => (iof.id && x.linha.idExterno === iof.id) || (iof.texto && x.linha.original === iof.texto),
        );
        if (compra?.acao.tipo === 'despesa') {
          linhas[iof.i] = { ...linhas[iof.i], acao: { tipo: 'despesa', categoryId: compra.acao.categoryId } };
        }
      }

      return { extrato, destino, linhas, jaImportadas: extrato.linhas.length - novas.length };
    },

    /** Grava o que a prévia (já corrigida pela pessoa) diz. Tudo ou nada. */
    async importar(previa: Previa, arquivo: Arquivo, userId = padrao): Promise<ResultadoImportacao> {
      const { extrato, destino } = previa;
      const refFatura = dataDaFaturaDoArquivo(extrato);

      const r = db.transaction((tx) => {
        const ts = nowIso();
        // O mesmo arquivo de novo não é erro: linha a linha, o que já está no
        // app fica de fora (id_externo), e só entra o que falta — por
        // exemplo, depois de uma importação parcial. O hash continua único
        // por usuário: a repetição o grava com o id do lote.
        const batchId = newId();
        const repetido = tx
          .select({ id: importBatches.id })
          .from(importBatches)
          .where(and(eq(importBatches.userId, userId), eq(importBatches.sha256, arquivo.sha256)))
          .get();

        const existentes = idsExistentes(tx, previa.linhas.map((l) => l.linha.idExterno), userId);
        // Excluídas que NÃO bloqueiam (lote desfeito) largam o id do banco:
        // ele é único por usuário, inclusive em linha excluída.
        const livres = previa.linhas.map((l) => l.linha.idExterno).filter((id) => !existentes.has(id));
        if (livres.length > 0) {
          tx.update(transactions)
            .set({ idExterno: null, updatedAt: ts })
            .where(
              and(
                eq(transactions.userId, userId),
                isNotNull(transactions.deletedAt),
                inArray(transactions.idExterno, livres),
              ),
            )
            .run();
        }
        tx.insert(importBatches)
          .values({
            id: batchId,
            userId,
            arquivoNome: arquivo.nome,
            formato: extrato.formato,
            sha256: repetido ? `${arquivo.sha256}:${batchId}` : arquivo.sha256,
            accountId: destino.tipo === 'conta' ? destino.contaId : null,
            creditCardId: destino.tipo === 'cartao' ? destino.cartaoId : null,
            totalLinhas: extrato.linhas.length,
            status: 'pendente',
            createdAt: ts,
            updatedAt: ts,
          })
          .run();

        // Contas novas ("Investimentos"), criadas uma vez por nome.
        const criadas = new Map<string, string>();
        const resolver = (o: OutraConta): string => {
          if ('id' in o) return conta(tx, o.id, userId).id;
          const k = normalizar(o.nova);
          const ja =
            criadas.get(k) ??
            tx
              .select({ id: accounts.id })
              .from(accounts)
              .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt), sql`lower(${accounts.nome}) = lower(${o.nova})`))
              .get()?.id;
          if (ja) return ja;
          const id = newId();
          tx.insert(accounts)
            .values({ id, userId, nome: o.nova, tipo: o.tipo, icone: 'wallet', saldoInicialCents: 0, createdAt: ts, updatedAt: ts })
            .run();
          criadas.set(k, id);
          return id;
        };

        let importadas = 0;
        let conciliadas = 0;
        let ignoradas = 0;
        let jaImportadas = previa.jaImportadas;

        for (const { linha: l, acao } of previa.linhas) {
          if (existentes.has(l.idExterno)) {
            jaImportadas++;
            continue;
          }
          const valor = Math.abs(l.valorCents);
          const saida = l.valorCents < 0;
          const comum = { idExterno: l.idExterno, importBatchId: batchId, descricao: descricaoDoLancamento(l) };
          try {
            switch (acao.tipo) {
              case 'ignorar':
                ignoradas++;
                continue;
              case 'conciliar': {
                // Transferência com a outra ponta já importada fica como está:
                // um lançamento guarda um id de banco só.
                tx.update(transactions)
                  .set({ idExterno: l.idExterno, importBatchId: batchId, updatedAt: ts })
                  .where(
                    and(
                      eq(transactions.id, acao.transacaoId),
                      eq(transactions.userId, userId),
                      isNull(transactions.idExterno),
                    ),
                  )
                  .run();
                conciliadas++;
                continue;
              }
              case 'despesa':
              case 'receita':
                if (destino.tipo === 'cartao') {
                  if ((acao.tipo === 'despesa') !== saida) {
                    throw new Error(saida ? 'Saída no cartão é despesa.' : 'Crédito no cartão é estorno (receita).');
                  }
                  cards.em.compra(
                    tx,
                    {
                      cardId: destino.cartaoId,
                      amountCents: valor,
                      competencia: l.data,
                      parcelas: 1,
                      categoryId: acao.categoryId,
                      estorno: !saida,
                      dataDaFatura: refFatura ?? undefined,
                      ...comum,
                    },
                    userId,
                  );
                } else {
                  if ((acao.tipo === 'despesa') !== saida) {
                    throw new Error(saida ? 'Saída da conta não pode ser receita.' : 'Entrada na conta não pode ser despesa.');
                  }
                  ledger.em[acao.tipo](
                    tx,
                    { amountCents: valor, competencia: l.data, categoryId: acao.categoryId, accountId: destino.contaId, pago: true, ...comum },
                    userId,
                  );
                }
                break;
              case 'transferencia': {
                if (destino.tipo !== 'conta') throw new Error('Transferência só em extrato de conta.');
                const outra = resolver(acao.outra);
                ledger.em.transferencia(
                  tx,
                  {
                    amountCents: valor,
                    competencia: l.data,
                    deContaId: saida ? destino.contaId : outra,
                    paraContaId: saida ? outra : destino.contaId,
                    ...comum,
                  },
                  userId,
                );
                break;
              }
              case 'pagamento_fatura':
                if (destino.tipo !== 'conta' || !saida) throw new Error('Pagamento de fatura é saída da conta.');
                cards.em.pagarParte(
                  tx,
                  {
                    cardId: acao.cartaoId,
                    accountId: destino.contaId,
                    data: l.data,
                    amountCents: valor,
                    idExterno: l.idExterno,
                    importBatchId: batchId,
                  },
                  userId,
                );
                break;
            }
            importadas++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Linha de ${dataCurta(l.data)} (${l.descricao}): ${msg}`);
          }
        }

        tx.update(importBatches)
          .set({ importadas: importadas + conciliadas, ignoradas, status: 'concluido', updatedAt: nowIso() })
          .where(eq(importBatches.id, batchId))
          .run();

        return { importadas, conciliadas, ignoradas, jaImportadas };
      });

      const saldo =
        extrato.saldoFinal && destino.tipo === 'conta'
          ? conferir(destino.contaId, extrato.saldoFinal.data, extrato.saldoFinal.cents, userId)
          : null;
      return { ...r, saldo };
    },

    /** O saldo da conta no app numa data, contra o saldo do banco. */
    async conferirSaldo(contaId: string, data: CivilDate, bancoCents: Cents, userId = padrao): Promise<ConferenciaDeSaldo> {
      return conferir(contaId, data, bancoCents, userId);
    },

    /** Faz a conta fechar com o banco mexendo no saldo inicial — o caso típico
     *  é a conta ter sido cadastrada com saldo zero. Não cria lançamento: um
     *  "ajuste" como receita entraria no relatório do mês. */
    async ajustarSaldoInicial(contaId: string, deltaCents: Cents, userId = padrao): Promise<void> {
      if (!Number.isInteger(deltaCents)) throw new Error('Valor inválido.');
      db.transaction((tx) => {
        const c = conta(tx, contaId, userId);
        tx.update(accounts)
          .set({ saldoInicialCents: c.saldoInicialCents + deltaCents, updatedAt: nowIso() })
          .where(eq(accounts.id, c.id))
          .run();
      });
    },
  };
}

export type ImportacaoRepo = ReturnType<typeof createImportacaoRepo>;
