# Money Log

App de controle financeiro pessoal. Expo / React Native, local-first.
Dois usuários com **finanças totalmente separadas** — tudo escopado por
`user_id`, nada compartilhado.

Planejamento em [`replica/`](replica/): [recon](replica/recon.md) ·
[arquitetura](replica/architecture.md) · [schema](replica/schema.sql) ·
[design](replica/design/components.md) · [build-log](replica/build-log.md)
(histórico, decisões e o que foi validado no aparelho).

## Rodar

```powershell
npm.cmd install
npm.cmd run verify    # typecheck do app e dos testes + testes + migração
npm.cmd start         # Expo dev server; abrir no Expo Go (Android)
```

`npm.cmd` e não `npm`: a política de execução do PowerShell desta máquina
bloqueia o `npm.ps1`. Se `node` não for encontrado, o PATH da sessão está
velho — feche e reabra o VS Code inteiro (aba nova de terminal herda o PATH
antigo). Instalação em `C:\Program Files\nodejs`.

Outros scripts: `npm.cmd test` (só os testes), `npm.cmd run db:generate`
(migração a partir de `src/db/schema.ts`), `npm.cmd run db:check` (aplica a
migração num SQLite em memória e verifica 14 invariantes).

Plataformas: só Android e iOS (`app.json`). Web está fora de escopo de
propósito: no navegador o expo-sqlite usa outro motor, e um build web verde
não provaria nada sobre o banco do aparelho (ver `metro.config.js`).

## Stack

Expo SDK **57** · React Native **0.86** · React **19.2** · TypeScript **6** ·
expo-router · expo-sqlite + Drizzle ORM · expo-crypto ·
@react-native-community/datetimepicker · @supabase/supabase-js +
react-native-url-polyfill (M1). Testes: node:test, node:sqlite e PGlite.
Estilo por `StyleSheet` + tema tipado (`src/design/theme.ts`), sem NativeWind.
Versões resolvidas por `npx expo install`, nunca à mão.

## Estrutura

```
src/app/            telas (expo-router): (tabs)/ + pilha raiz com os fluxos
src/components/ui/  primitivos e widgets — só tokens, nenhum hex solto
src/data/           repositórios injetáveis (ledger-repo, cards) + ledger.ts,
                    que os liga ao banco do aparelho
src/lib/            regras puras: data civil, dinheiro, fatura, cartão, saldo
src/db/             schema Drizzle do SQLite e cliente
src/sync/           motor de sync (engine.ts), cliente Supabase, sessão
src/test-support/   SQLite e Postgres reais em memória para os testes
drizzle/            migração gerada
replica/            planejamento, design, build-log, schema do Postgres
```

Os repositórios recebem banco, id, relógio e usuário por injeção. É o que
deixa os testes de `src/data/` rodarem contra o `node:sqlite` do Node 24 — o
mesmo motor do aparelho — com a migração real.

## Estado (2026-10-11)

**Validado no Android:** M0 (lançar e ver no relatório), M2 (cartão, compra
parcelada, fatura) e grupo 1 (editar e excluir lançamento, contas, data,
transferência, categorias). Paridade 46,4/100, must-haves **13 de 23**.
`npm run verify`: **114 testes**.

**M1 (sync e backup): código pronto, falta o Supabase.** Login, fila de
alterações, `push_changes`/`pull_changes` e a tela "Backup e conta" estão
testados de ponta a ponta contra um Postgres real em memória (PGlite), com
o `schema.sql` inteiro e a RLS. Nada rodou ainda no Supabase nem no aparelho.

**Não visto no aparelho:** pagar a fatura (a regra está testada) e todo o M1.

Depois do M1: grupo 2 (recorrência, "excluir só esta parcela", marcar pago ou
pendente), orçamento por categoria, rosca de gastos (precisa de Skia).
Lista completa em [`replica/features.csv`](replica/features.csv).

## Supabase (M1) — passo a passo

Sem estas variáveis o app roda só local, como antes: nada trava enquanto o
projeto não existe.

1. **Criar o projeto** em supabase.com (plano gratuito). Região: São Paulo
   (`sa-east-1`). Guarde a senha do banco num gerenciador de senhas; o app não
   a usa.
2. **Aplicar o schema:** SQL Editor → New query → colar
   [`replica/schema.sql`](replica/schema.sql) inteiro → Run. Tem que terminar
   sem erro. Ele já rodou num Postgres real (PGlite), mas não no Supabase.
3. **Confirmação de e-mail:** Authentication → Sign In / Providers → Email.
   Com "Confirm email" ligado, o cadastro manda um link e só entra depois de
   clicar nele (o link abre uma página de erro no navegador, mas confirma).
   Para duas pessoas que se conhecem, desligar é razoável.
4. **Chaves:** Project Settings → API Keys. Criar `.env.local` na raiz do
   projeto (fica fora do git):

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<id-do-projeto>.supabase.co
   EXPO_PUBLIC_SUPABASE_KEY=<publishable key, ou a anon>
   ```

   **Nunca** a `secret` / `service_role`: ela ignora a RLS e iria dentro do
   app.
5. **Reiniciar o Metro com cache limpo** (`npm.cmd start -- --clear`): as
   variáveis entram no bundle na hora do build.
6. **No celular:** a tela de entrar aparece. Criar conta. Os lançamentos que
   já estão no aparelho sobem para a conta. "Backup e conta" (no Início)
   mostra último envio e o que está na fila.
7. **Critério de pronto do M1, com as contas reais:**
   - desinstalar o app, reinstalar, entrar: os dados voltam;
   - a outra pessoa cria a própria conta no celular dela;
   - **isolamento**, no SQL Editor (troque os dois ids, que estão em
     Authentication → Users):

     ```sql
     begin;
     set local role authenticated;
     select set_config('request.jwt.claims', '{"sub":"<id-da-pessoa-B>"}', true);
     select count(*) from transactions where user_id = '<id-da-pessoa-A>';
     rollback;
     ```

     Tem que dar **0**. Se der mais que zero, a RLS não está valendo e nada
     mais importa. (O mesmo teste roda em todas as tabelas no
     `src/sync/sync.test.ts`, mas lá o `auth` é imitação.)

## Como o sync funciona

O SQLite do aparelho é a fonte da verdade; o Postgres é réplica e backup.
Triggers do SQLite põem cada linha alterada no `outbox`; o push manda as
linhas como estão naquele momento para `push_changes`, que grava tudo numa
transação e carimba o dono pelo token. O pull pede a `pull_changes` o que
mudou desde o cursor (relógio do servidor) e não sobrescreve linha que ainda
está na fila. Sincroniza ao abrir, ao voltar para o app, ao sair dele e a cada
15 s se houver fila. Detalhes e decisões: `src/sync/engine.ts`, nota [Y] do
`schema.sql` e o build-log.

## Decisões que não são óbvias pelo código

Cada uma tem o motivo completo no build-log ou no `schema.sql`.

- **Local-first:** o SQLite do aparelho é a fonte da verdade; o Postgres será
  réplica e backup. Funciona porque cada conjunto de dados tem um escritor só.
- **Data contábil é `date`, não `timestamptz`** (nota [D]): lida em UTC, a
  despesa do dia 1º cairia no mês anterior.
- **Fatura gravada na escrita** (nota [F]): mudar o dia de fechamento não
  reescreve faturas já pagas.
- **`pagamento_fatura` é um tipo próprio** (nota [G]): como despesa, cada compra
  no cartão contaria duas vezes.
- **Status da fatura derivado de datas**; só "paga" é persistido.
- **Excluir parcela apaga a compra inteira**; excluir pagamento o desfaz.
- **Azul↔vermelho no gráfico** de receita × despesa: verde↔vermelho dá ΔE 7,2
  sob protanopia, azul↔vermelho 21,6.
- **Sem NativeWind** (sem garantia para RN 0.86 + React Compiler) e **sem rotas
  tipadas** (o arquivo gerado listava `lib/` como rota).

## Armadilhas desta máquina

- **`Set-Content -Encoding utf8` no PowerShell 5.1 grava BOM**, e BOM invalida
  JSON (`Unexpected token '﻿'`). Para JSON, gravar sem BOM.
- **`npm` bloqueado pela política de execução** — usar `npm.cmd` / `npx.cmd`.
- **`node` fora do PATH de sessão antiga** — reabrir o VS Code inteiro.
- **Não há Postgres nem Docker.** O `schema.sql` é validado no PGlite
  (`src/test-support/postgres.ts`), com o `auth` do Supabase imitado. Lá o
  dono das tabelas é superusuário e **ignora a RLS**: teste de acesso tem que
  passar por `comoUsuario`.
- **SQL inválido só falha quando o SQLite executa** — nem o typecheck nem o
  bundle pegam. Por isso existe o `npm run db:check`.
