# Build log

Uma linha por tela. O que foi mais difícil do que parecia fica registrado —
metade feita declarada é informação, metade feita escondida é dívida.

## 2026-10-10 — M0: shell, primitivos e fatia vertical do F02

| tela | estado | falta |
|---|---|---|
| `/design` (não é tela de produto) | **feito** | é o teste do sistema de design; sai do app quando o M0 fechar |
| S03 Início | **feito** | widget de cartões (não há cartão ainda) |
| S04 Lançamentos do mês | **feito** | busca, filtro, swipe para excluir, detalhe (S07) |
| S05+S06 Novo lançamento | **parcial** | só despesa e receita. Transferência, data escolhida, parcelamento, recorrência, anexo e observação não entraram |
| S15 Relatórios | **parcial** | a rosca por categoria exige Skia, não instalado. Barras e lista ranqueada prontas |
| S02 Login · S08 Contas · S09 Nova conta · S10–S12 Cartões · S13–S14 Categorias · S16 Metas · S18 Alertas · S19 Import | **não começadas** | — |

Paridade: **20,3 / 100** · must-haves **6 de 23**.

O número é baixo e está certo: o M0 nunca foi sobre cobertura, foi sobre provar
a stack ponta a ponta. O que existe é o caminho inteiro — migração do banco,
semente, escrita, leitura, agregação, duas telas de consulta — funcionando
sobre SQLite real, não sobre dado falso.

### Decisões de implementação

- **Banco local real desde o M0, não camada falsa.** O skill sugere dado de
  semente e camada falsa quando o backend ainda não existe. Aqui não é
  necessário: a arquitetura é local-first, então o SQLite **é** a fonte da
  verdade e não há o que mockar. O Supabase entra depois como réplica, e a
  troca é dentro de `src/data/ledger.ts` — nenhuma tela muda.
- **`useAsync` com refoco em vez de `useLiveQuery` do Drizzle.** A camada de
  dados é de Promises de propósito, para que a camada de sync (M1) não toque em
  tela nenhuma. `useLiveQuery` obrigaria a expor construtor de query para a UI,
  amarrando a tela ao Drizzle.
- **Sem rosca na S15, e isso não é só cosmético.** A lista ranqueada é a metade
  que responde "qual categoria me sangrou" e é também a visão de tabela que a
  acessibilidade exige. O que falta é a leitura de relance. Marcado `partial`,
  não `yes`.
- **Barras feitas com `View`, sem biblioteca de gráfico.** Barra horizontal é
  largura percentual; puxar Skia para isso seria desperdício. A rosca é o único
  gráfico que realmente precisa de Skia.

### O que foi mais difícil do que parecia

**Fazer a migração chegar ao dispositivo.** Três falhas em sequência, todas
encontradas por `expo export` e nenhuma por typecheck:

1. `drizzle-kit generate` sem `driver: 'expo'` não emite o `migrations.js` que
   o `useMigrations` importa. Só o `.sql`, que o app não tem como ler — não há
   sistema de arquivos para isso no bundle.
2. Com o `migrations.js` no lugar, o Metro não resolve `.sql`:
   `Unable to resolve module ./0000_xxx.sql`. Precisa de
   `config.resolver.sourceExts.push('sql')` num `metro.config.js` que o
   template do SDK 57 não traz.
3. Resolvendo, o Metro passa a tratar o `.sql` como JavaScript e morre com
   `Missing semicolon (1:6)`. Falta `babel-plugin-inline-import` configurado
   para `.sql`, que converte o import no conteúdo do arquivo como string.

São três peças que só funcionam juntas, e nenhuma delas aparece no typecheck.
É o argumento concreto para bundlar antes de declarar qualquer coisa pronta.

**Escape Unicode em JSX.** Escrevi `label="‹"` nas setas do seletor de mês
e `Carregando…` como texto de elemento. Em JSX, nem atributo string nem
texto de elemento processam escape — os dois teriam renderizado os caracteres
literais. Dentro de chaves (`label={'‹'}`) funciona. Pegos na revisão, não
pelo compilador: são strings válidas e o typecheck passa.

### Verificação

| portão | resultado |
|---|---|
| `npm run typecheck` | exit 0 (app + testes) |
| `npm test` | 24/24 |
| `npx expo export --platform android` | **exit 0**, 1406 módulos |
| `contrast.py` | 42 pares, 0 falhas AA |

### O que NÃO foi verificado

- **Nada rodou em aparelho nem em emulador.** Não há Android SDK nem
  emulador nesta máquina. O bundle compilar prova que o grafo de módulos
  fecha; não prova que a migração aplica, que a semente insere, que o saldo
  fecha ou que o toque funciona.
- **Nenhum screenshot.** `replica/clone-screens/` está vazio, então o
  `replica-diff` não terá comparação visual — nem teria referência, já que
  `replica/screens/` também está vazio desde o recon.
- **Os cálculos de saldo e de agregação não têm teste.** `accountBalances` e
  `expensesByCategory` são as duas funções onde um erro de sinal passa
  despercebido e aparece como "o app está errado". Merecem teste de unidade
  com banco em memória antes de qualquer tela nova.
- **Teclado, leitor de tela e tela de 320pt.** Especificados em
  `components.md`, não exercitados.

### Próximo passo

Rodar em aparelho (`npm start` e abrir no Expo Go) e percorrer o F02: abrir,
lançar uma despesa, ver na lista e no relatório. Até isso acontecer, o M0 está
compilando, não funcionando — e a diferença entre as duas coisas é o ponto todo
da fatia vertical.

Depois, na ordem: teste de `accountBalances`/`expensesByCategory`, S09 (criar
conta), S07 (editar e excluir), e então o M2 (cartão de crédito), que é onde a
lógica de `src/lib/invoice.ts` — já testada — finalmente é usada.
