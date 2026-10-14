/** Motor de sincronização: SQLite do aparelho <-> Postgres do Supabase.
 *
 *  O aparelho é a fonte da verdade e cada conjunto de dados tem um escritor
 *  só (finanças separadas), então não há resolução de conflito:
 *
 *    push — lê as linhas que os triggers enfileiraram no outbox, como elas
 *           estão AGORA, e manda num lote só para `push_changes` (upsert por
 *           id, idempotente). Só limpa a fila depois que o servidor aceitou.
 *    pull — pede a `pull_changes` o que mudou desde o cursor e aplica. Linha
 *           com alteração local ainda na fila NÃO é sobrescrita: a versão do
 *           aparelho é mais nova e vai subir no próximo push.
 *
 *  O `user_id` local é um marcador fixo; o servidor carimba o `auth.uid()`
 *  no push e o motor troca de volta no pull. Ver nota [Y] no schema.sql.
 *
 *  Recebe banco e transporte por injeção: nos testes, o transporte chama as
 *  funções reais do schema.sql num Postgres em memória (PGlite).
 */

import { sql, type SQL } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { SyncDb } from '@/data/cards';
import * as s from '@/db/schema';

/** Mesma ordem de `sync_tabelas()` no schema.sql: quem é referenciado vem
 *  antes de quem referencia. */
export const TABELAS_SYNC = [
  'profiles',
  'accounts',
  'credit_cards',
  'invoices',
  'categories',
  'import_batches',
  'transactions',
  'budgets',
  'alerts',
  'push_tokens',
] as const;
export type TabelaSync = (typeof TABELAS_SYNC)[number];

const TABELA: Record<TabelaSync, SQLiteTable> = {
  profiles: s.profiles,
  accounts: s.accounts,
  credit_cards: s.creditCards,
  invoices: s.invoices,
  categories: s.categories,
  import_batches: s.importBatches,
  transactions: s.transactions,
  budgets: s.budgets,
  alerts: s.alerts,
  push_tokens: s.pushTokens,
};

type Coluna = { nome: string; booleano: boolean; instante: boolean };

const INSTANTES = new Set(['created_at', 'updated_at', 'deleted_at']);

const COLUNAS = Object.fromEntries(
  TABELAS_SYNC.map((t) => [
    t,
    getTableConfig(TABELA[t]).columns.map(
      (c): Coluna => ({
        nome: c.name,
        booleano: c.columnType === 'SQLiteBoolean',
        instante: INSTANTES.has(c.name),
      }),
    ),
  ]),
) as Record<TabelaSync, Coluna[]>;

export type Linha = Record<string, unknown>;
export type Mudanca = { tabela: TabelaSync; linha: Linha };
export type RespostaPull = {
  /** now() do servidor; volta como `desde` na próxima chamada. */
  cursor: string;
  tabelas: Partial<Record<string, Linha[]>>;
};

/** O que o motor precisa do servidor. No app, `supabase.rpc`; nos testes, as
 *  mesmas funções num PGlite. */
export interface Transporte {
  push(mudancas: Mudanca[]): Promise<unknown>;
  pull(desde: string | null): Promise<RespostaPull>;
}

export type CodigoErroSync = 'outro_usuario' | 'conflito_primeiro_login';

export class ErroDeSync extends Error {
  constructor(
    readonly codigo: CodigoErroSync,
    message: string,
  ) {
    super(message);
    this.name = 'ErroDeSync';
  }
}

export type EstadoSync = {
  cursor: string | null;
  ultimoPushEm: string | null;
  ultimoPullEm: string | null;
  dono: string | null;
};

export type ResultadoPreparo = 'ja_pronto' | 'baixou_da_nuvem' | 'subiu_dados_locais' | 'novo';

/** Instante do Postgres ('2026-10-11T12:00:00.123456+00:00') para o formato
 *  que o app grava ('2026-10-11T12:00:00.123Z'). Sem `new Date(texto)`: o
 *  parse de data em string varia de motor para motor de JavaScript. */
export function instanteParaIso(v: string): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(v);
  if (!m) return v;
  const [, a, me, d, h, mi, se, frac = '0', tz = 'Z'] = m;
  const ms = Number(frac.padEnd(3, '0').slice(0, 3));
  let offMin = 0;
  if (tz !== 'Z') {
    const sinal = tz[0] === '-' ? -1 : 1;
    const [oh, om = '0'] = tz.slice(1).replace(':', '').match(/^(\d\d)(\d\d)?$/)!.slice(1);
    offMin = sinal * (Number(oh) * 60 + Number(om));
  }
  const utc = Date.UTC(+a, +me - 1, +d, +h, +mi, +se, ms) - offMin * 60_000;
  return new Date(utc).toISOString();
}

export function createSync(deps: {
  db: SyncDb;
  transporte: Transporte;
  /** O marcador gravado em user_id no aparelho (LOCAL_USER_ID). */
  localUserId: string;
  nowIso: () => string;
}) {
  const { db, transporte, localUserId, nowIso } = deps;

  const garantirEstado = (d: SyncDb = db) =>
    d.run(sql`insert into sync_state (id, aplicando) values (1, 0) on conflict (id) do nothing`);

  function estado(): EstadoSync {
    const r = db.get<{
      cursor: string | null;
      ultimo_push_em: string | null;
      ultimo_pull_em: string | null;
      dono: string | null;
    }>(sql`select cursor, ultimo_push_em, ultimo_pull_em, dono from sync_state where id = 1`);
    return {
      cursor: r?.cursor ?? null,
      ultimoPushEm: r?.ultimo_push_em ?? null,
      ultimoPullEm: r?.ultimo_pull_em ?? null,
      dono: r?.dono ?? null,
    };
  }

  function pendentes(): number {
    return (
      db.get<{ n: number }>(sql`select count(*) as n from (select distinct tabela, row_id from outbox)`)
        ?.n ?? 0
    );
  }

  const lista = (valores: readonly unknown[]) =>
    sql.join(
      valores.map((v) => sql`${v}`),
      sql`, `,
    );

  function paraServidor(t: TabelaSync, linha: Linha): Linha {
    const out: Linha = {};
    for (const c of COLUNAS[t]) {
      const v = linha[c.nome];
      out[c.nome] = c.booleano && v !== null && v !== undefined ? Boolean(v) : v;
    }
    return out;
  }

  function paraLocal(t: TabelaSync, linha: Linha): Linha {
    const out: Linha = {};
    for (const c of COLUNAS[t]) {
      if (!(c.nome in linha)) continue;
      let v = linha[c.nome];
      if (c.booleano && v !== null) v = v ? 1 : 0;
      else if (c.instante && typeof v === 'string') v = instanteParaIso(v);
      out[c.nome] = v;
    }
    if (t === 'profiles') out.id = localUserId;
    else if ('user_id' in out) out.user_id = localUserId;
    return out;
  }

  function upsertLocal(d: SyncDb, t: TabelaSync, linha: Linha) {
    const cols = Object.keys(linha);
    const sets = cols
      .filter((c) => c !== 'id')
      .map((c) => sql`${sql.identifier(c)} = excluded.${sql.identifier(c)}`);
    const conflito: SQL =
      sets.length > 0 ? sql`do update set ${sql.join(sets, sql`, `)}` : sql`do nothing`;
    d.run(
      sql`insert into ${sql.identifier(t)} (${sql.join(
        cols.map((c) => sql.identifier(c)),
        sql`, `,
      )}) values (${lista(cols.map((c) => linha[c]))}) on conflict (id) ${conflito}`,
    );
  }

  /** Aplica uma resposta do servidor numa transação só. */
  function aplicar(r: RespostaPull): number {
    let aplicadas = 0;
    db.transaction((tx) => {
      // A FK só é conferida no commit: a fatura paga e o pagamento apontam um
      // para o outro, e a ordem por tabela não resolve um ciclo.
      tx.run(sql`pragma defer_foreign_keys = on`);
      garantirEstado(tx);
      tx.run(sql`update sync_state set aplicando = 1 where id = 1`);

      const naFila = new Set(
        tx
          .all<{ tabela: string; row_id: string }>(sql`select distinct tabela, row_id from outbox`)
          .map((x) => `${x.tabela}:${x.row_id}`),
      );

      for (const t of TABELAS_SYNC) {
        for (const linha of r.tabelas[t] ?? []) {
          if (naFila.has(`${t}:${String(linha.id)}`)) continue;
          upsertLocal(tx, t, paraLocal(t, linha));
          aplicadas++;
        }
      }

      tx.run(
        sql`update sync_state set aplicando = 0, cursor = ${r.cursor}, ultimo_pull_em = ${nowIso()} where id = 1`,
      );
    });
    return aplicadas;
  }

  /** Coloca na fila TODAS as linhas locais. Para dados criados antes de o
   *  outbox existir (o app rodou sem login até o M1). */
  function enfileirarTudo() {
    const ts = nowIso();
    db.transaction((tx) => {
      for (const t of TABELAS_SYNC) {
        tx.run(
          sql`insert into outbox (tabela, row_id, op, payload, created_at)
              select ${t}, id, 'upsert', '', ${ts} from ${sql.identifier(t)}`,
        );
      }
    });
  }

  function temDadosLocais(): boolean {
    return !!db.get(sql`select 1 as x from profiles limit 1`);
  }

  // --------------------------------------------------------------------- API

  async function push(): Promise<number> {
    const ate = db.get<{ s: number | null }>(sql`select max(seq) as s from outbox`)?.s;
    if (ate === null || ate === undefined) return 0;

    const naFila = db.all<{ tabela: TabelaSync; row_id: string }>(
      sql`select distinct tabela, row_id from outbox where seq <= ${ate}`,
    );

    const mudancas: Mudanca[] = [];
    for (const t of TABELAS_SYNC) {
      const ids = naFila.filter((x) => x.tabela === t).map((x) => x.row_id);
      const daTabela: Mudanca[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const linhas = db.all<Linha>(
          sql`select * from ${sql.identifier(t)} where id in (${lista(ids.slice(i, i + 500))})`,
        );
        for (const linha of linhas) daTabela.push({ tabela: t, linha: paraServidor(t, linha) });
      }
      // id_externo é único no servidor, e o índice não espera o fim da
      // transação. Reimportar move o id de uma linha excluída para uma nova:
      // a que LARGA o id tem que chegar antes da que o pega, senão o lote
      // inteiro é recusado (visto no aparelho, depois de "começar do zero").
      if (t === 'transactions') {
        daTabela.sort((a, b) => Number(a.linha.id_externo != null) - Number(b.linha.id_externo != null));
      }
      mudancas.push(...daTabela);
    }

    try {
      if (mudancas.length > 0) await transporte.push(mudancas);
    } catch (e) {
      db.run(sql`update outbox set tentativas = tentativas + 1 where seq <= ${ate}`);
      throw e;
    }

    // Só o que foi lido. Uma edição feita durante o envio tem seq maior e
    // fica para o próximo push.
    db.transaction((tx) => {
      tx.run(sql`delete from outbox where seq <= ${ate}`);
      garantirEstado(tx);
      tx.run(sql`update sync_state set ultimo_push_em = ${nowIso()} where id = 1`);
    });
    return mudancas.length;
  }

  async function pull(): Promise<number> {
    const r = await transporte.pull(estado().cursor);
    return aplicar(r);
  }

  /** Primeiro login neste aparelho. Decide de onde vêm os dados:
   *
   *  - aparelho vazio, nuvem com dados  -> baixa (reinstalou, trocou de celular)
   *  - aparelho com dados, nuvem vazia  -> sobe (dados de antes do login)
   *  - os dois vazios                    -> conta nova; o app semeia depois
   *  - os dois com dados                 -> RECUSA. Juntar duplicaria as
   *    categorias padrão e misturaria dois históricos; quem decide qual fica
   *    é a pessoa, não o código.
   *
   *  Outra pessoa logando num aparelho que já tem dono também é recusada.
   */
  async function prepararAparelho(uid: string): Promise<ResultadoPreparo> {
    garantirEstado();
    const { dono } = estado();
    if (dono === uid) return 'ja_pronto';
    if (dono !== null) {
      throw new ErroDeSync(
        'outro_usuario',
        'Este aparelho tem os dados de outra conta. Saia e apague os dados locais antes de entrar com outra.',
      );
    }

    const r = await transporte.pull(null);
    const nuvemTemDados = (r.tabelas.profiles?.length ?? 0) > 0;
    const localTemDados = temDadosLocais();

    if (nuvemTemDados && localTemDados) {
      throw new ErroDeSync(
        'conflito_primeiro_login',
        'Este aparelho e a sua conta na nuvem já têm dados. Escolha qual manter.',
      );
    }

    aplicar(r);
    if (localTemDados) enfileirarTudo();
    db.run(sql`update sync_state set dono = ${uid} where id = 1`);

    if (nuvemTemDados) return 'baixou_da_nuvem';
    return localTemDados ? 'subiu_dados_locais' : 'novo';
  }

  /** Apaga TUDO do aparelho: dados, fila e estado do sync. Usado ao sair da
   *  conta e para resolver o conflito do primeiro login em favor da nuvem. */
  function apagarDadosLocais() {
    db.transaction((tx) => {
      tx.run(sql`pragma defer_foreign_keys = on`);
      for (const t of [...TABELAS_SYNC].reverse()) tx.run(sql`delete from ${sql.identifier(t)}`);
      tx.run(sql`delete from outbox`);
      tx.run(sql`delete from sync_state`);
    });
  }

  let emAndamento: Promise<{ enviadas: number; recebidas: number }> | null = null;

  /** Push e depois pull. Push primeiro: assim o pull já encontra no servidor
   *  o que o aparelho acabou de mandar. Chamadas simultâneas (abrir o app,
   *  voltar do segundo plano, botão) compartilham a mesma execução.
   *
   *  `uid` é quem está logado AGORA. Se não for o dono do aparelho, recusa:
   *  o servidor carimba o dono pelo token, então sincronizar com outra sessão
   *  subiria os dados deste aparelho para a conta de outra pessoa. */
  function sincronizar(uid: string) {
    const { dono } = estado();
    if (dono !== uid) {
      return Promise.reject(
        new ErroDeSync(
          'outro_usuario',
          dono === null
            ? 'Este aparelho ainda não foi preparado para nenhuma conta.'
            : 'A conta logada não é a dona dos dados deste aparelho. Nada foi sincronizado.',
        ),
      );
    }
    if (emAndamento) return emAndamento;
    emAndamento = (async () => {
      try {
        const enviadas = await push();
        const recebidas = await pull();
        return { enviadas, recebidas };
      } finally {
        emAndamento = null;
      }
    })();
    return emAndamento;
  }

  return {
    estado,
    pendentes,
    temDadosLocais,
    push,
    pull,
    sincronizar,
    prepararAparelho,
    apagarDadosLocais,
  };
}

export type Sync = ReturnType<typeof createSync>;
