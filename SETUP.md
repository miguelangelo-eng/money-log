# Projeto

App de controle financeiro pessoal. Expo / React Native, local-first.
Dois usuários com **finanças totalmente separadas** — tudo escopado por
`user_id`, nada compartilhado.

Planejamento em [`replica/`](replica/): [recon](replica/recon.md) ·
[arquitetura](replica/architecture.md) · [schema](replica/schema.sql) ·
[design](replica/design/components.md).

## Rodar

```powershell
npm install
npm run typecheck     # tsc do app + tsc dos testes
npm test              # 24 testes da lógica de dinheiro e fatura
npm start             # Expo dev server
```

Se `node` não for encontrado, o PATH da sessão está velho: feche e reabra o
terminal. Instalação em `C:\Program Files\nodejs`.

## Stack instalada

Expo SDK **57.0.27** · React Native **0.86.3** · React **19.2.3** ·
TypeScript **6.0.3** · expo-router · expo-sqlite · Drizzle ORM ·
@supabase/supabase-js · expo-crypto.

Versões resolvidas por `npx expo install`, nunca escritas à mão.

## Estado

### Pronto e verificado

| o que | verificação |
|---|---|
| `src/lib/civil-date.ts` — data civil sem fuso | typecheck + testes |
| `src/lib/money.ts` — centavos, pt-BR, parcelamento | **13 testes**, inclui invariante da soma em ~6.600 casos |
| `src/lib/invoice.ts` — ciclo de fatura | **11 testes**, inclui invariante de monotonicidade em todo dia de 2026 × 4 ciclos |
| `src/db/schema.ts` — Drizzle SQLite | `npm run db:generate` → 12 tabelas, `transactions` com 23 colunas / 7 índices / 6 FKs |
| `src/design/tokens.ts` + `theme.ts` | contraste 42 pares, 0 falhas AA; paleta validada no `validate_palette.js` |
| `drizzle/0000_*.sql` — migração inicial | gerada |
| shell do Expo | `npm run typecheck` exit 0 |

### Não feito

- **Telas do M0.** `src/app/` ainda tem as rotas de demonstração do template
  (`index.tsx`, `explore.tsx`). As telas reais — S02, S03, S08, S09, S05, S06,
  S04, S15 — são o `/replica-build`.
- **Rota `/design`** com os primitivos de
  [`components.md`](replica/design/components.md). É o primeiro item do build,
  antes de qualquer tela de produto.
- **Supabase.** Projeto não criado, [`replica/schema.sql`](replica/schema.sql)
  **nunca executado**. Esperar corrigir coisa — ver abaixo.
- **Camada de sync** (`outbox`, `pull_changes`, `push_changes`). Tabelas
  existem no schema; a lógica não.
- **Nada rodou em aparelho.** Nenhum pixel foi visto. Contraste foi
  verificado por cálculo; colisão de rótulo, tela de 320pt e teclado aberto só
  aparecem rodando.
- **Gráficos.** `victory-native` e `@shopify/react-native-skia` não instalados
  ainda — entram com a S15.

## Supabase (quando for a hora)

Criar projeto e aplicar [`replica/schema.sql`](replica/schema.sql) no SQL
Editor. Pontos onde eu esperaria erro, por nunca ter rodado:

- os dois blocos `DO $$` que criam trigger e política em laço;
- o índice `alerts_dedupe`, que usa `at time zone 'UTC'` para o cast ficar
  imutável;
- a FK adiada `invoices.pagamento_tx_id`, criada depois de `transactions`.

Depois, o teste que vale mais que todos: logar com uma conta e tentar
`select * from transactions` numa linha da outra. Tem que voltar vazio. Se
voltar dado, a RLS não está valendo e **nada mais importa**.

## Decisões tomadas durante o setup

**NativeWind caiu.** A especificação de design mandava classe utilitária
(`bg-surface`). O estável é 4.2.7, a v5 só em `rc`, peer declarado só de
`tailwindcss` — nada sobre RN 0.86 / React 19.2 — e o template vem com
`reactCompiler: true`, onde transform de Babel de terceiro quebra calado. O
caminho suportado no SDK 57, e o do próprio template, é `StyleSheet` + tema
tipado: `src/design/theme.ts`. Custo zero, porque os tokens sempre foram
valores crus.

**Azul↔vermelho no gráfico, medido.** Verde↔vermelho dá ΔE 7,2 sob protanopia
(banda de piso); azul↔vermelho dá 21,6. Três vezes melhor. Detalhe e tabela em
[`components.md`](replica/design/components.md#por-que-receita-não-é-verde-no-gráfico).

**Testes em config própria.** O `tsconfig.json` do app herda do Expo, que usa
`customConditions: ["react-native"]` — com isso `node:test` não resolve, e
está certo: no bundle do RN builtin do Node não existe. Os testes rodam em
Node e têm [`tsconfig.test.json`](tsconfig.test.json).

## Armadilhas desta máquina

- **`Set-Content -Encoding utf8` no PowerShell 5.1 grava BOM**, e BOM invalida
  JSON — quebrou o `app.json` e o `npx expo install` morreu com
  `Unexpected token '﻿'`. Para JSON, gravar sem BOM.
- **`node` fora do PATH de sessão antiga.** O instalador atualiza o PATH do
  registro, não o das sessões já abertas.
- **Não há Postgres nem Docker aqui.** O `schema.sql` não tem como ser
  validado localmente.
