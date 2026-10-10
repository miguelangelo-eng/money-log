# Componentes

Especificação dos 18 componentes da lista do [recon](../recon.md), mais dois
que o recon não viu e que o app precisa. Tokens: [`tokens.json`](tokens.json).
Contraste: **42 pares, 0 falhas em AA** (`python contrast.py tokens.json`, exit 0).

## Duas adaptações do skill, declaradas de saída

**1. O sistema não foi medido — foi projetado.** O skill manda medir dos
screenshots com conta-gotas. `replica/screens/` está vazio (ver a nota em
[`recon.md`](../recon.md#screens)), então não há o que medir. Isto não é o
sistema do Organizze aproximado de memória: é um sistema novo, derivado da
lista de componentes e dos estados que o recon registrou. As superfícies e os
8 slots categóricos vêm verbatim da instância validada do skill `dataviz`,
justamente para não serem chute.

**2. A11y aqui é React Native, não web.** O skill pede `<button>` real, `hover`
e `focus-visible` com anel de 2px. No RN isso não existe. A tradução, válida
para todos os blocos abaixo:

| web | React Native |
| --- | --- |
| `<button>` | `Pressable` + `accessibilityRole="button"` |
| `:hover` | não existe em toque — o estado é `pressed` |
| `:focus-visible` | foco de teclado externo/Switch Control: `accessible`, e anel só quando houver foco real |
| `aria-disabled` | `accessibilityState={{ disabled: true }}` |
| `aria-live` | `AccessibilityInfo.announceForAccessibility` |
| área de clique | `hitSlop` até **48dp** (`TARGET_MIN`) |

Regra que vale para o app inteiro: **nenhum estado é comunicado só por cor.**
Sempre cor + ícone, ou cor + sinal, ou cor + rótulo.

---

## Primitivos

```
Button
  variants  primary, secondary, ghost, danger
  sizes     sm 36, md 44, lg 52  (altura; todas com hitSlop até 48)
  states    default, pressed, disabled, loading, focado-por-teclado
  tokens    primary: bg accent / text on-accent · secondary: bg surface,
            border border · ghost: sem fundo, text accent · danger: bg
            fill-danger / text on-accent
            radius md · type base/600 · pressed: sobrepõe --alpha-press
  a11y      accessibilityRole="button"; em loading mantém o rótulo e adiciona
            accessibilityState={{ busy: true }} — nunca troca o texto por
            spinner sozinho, senão o leitor de tela perde o que o botão faz
  used on   todas
```

```
TextField                                        [o recon não listou; é base]
  variants  texto, numérico, multilinha
  states    default, focado, preenchido, erro, desabilitado, somente-leitura
  tokens    border border-input (4,99:1 — passa 3:1 de componente),
            focado: border accent + anel 2px accent
            erro: border fill-danger + ícone + mensagem em danger
  a11y      label SEMPRE visível, nunca só placeholder: placeholder como label
            desaparece ao digitar e quem usa leitor de tela perde o campo.
            Erro ligado por accessibilityLabel, e anunciado.
  used on   S02, S06, S09, S11, S14
```

```
MoneyInput                                 [Entrada de valor monetário]
  variants  despesa, receita, transferência
  states    vazio (R$ 0,00), digitando, inválido (zero), desabilitado
  tokens    type money (34/40/700) com fontVariant tabular-nums — sem isso os
            dígitos pulam de lugar enquanto se digita
            despesa: text danger · receita: text success
            SEMPRE com o sinal: −R$ 42,90 / +R$ 1.200,00
  comport.  teclado numérico; preenche da direita para a esquerda (digitar
            "4290" vira R$ 42,90); guarda centavos como inteiro, nunca float;
            formata por Intl.NumberFormat pt-BR, nunca por toFixed
  a11y      a cor NÃO carrega o sinal — o caractere − / + carrega.
            accessibilityLabel: "despesa de quarenta e dois reais e noventa"
  used on   S06
```

```
Select                        [Seletor de categoria · conta/cartão · ícone+cor]
  variants  categoria (grade com ícone+cor), conta/cartão (lista com saldo),
            ícone (grade), cor (grade dos 8 slots categóricos)
  states    fechado, aberto, com busca, vazio, criar-novo-inline, desabilitado
  tokens    gatilho como TextField; folha inferior em surface, radius lg no topo
  comport.  abre como bottom sheet, não como modal central — alcance do polegar.
            Busca aparece a partir de 8 itens. "Criar nova categoria" é a
            última opção da lista, para não abandonar o lançamento no meio.
  a11y      accessibilityRole="menu" + "menuitem"; item selecionado com
            accessibilityState={{ selected: true }}; fechar por gesto E por botão
  used on   S06, S09, S11, S14, S16
```

```
DatePicker
  variants  dia, mês
  states    hoje (default), passado, futuro, inválido
  tokens    dia selecionado: bg accent / text on-accent · hoje: border accent
  comport.  default é hoje. Data futura muda o lançamento para pago=false
            automaticamente, com aviso visível — é previsto, não realizado.
  a11y      navegável por leitor de tela como grade com rótulo de data completa
  used on   S06, S12, S15
```

```
MonthSwitcher                                        [Seletor de mês]
  variants  compacto (cabeçalho), com total
  states    mês atual, passado, futuro, carregando
  tokens    type lg/600 · setas como Button ghost, 48dp de alvo
  comport.  deslize horizontal também muda o mês. Não permite ir além de 12
            meses no futuro (nada materializado lá).
  a11y      as setas têm rótulo "mês anterior"/"mês seguinte", não "<" e ">"
  used on   S04, S12, S15, S16
```

```
TabBar
  variants  5 itens: Início, Lançamentos, (FAB), Relatórios, Metas
  states    ativo, inativo, com badge (alertas não lidos)
  tokens    bg surface, border-top border · ativo: text accent + ícone
            preenchido · inativo: text-muted + ícone de contorno
  a11y      estado ativo por accessibilityState={{ selected: true }}, não só
            pela cor; o ícone preenchido vs. contorno é a dica visual redundante
  used on   S03, S04, S15, S16
```

```
FAB
  variants  simples, expansível em 3 ações (despesa, receita, transferência)
  states    fechado, aberto, pressionado
  tokens    56dp, radius pill, bg accent, text on-accent, shadow pop
  comport.  no centro da TabBar. Abrir revela 3 ações rotuladas — ícone sem
            texto num app de dinheiro gera lançamento no tipo errado.
  a11y      accessibilityRole="button", label "novo lançamento"; aberto vira
            accessibilityViewIsModal para o leitor não vazar para a tela
  used on   S03, S04
```

```
TransactionRow                                  [Item de lançamento]
  variants  despesa, receita, transferência, parcelada (3/12)
  states    pago, pendente, atrasado, selecionado, excluindo (otimista)
  tokens    ícone da categoria (cor da categoria) · descrição type base ·
            valor type base/600 tabular com sinal · data type xs text-muted
            pendente: ícone de relógio + rótulo "pendente"
            atrasado: ícone de alerta + text danger + rótulo "atrasado"
  comport.  deslizar para a esquerda revela excluir; para a direita, marcar
            como pago. Ambas com desfazer no Toast.
  a11y      uma linha é UM nó de leitura: "Mercado, despesa de 320 reais,
            12 de outubro, pago, cartão Nubank" — não seis nós separados
  used on   S04, S12
```

```
BalanceCard                                         [Card de saldo]
  variants  conta, cartão, consolidado
  states    positivo, negativo, zero, oculto (modo privacidade), carregando
  tokens    bg surface, radius lg, shadow card · valor type money tabular
            negativo: text danger E parênteses ou sinal −, nunca só a cor
            oculto: •••• no lugar do valor, com botão de revelar
  a11y      modo privacidade também esconde do leitor de tela, senão o saldo
            sai no alto-falante no ônibus
  used on   S03, S08, S10
```

```
ProgressBar                      [Barra de progresso: limite e cartão]
  variants  limite de categoria, limite do cartão
  states    ok (<80%), atenção (80–100%), estourado (>100%)
  tokens    trilha surface-sunken, radius pill, altura 8
            ok: fill-success · atenção: fill-warning · estourado: fill-danger
            SEMPRE com o texto "R$ 820 de R$ 1.000 (82%)" ao lado
  a11y      accessibilityRole="progressbar" com accessibilityValue;
            o texto numérico é obrigatório — fill-warning tem 1,79:1 na
            superfície clara e NÃO pode carregar significado sozinho
  used on   S10, S16
```

```
EmptyState
  variants  um por tela, cada um com a sua ação
  states    —
  tokens    ilustração própria (nunca traçada da deles), título type lg,
            texto type sm text-muted, Button primary
  copy      escrita de zero, em pt-BR, dizendo o próximo passo concreto:
            S04 "Nenhum lançamento em outubro. Toque em + para registrar o
            primeiro." · S08 "Cadastre a sua primeira conta para começar."
  used on   S03, S04, S08, S10, S15, S16
```

```
Toast
  variants  sucesso, erro, com desfazer
  states    entrando, visível (4s; 8s quando tem desfazer), saindo
  tokens    bg surface, border border, shadow pop, radius md
            ícone obrigatório por variante
  a11y      announceForAccessibility no texto; o botão desfazer tem 48dp e
            não desaparece antes do tempo quando há leitor de tela ativo
  used on   todas
```

```
ConfirmSheet                                    [Modal de confirmação]
  variants  excluir ocorrência, excluir série, excluir conta (bloqueado)
  states    —
  tokens    folha inferior, scrim --alpha-scrim, Button danger
  comport.  "excluir série" diz QUANTAS linhas vão sair: "Excluir as 9
            parcelas restantes?". Excluir conta com lançamento é impedido
            (on delete restrict no banco) e oferece arquivar.
  a11y      accessibilityViewIsModal; a ação destrutiva nunca é o botão com
            foco inicial
  used on   S07, S09, S14
```

```
PullToRefresh
  variants  —
  states    idle, sincronizando, erro de sync, offline
  tokens    indicador em accent
  comport.  dispara o push/pull do outbox. Offline NÃO é erro: mostra
            "N alterações aguardando conexão", não um alerta vermelho.
  a11y      o estado é anunciado; offline com pendências é informação, não falha
  used on   S03, S04
```

```
SectionHeader                                   [o recon não listou]
  variants  data (na lista de lançamentos), seção (em configurações)
  tokens    type sm/600 text-muted, bg bg, sticky no topo da lista
  a11y      accessibilityRole="header"
  used on   S04, S12, S13, S17
```

---

## Gráficos (S15)

Aqui as regras vêm do skill `dataviz`, e elas mudaram a tela em relação ao
original. As decisões e o motivo:

### Por que a rosca ganhou uma lista embaixo

O `dataviz` admite rosca para parte-do-todo **só para leitura de relance e com
no máximo 6 segmentos**, e a classifica como errada para comparar valores
próximos — que é exatamente a pergunta real ("foi mercado ou foi restaurante
que me sangrou?"). O original resolve com a rosca sozinha.

Decisão: **mantemos a rosca** (ela é a leitura de relance, e é o que se espera
de um app de finanças) **limitada a 6 fatias** — as 5 maiores mais "Outras" —
**e abaixo dela uma lista ranqueada com barra horizontal e o valor**. A rosca
responde "como está dividido"; a lista responde "quem foi o culpado". Mesmos
dados, duas leituras, nenhuma delas dependendo de comparar ângulos.

A lista também é a **visão de tabela** que o `dataviz` exige para
acessibilidade, e é a **mitigação obrigatória** da *relief rule*: três dos oito
slots categóricos (aqua 2,74:1, amarelo 2,11:1, magenta 2,62:1) ficam abaixo de
3:1 na superfície clara. Sem rótulo direto e sem a lista de valores, o alívio
não se aplica e a tela está incorreta. Isso não é refinamento: é condição.

```
CategoryDonut
  dados     soma de despesas por categoria no mês, kind='despesa' apenas
  forma     rosca, máx 6 fatias (CATEGORIAS_MAX), 5 maiores + "Outras"
  cor       cor da própria categoria (categories.cor), cujo padrão oferecido
            no seletor são os 8 slots em ordem fixa. "Outras" usa text-muted.
  marcas    gap de 2px na cor da superfície entre fatias; sem sombra; sem 3D
  rótulos   rótulo direto (nome + valor) nas fatias que couberem; legenda
            sempre presente; número no centro = total de despesas do mês
  interação toque na fatia seleciona e destaca a linha correspondente na lista;
            não há hover em toque. Alvo de toque maior que a fatia.
  vazio     mês sem despesa mostra EmptyState, não uma rosca de 0%
  a11y      accessibilityLabel com as fatias em ordem e o percentual; a lista
            abaixo é a visão de tabela
  used on   S15
```

```
CategoryRankList
  dados     o mesmo da rosca, sem o teto de 6 — todas as categorias
  forma     barra horizontal por categoria, ordenada do maior para o menor
  cor       um tom só (accent) para todas as barras — o comprimento já carrega
            a magnitude, e gastar o canal de cor para repetir isso é
            desperdício. A identidade da categoria vem do ícone e do nome.
  marcas    extremidade arredondada 4px ancorada na linha de base; valor à
            direita, type sm tabular
  interação toque abre S04 filtrado por aquela categoria no mês
  used on   S15
```

```
IncomeExpenseBars
  dados     total de receita e total de despesa do mês
  forma     duas barras agrupadas por mês, até 6 meses de histórico
  cor       polar.receita (azul) e polar.despesa (vermelho)
  eixo      UM eixo y, em reais. Nunca dois eixos.
  marcas    extremidade arredondada 4px ancorada no zero; gap de 2px na cor da
            superfície entre barras adjacentes; grade recessiva em
            chart-gridline; eixo em text-axis
  rótulos   legenda sempre presente (2 séries); valor direto só na barra do mês
            selecionado, não em todas
  filtro    transferências EXCLUÍDAS (kind <> 'transferencia'). Contá-las aqui
            duplicaria o dinheiro — é o erro clássico desta classe de app, e
            está travado também por check constraint no banco.
  used on   S15
```

### Por que receita não é verde no gráfico

A convenção brasileira de app financeiro é verde para entrada e vermelho para
saída. No **gráfico** eu não segui: o par polar é **azul ↔ vermelho**, que é o
par documentado e validado do `dataviz`. O motivo é direto — verde contra
vermelho é precisamente o eixo que protanopia e deuteranopia colapsam, e são
as duas formas mais comuns de daltonismo. Duas barras lado a lado distinguidas
só por verde e vermelho são, para parte dos leitores, duas barras cinzas.

No **texto** a convenção fica de pé: valor de receita em `success`, de despesa
em `danger`, porque ali o sinal (+/−) e o próprio número carregam o
significado, e a cor é reforço, não portadora.

Isso deixa uma inconsistência consciente: azul no gráfico, verde na lista.
**Decisão fechada em 2026-10-10 com medição**, não mais por intuição. Rodado o
validador do `dataviz` nos dois pares e nos dois modos:

| par | ΔE protanopia (claro) | ΔE protanopia (escuro) | veredito |
|---|---|---|---|
| verde ↔ vermelho | **7,2** | 8,6 | `WARN` — banda de piso 6–8, legal só com codificação secundária |
| azul ↔ vermelho | **21,6** | 19,2 | `PASS` folgado |

Azul↔vermelho separa **três vezes melhor** sob a forma mais comum de
daltonismo. Fica como está, e a inconsistência com o texto é o preço, pago
conscientemente.

A mesma rodada confirmou os 8 slots categóricos: CVD `PASS` (pior par
adjacente ΔE 9,1), piso de visão normal `PASS` (19,6), e o `WARN` de contraste
listando exatamente `#1baf7a` 2,74 · `#eda100` 2,11 · `#e87ba4` 2,62 — os
mesmos três que o `contrast.py` apontou, com a mesma exigência de "relief
required (visible labels or table view)". A mitigação obrigatória descrita
acima é, literalmente, o que o validador pede.

### Sem NativeWind (revisto em 2026-10-10)

A especificação original mandava consumir os tokens por classe utilitária
(`bg-surface text-muted`) via NativeWind. **Caiu.** O estável mais recente é
4.2.7 e a v5 só existe em `rc`; ele declara peer apenas de `tailwindcss`, sem
palavra sobre React Native 0.86 ou React 19.2; e o template do Expo SDK 57 vem
com `reactCompiler: true`, que é exatamente onde um transform de Babel de
terceiro quebra de forma silenciosa. O próprio template oficial estiliza com
`StyleSheet` e tema tipado.

O consumo agora é `src/design/theme.ts`: `const t = useTheme()` e `t.surface`.
As chaves do tema continuam sendo o que impede hex cru de aparecer na tela —
o papel segue valendo, mudou só o mecanismo. Custo da troca: zero, porque os
tokens sempre foram valores crus.

---

## O que falta e por quê

O passo 4 do skill manda **construir os primitivos em código**, isolados numa
rota `/design`, e tirar screenshot — é esse o teste do sistema. Não construí:
não existe projeto Expo ainda (o M0 da [arquitetura](../architecture.md#ordem-de-build)
é que o cria). Então o que está entregue é **especificação verificada no que
dá para verificar por cálculo** (contraste: 42 pares, 0 falhas) e não
verificada no que só se vê rodando — colisão de rótulo na rosca com nome de
categoria longo, a barra de progresso em tela de 320pt, e a entrada de valor
com teclado aberto em aparelho pequeno.

A rota `/design` é o primeiro item do M0, antes de qualquer tela.
