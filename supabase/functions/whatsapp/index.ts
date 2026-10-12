// Edge Function do bot do WhatsApp (Supabase, Deno).
//
// A Meta chama esta URL a cada mensagem recebida pelo número do bot. Aqui só
// fica o que depende de rede: conferir a assinatura, falar com o banco e
// responder. A lógica mora em lugares testados:
//   - ler a mensagem: ../_shared/mensagem.ts (testes em src/sync/)
//   - vincular, lançar, desfazer: supabase/whatsapp.sql (testes no PGlite)
//
// Publicar SEM verificação de JWT (a Meta não manda JWT; quem autentica a
// chamada é a assinatura HMAC abaixo):
//   npx supabase functions deploy whatsapp --no-verify-jwt
//
// Segredos (supabase secrets set ...):
//   WHATSAPP_TOKEN            token de acesso da Cloud API (permanente)
//   WHATSAPP_APP_SECRET       "Chave secreta do app" na Meta — assina o webhook
//   WHATSAPP_VERIFY_TOKEN     texto qualquer, igual ao configurado no webhook
//   WHATSAPP_PHONE_NUMBER_ID  id do número do bot (não é o número em si)
//   GRAPH_API_VERSION         opcional; padrão abaixo
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase já injeta.

import {
  AJUDA_TEXTO,
  lerMensagem,
  reais,
  respostaDoLancamento,
} from '../_shared/mensagem.ts';

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`segredo ausente: ${k}`);
  return v;
};

const GRAPH = Deno.env.get('GRAPH_API_VERSION') ?? 'v25.0';

/** "Hoje" no fuso de quem usa o app, não no do servidor (UTC). */
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// ------------------------------------------------------------- assinatura

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Comparação em tempo constante: `===` em string para no primeiro byte
 *  diferente e vaza, pelo tempo, quantos bytes acertaram. */
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function assinaturaValida(corpo: string, cabecalho: string | null): Promise<boolean> {
  if (!cabecalho?.startsWith('sha256=')) return false;
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env('WHATSAPP_APP_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo));
  return iguais(`sha256=${hex(mac)}`, cabecalho);
}

// ------------------------------------------------------------ banco e Meta

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const chave = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function responder(para: string, texto: string): Promise<void> {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } }),
  });
  if (!r.ok) console.error('falha ao responder', r.status, await r.text());
}

// --------------------------------------------------------------- conversa

const NAO_VINCULADO =
  'Este número ainda não está ligado a uma conta.\n' +
  'No app: Backup e conta → Lançar pelo WhatsApp → gerar código, e mande aqui "vincular 123456".';

async function tratar(de: string, texto: string): Promise<string> {
  const hoje = hojeSaoPaulo();
  const cmd = lerMensagem(texto, hoje);

  switch (cmd.tipo) {
    case 'ajuda':
      return AJUDA_TEXTO;

    case 'nao_entendi':
      return `Não entendi. ${AJUDA_TEXTO}`;

    case 'vincular': {
      const r = await rpc<string>('whatsapp_vincular', { p_telefone: de, p_codigo: cmd.codigo });
      if (r === 'vinculado') return `✅ Pronto! Este número agora lança na sua conta.\n\n${AJUDA_TEXTO}`;
      if (r === 'bloqueado') return 'Muitas tentativas erradas. Espere uma hora e gere um código novo no app.';
      if (r === 'numero_em_uso') return 'Este número já está ligado a outra conta. Desconecte por lá primeiro.';
      return 'Código inválido ou vencido (vale 10 minutos). Gere outro no app.';
    }

    case 'desfazer': {
      const r = await rpc<{ ok: boolean; erro?: string; valor?: number; descricao?: string }>(
        'whatsapp_desfazer',
        { p_telefone: de },
      );
      if (r.ok) return `↩️ Apagado: ${r.descricao || 'lançamento'} de ${reais(r.valor!)}.`;
      return r.erro === 'nao_vinculado' ? NAO_VINCULADO : 'Não há lançamento recente para desfazer.';
    }

    case 'lancar': {
      const r = await rpc<{
        ok: boolean;
        erro?: string;
        tipo: string;
        valor: number;
        data: string;
        categoria: string | null;
        conta: string;
      }>('whatsapp_lancar', {
        p_telefone: de,
        p_kind: cmd.kind,
        p_valor: cmd.valorCents,
        p_data: cmd.data,
        p_palavras: cmd.palavras,
        p_descricao: cmd.descricao,
      });
      if (r.ok) return respostaDoLancamento(r, hoje);
      if (r.erro === 'nao_vinculado') return NAO_VINCULADO;
      return 'A conta escolhida para o WhatsApp não existe mais. Conecte de novo pelo app.';
    }
  }
}

// ------------------------------------------------------------------ servir

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação do webhook, feita uma vez pela Meta ao configurar.
  if (req.method === 'GET') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '') : new Response('proibido', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('método não suportado', { status: 405 });

  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers.get('x-hub-signature-256')))) {
    return new Response('assinatura inválida', { status: 401 });
  }

  // deno-lint-ignore no-explicit-any
  const evento: any = JSON.parse(corpo);
  for (const entry of evento.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        try {
          // A Meta reenvia quando demoramos: cada mensagem é tratada uma vez.
          if (!(await rpc<boolean>('whatsapp_registrar_mensagem', { p_id: msg.id }))) continue;
          const resposta =
            msg.type === 'text'
              ? await tratar(msg.from, msg.text?.body ?? '')
              : 'Por enquanto só entendo texto. Ex.: mercado 42,90';
          await responder(msg.from, resposta);
        } catch (e) {
          console.error('erro ao tratar mensagem', msg.id, e);
          await responder(msg.from, 'Algo deu errado aqui. Tente de novo em instantes.');
        }
      }
    }
  }
  // Sempre 200 para o que foi aceito: erro de uma mensagem não pode fazer a
  // Meta reenviar o lote inteiro (as outras já foram gravadas).
  return new Response('ok');
});
