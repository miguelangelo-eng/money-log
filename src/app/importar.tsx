/** Importar extrato do banco: conta (OFX ou CSV) ou fatura do cartão (CSV).
 *
 *  Quatro passos: escolher o arquivo, confirmar o destino, revisar a prévia
 *  (cada linha já vem classificada e pode ser corrigida com um toque) e ver o
 *  resultado — com a conferência do saldo, quando o arquivo traz o saldo.
 *
 *  Nada é gravado antes de "Importar": a prévia é só leitura, e a gravação é
 *  tudo ou nada (src/data/importacao.ts).
 */

import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Field, Row, SectionHeader, Txt } from '@/components/ui/primitives';
import { OptionList } from '@/components/ui/widgets';
import {
  descricaoDoLancamento,
  type Acao,
  type Arquivo,
  type ConferenciaDeSaldo,
  type LinhaPrevia,
  type OutraConta,
  type Previa,
  type ResultadoImportacao,
} from '@/data/importacao';
import { cards, importacao, listAccounts, listCategories } from '@/data/ledger';
import { useAsync } from '@/data/use-async';
import { radius, space, useTheme } from '@/design/theme';
import { parse } from '@/lib/civil-date';
import { lerExtrato, type Extrato } from '@/lib/extrato/ler';
import { normalizar } from '@/lib/extrato/regras';
import { formatCents } from '@/lib/money';

type Etapa =
  | { tipo: 'inicio' }
  | { tipo: 'destino'; extrato: Extrato; arquivo: Arquivo }
  | { tipo: 'previa'; previa: Previa; original: Previa; arquivo: Arquivo }
  | { tipo: 'pronto'; r: ResultadoImportacao; contaId: string | null };

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dataCurta = (d: string) => {
  const { day, month } = parse(d);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};

const comSinal = (cents: number) => `${cents < 0 ? '−' : '+'} ${formatCents(Math.abs(cents))}`;

export default function Importar() {
  const t = useTheme();
  // O app desenha até a borda: o rodapé fixo precisa pular a barra de
  // navegação do Android, senão o botão fica embaixo dela.
  const inset = useSafeAreaInsets();
  const router = useRouter();
  const contas = useAsync(() => listAccounts(), ['contas']);
  const cartoes = useAsync(() => cards.listCards(), ['cartoes']);
  const cats = useAsync(() => listCategories(), ['cats-todas']);

  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'inicio' });
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contasAtivas = (contas.data ?? []).filter((c) => !c.arquivada);
  const nomeDaConta = (o: OutraConta) => ('id' in o ? (contasAtivas.find((c) => c.id === o.id)?.nome ?? 'conta') : o.nova);
  const nomeDaCategoria = (id: string | null) => (id ? (cats.data ?? []).find((c) => c.id === id)?.nome : null);

  function rotulo(l: LinhaPrevia): string {
    const a = l.acao;
    switch (a.tipo) {
      case 'despesa':
      case 'receita':
        return nomeDaCategoria(a.categoryId) ?? 'Sem categoria';
      case 'transferencia':
        return `Transferência ${l.linha.valorCents < 0 ? 'para' : 'de'} ${nomeDaConta(a.outra)}`;
      case 'pagamento_fatura':
        return 'Pagamento de fatura';
      case 'conciliar':
        return 'Já lançado no app';
      case 'ignorar':
        return 'Ignorar';
    }
  }

  /** Destino provável: a conta com o nome do banco, ou a primeira. */
  function sugerirDestino(e: Extrato): string | null {
    if (e.origem === 'cartao') return cartoes.data?.[0]?.id ?? null;
    const banco = e.nome.toLowerCase().includes('nubank') ? 'nubank' : null;
    const porNome = banco ? contasAtivas.find((c) => normalizar(c.nome).includes(banco)) : undefined;
    return (porNome ?? contasAtivas.find((c) => c.tipo === 'corrente') ?? contasAtivas[0])?.id ?? null;
  }

  async function escolherArquivo() {
    setErro(null);
    // Sem cópia para o cache: lê o arquivo pelo content:// que o Android
    // entrega. A cópia caía numa pasta que o expo-file-system não deixa ler
    // ("Missing 'READ' permission", visto no Expo Go); content:// passa.
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
    if (r.canceled) return;
    const a = r.assets[0];
    setOcupado(true);
    try {
      const texto = await new File(a.uri).text();
      const extrato = lerExtrato(texto);
      if (extrato.linhas.length === 0) throw new Error('O arquivo não tem nenhum lançamento.');
      // O hash é do conteúdo: o mesmo extrato com outro nome continua sendo
      // o mesmo extrato.
      const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, texto);
      setDestinoId(sugerirDestino(extrato));
      setEtapa({ tipo: 'destino', extrato, arquivo: { nome: a.name, sha256 } });
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setOcupado(false);
    }
  }

  async function verPrevia(extrato: Extrato, arquivo: Arquivo) {
    if (!destinoId) return;
    setErro(null);
    setOcupado(true);
    try {
      const previa = await importacao.prever(
        extrato,
        extrato.origem === 'conta' ? { tipo: 'conta', contaId: destinoId } : { tipo: 'cartao', cartaoId: destinoId },
      );
      setEtapa({ tipo: 'previa', previa, original: previa, arquivo });
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setOcupado(false);
    }
  }

  async function gravar(previa: Previa, arquivo: Arquivo) {
    setErro(null);
    setOcupado(true);
    try {
      const r = await importacao.importar(previa, arquivo);
      setEtapa({ tipo: 'pronto', r, contaId: previa.destino.tipo === 'conta' ? previa.destino.contaId : null });
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setOcupado(false);
    }
  }

  const erroTxt = erro ? (
    <Txt variant="sm" color="danger" style={{ marginTop: space[3] }}>
      {erro}
    </Txt>
  ) : null;

  // ------------------------------------------------------------- 1. arquivo
  if (etapa.tipo === 'inicio') {
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
        <Txt variant="base">
          No app do banco, exporte o extrato da conta (OFX ou CSV) ou a fatura do cartão (CSV) e escolha o arquivo aqui.
        </Txt>
        <Txt variant="sm" color="textMuted">
          {'Você revisa cada linha antes de gravar. O que já foi importado ou lançado à mão não duplica.'}
        </Txt>
        <Card>
          <Txt variant="sm" style={{ fontWeight: '600' }}>
            Dica de ordem
          </Txt>
          <Txt variant="sm" color="textMuted" style={{ marginTop: space[1] }}>
            {'Importe a fatura do cartão antes do extrato da conta: assim o "Pagamento de fatura" da conta já encontra a fatura e a marca como paga.'}
          </Txt>
          <Txt variant="sm" color="textMuted" style={{ marginTop: space[1] }}>
            {'Prefira o OFX da conta: ele traz o saldo final, e o app confere se a conta fecha com o banco.'}
          </Txt>
        </Card>
        <Button label="Escolher arquivo" onPress={() => void escolherArquivo()} loading={ocupado} disabled={ocupado} />
        {erroTxt}
      </ScrollView>
    );
  }

  // ------------------------------------------------------------- 2. destino
  if (etapa.tipo === 'destino') {
    const { extrato, arquivo } = etapa;
    const conta = extrato.origem === 'conta';
    const opcoes: Array<{ id: string; nome: string }> = conta ? contasAtivas : (cartoes.data ?? []);
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
        <Card>
          <Txt variant="lg">{extrato.nome}</Txt>
          <Txt variant="sm" color="textMuted">
            {`${extrato.linhas.length} linhas, de ${dataCurta(extrato.linhas.map((l) => l.data).sort()[0])} a ${dataCurta(
              extrato.linhas.map((l) => l.data).sort().at(-1)!,
            )}`}
          </Txt>
        </Card>
        <SectionHeader>{conta ? 'Em qual conta?' : 'Em qual cartão?'}</SectionHeader>
        {opcoes.length === 0 ? (
          <>
            <Txt variant="sm" color="textMuted">
              {conta ? 'Cadastre a conta primeiro.' : 'Cadastre o cartão primeiro, com o dia de fechamento certo.'}
            </Txt>
            <Button
              label={conta ? 'Nova conta' : 'Novo cartão'}
              variant="secondary"
              onPress={() => router.push(conta ? '/conta-nova' : '/cartao-novo')}
            />
          </>
        ) : (
          <OptionList itens={opcoes} selecionadoId={destinoId} rotulo={(c) => c.nome} onSelect={(c) => setDestinoId(c.id)} />
        )}
        <Button
          label="Ver prévia"
          onPress={() => void verPrevia(extrato, arquivo)}
          loading={ocupado}
          disabled={ocupado || !destinoId}
        />
        <Button label="Outro arquivo" variant="ghost" onPress={() => setEtapa({ tipo: 'inicio' })} />
        {erroTxt}
      </ScrollView>
    );
  }

  // ------------------------------------------------------------ 4. pronto
  if (etapa.tipo === 'pronto') {
    return (
      <Resultado
        r={etapa.r}
        contaId={etapa.contaId}
        onConcluir={() => router.back()}
        onAtualizarSaldo={(saldo) => setEtapa({ ...etapa, r: { ...etapa.r, saldo } })}
      />
    );
  }

  // ------------------------------------------------------------- 3. prévia
  const { previa, original, arquivo } = etapa;
  const ativas = previa.linhas.filter((l) => l.acao.tipo !== 'ignorar');
  const gastos = previa.linhas.filter((l) => l.acao.tipo === 'despesa').reduce((s, l) => s - l.linha.valorCents, 0);
  const entradas = previa.linhas.filter((l) => l.acao.tipo === 'receita').reduce((s, l) => s + l.linha.valorCents, 0);

  function aplicar(i: number, acao: Acao) {
    // A mesma escolha vale para as outras linhas com o mesmo texto e sentido
    // ("99 Ride" vinte vezes), menos as que o app já ligou a algo existente.
    const alvo = previa.linhas[i];
    const espalha = acao.tipo === 'despesa' || acao.tipo === 'receita' || acao.tipo === 'transferencia';
    const linhas = previa.linhas.map((l, j) => {
      const igual =
        espalha &&
        normalizar(l.linha.descricao) === normalizar(alvo.linha.descricao) &&
        Math.sign(l.linha.valorCents) === Math.sign(alvo.linha.valorCents) &&
        ['despesa', 'receita', 'transferencia'].includes(l.acao.tipo);
      return j === i || igual ? { ...l, acao } : l;
    });
    setEtapa({ tipo: 'previa', previa: { ...previa, linhas }, original, arquivo });
    setEditando(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.tela}>
        <Card>
          <Txt variant="sm" color="textMuted">
            {`${previa.linhas.length} linhas novas${previa.jaImportadas ? ` · ${previa.jaImportadas} já importadas antes` : ''}`}
          </Txt>
          <Txt variant="base" style={{ marginTop: space[1] }}>
            {`Gastos: ${formatCents(gastos)} · Entradas: ${formatCents(entradas)}`}
          </Txt>
          <Txt variant="xs" color="textMuted" style={{ marginTop: space[1] }}>
            {'Transferências, pagamento de fatura e linhas ignoradas não contam como gasto. Toque numa linha para mudar.'}
          </Txt>
        </Card>

        {previa.linhas.length === 0 ? (
          <Txt variant="base">Tudo deste arquivo já está no app.</Txt>
        ) : (
          previa.linhas.map((l, i) => (
            <Row
              key={l.linha.idExterno}
              onPress={() => setEditando(i)}
              accessibilityLabel={`${descricaoDoLancamento(l.linha)}, ${comSinal(l.linha.valorCents)}, dia ${dataCurta(l.linha.data)}, ${rotulo(l)}`}
              style={[styles.linha, { borderColor: t.border, opacity: l.acao.tipo === 'ignorar' ? 0.6 : 1 }]}>
              <Txt variant="xs" color="textMuted" style={styles.data}>
                {dataCurta(l.linha.data)}
              </Txt>
              <View style={styles.meio}>
                <Txt variant="base" numberOfLines={1}>
                  {descricaoDoLancamento(l.linha)}
                </Txt>
                <Txt variant="xs" color={l.acao.tipo === 'ignorar' ? 'textMuted' : 'accent'}>
                  {rotulo(l)}
                </Txt>
                {l.motivo ? (
                  <Txt variant="xs" color="textMuted">
                    {l.motivo}
                  </Txt>
                ) : null}
              </View>
              <Txt variant="sm" color={l.linha.valorCents < 0 ? 'text' : 'success'} style={styles.valor}>
                {comSinal(l.linha.valorCents)}
              </Txt>
            </Row>
          ))
        )}
        {erroTxt}
      </ScrollView>

      <View
        style={[
          styles.rodape,
          { borderColor: t.border, backgroundColor: t.surface, paddingBottom: space[4] + inset.bottom },
        ]}>
        <Button
          label={ativas.length === 0 ? 'Nada para importar' : `Importar ${ativas.length} ${ativas.length === 1 ? 'linha' : 'linhas'}`}
          onPress={() => void gravar(previa, arquivo)}
          loading={ocupado}
          disabled={ocupado || ativas.length === 0}
        />
      </View>

      {editando !== null ? (
        <FolhaDaLinha
          linha={previa.linhas[editando]}
          sugestao={original.linhas[editando]}
          contaDestino={previa.destino.tipo === 'conta' ? previa.destino.contaId : null}
          contas={contasAtivas}
          categorias={cats.data ?? []}
          rotulo={rotulo}
          iguais={
            previa.linhas.filter(
              (x) =>
                normalizar(x.linha.descricao) === normalizar(previa.linhas[editando].linha.descricao) &&
                Math.sign(x.linha.valorCents) === Math.sign(previa.linhas[editando].linha.valorCents),
            ).length
          }
          onEscolher={(a) => aplicar(editando, a)}
          onFechar={() => setEditando(null)}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Folha de uma linha: o que ela vira
// ---------------------------------------------------------------------------

function FolhaDaLinha({
  linha,
  sugestao,
  contaDestino,
  contas,
  categorias,
  rotulo,
  iguais,
  onEscolher,
  onFechar,
}: {
  linha: LinhaPrevia;
  sugestao: LinhaPrevia;
  contaDestino: string | null;
  contas: Array<{ id: string; nome: string }>;
  categorias: Array<{ id: string; nome: string; tipo: string; cor: string; icone: string }>;
  rotulo: (l: LinhaPrevia) => string;
  iguais: number;
  onEscolher: (a: Acao) => void;
  onFechar: () => void;
}) {
  const t = useTheme();
  const inset = useSafeAreaInsets();
  const [novaConta, setNovaConta] = useState('');
  const saida = linha.linha.valorCents < 0;
  const tipo = saida ? 'despesa' : 'receita';

  const opcoes = useMemo(() => {
    const o: Array<{ id: string; nome: string; acao: Acao; cor?: string; icone?: string }> = [];
    // O que o app tinha ligado (fatura, lançamento existente) continua
    // disponível depois de trocar.
    if (sugestao.acao.tipo === 'conciliar' || sugestao.acao.tipo === 'pagamento_fatura') {
      o.push({ id: 'sugestao', nome: rotulo(sugestao), acao: sugestao.acao });
    }
    for (const c of categorias.filter((x) => x.tipo === tipo)) {
      o.push({ id: `cat:${c.id}`, nome: c.nome, acao: { tipo, categoryId: c.id }, cor: c.cor, icone: c.icone });
    }
    o.push({ id: 'semcat', nome: `${saida ? 'Gasto' : 'Entrada'} sem categoria`, acao: { tipo, categoryId: null } });
    if (contaDestino) {
      for (const c of contas.filter((x) => x.id !== contaDestino)) {
        o.push({
          id: `conta:${c.id}`,
          nome: `Transferência ${saida ? 'para' : 'de'} ${c.nome}`,
          acao: { tipo: 'transferencia', outra: { id: c.id } },
        });
      }
    }
    o.push({ id: 'ignorar', nome: 'Ignorar esta linha', acao: { tipo: 'ignorar' } });
    return o;
  }, [sugestao, categorias, contas, contaDestino, tipo, saida, rotulo]);

  const atual = opcoes.find((x) => JSON.stringify(x.acao) === JSON.stringify(linha.acao))?.id ?? null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={styles.fundo}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]}
          onPress={onFechar}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
        />
        <View
          accessibilityViewIsModal
          style={[styles.folha, { backgroundColor: t.surface, paddingBottom: space[4] + inset.bottom }]}>
          <Txt variant="lg" numberOfLines={2}>
            {descricaoDoLancamento(linha.linha)}
          </Txt>
          <Txt variant="sm" color="textMuted">
            {`${comSinal(linha.linha.valorCents)} em ${dataCurta(linha.linha.data)}`}
            {iguais > 1 ? ` · a escolha vale para as ${iguais} linhas iguais` : ''}
          </Txt>
          <Txt variant="xs" color="textMuted" numberOfLines={3} style={{ marginTop: space[1] }}>
            {linha.linha.original}
          </Txt>
          <ScrollView style={{ marginTop: space[3] }} keyboardShouldPersistTaps="handled">
            <OptionList
              itens={opcoes}
              selecionadoId={atual}
              rotulo={(x) => x.nome}
              cor={(x) => x.cor ?? t.textMuted}
              icone={(x) => x.icone ?? (x.acao.tipo === 'transferencia' ? 'repeat' : 'tag')}
              onSelect={(x) => onEscolher(x.acao)}
            />
            {contaDestino ? (
              <View style={{ marginTop: space[3] }}>
                <Field
                  label={`Transferência ${saida ? 'para' : 'de'} uma conta nova`}
                  value={novaConta}
                  onChangeText={setNovaConta}
                  placeholder="Ex.: Santander"
                  dica="A conta é criada ao importar."
                />
                <Button
                  label="Usar conta nova"
                  variant="secondary"
                  disabled={novaConta.trim() === ''}
                  onPress={() => onEscolher({ tipo: 'transferencia', outra: { nova: novaConta.trim(), tipo: 'corrente' } })}
                />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Resultado e conferência de saldo
// ---------------------------------------------------------------------------

function Resultado({
  r,
  contaId,
  onConcluir,
  onAtualizarSaldo,
}: {
  r: ResultadoImportacao;
  contaId: string | null;
  onConcluir: () => void;
  onAtualizarSaldo: (s: ConferenciaDeSaldo) => void;
}) {
  const t = useTheme();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const s = r.saldo;

  async function ajustar() {
    if (!s || !contaId) return;
    setOcupado(true);
    setErro(null);
    try {
      await importacao.ajustarSaldoInicial(contaId, s.diferencaCents);
      onAtualizarSaldo(await importacao.conferirSaldo(contaId, s.data, s.bancoCents));
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setOcupado(false);
    }
  }

  const partes = [
    `${r.importadas} ${r.importadas === 1 ? 'lançamento importado' : 'lançamentos importados'}`,
    r.conciliadas ? `${r.conciliadas} já estavam no app (só marcados)` : null,
    r.ignoradas ? `${r.ignoradas} ignorados` : null,
    r.jaImportadas ? `${r.jaImportadas} já importados antes` : null,
  ].filter(Boolean);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.tela}>
      <Txt variant="lg">{'✓ Importação concluída'}</Txt>
      {partes.map((p) => (
        <Txt key={p} variant="base">
          {p}
        </Txt>
      ))}

      {s ? (
        <Card>
          <Txt variant="sm" color="textMuted">
            {`Saldo em ${dataCurta(s.data)}`}
          </Txt>
          <Txt variant="base">{`No banco: ${formatCents(s.bancoCents)}`}</Txt>
          <Txt variant="base">{`No app: ${formatCents(s.appCents)}`}</Txt>
          {s.diferencaCents === 0 ? (
            <Txt variant="base" color="success" style={{ marginTop: space[2] }}>
              {'✓ A conta fecha com o banco.'}
            </Txt>
          ) : (
            <>
              <Txt variant="sm" color="textMuted" style={{ marginTop: space[2] }}>
                {`Diferença de ${formatCents(Math.abs(s.diferencaCents))}. O comum é o saldo inicial da conta não ser o real, ou faltarem lançamentos de antes deste extrato.`}
              </Txt>
              <Button
                label={`Ajustar o saldo inicial em ${comSinal(s.diferencaCents)}`}
                variant="secondary"
                onPress={() => void ajustar()}
                loading={ocupado}
                disabled={ocupado}
                style={{ marginTop: space[3] }}
              />
            </>
          )}
        </Card>
      ) : null}
      {erro ? (
        <Txt variant="sm" color="danger">
          {erro}
        </Txt>
      ) : null}
      <Button label="Concluir" onPress={onConcluir} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { padding: space[4], gap: space[3], paddingBottom: space[8] },
  linha: { borderBottomWidth: StyleSheet.hairlineWidth, gap: space[3], paddingVertical: space[2] },
  data: { width: 40 },
  meio: { flex: 1 },
  valor: { textAlign: 'right' },
  rodape: { padding: space[4], borderTopWidth: StyleSheet.hairlineWidth },
  fundo: { flex: 1, justifyContent: 'flex-end' },
  folha: {
    maxHeight: '85%',
    padding: space[4],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
});
