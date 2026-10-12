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

**Validado no Android:** M0, M2 (cartão), grupo 1 e M1 (login, backup e
sincronização com o Supabase, com as duas contas reais). O app roda como
**APK** nos dois celulares (seção "App instalável").

**Pronto, não visto no aparelho:** grupo 2 (recorrente, parcelado em conta,
"só esta / próximas / todas", pago ou pendente), ícone na categoria,
orçamento por categoria (aba nova) e rosca de gastos. **Todos os 23
obrigatórios feitos**; paridade **72,9/100**. `npm run verify`: **146 testes**.

**Não visto no aparelho:** tudo da linha acima e pagar a fatura (as regras
estão testadas).

**Próximo:** validar no aparelho e gerar um APK novo. Depois, os desejáveis
(`should` em [`replica/features.csv`](replica/features.csv)): busca e filtro,
alertas, exportar CSV, importar OFX/CSV, login com Google. `python
~/.claude/skills/replica-diff/parity.py replica/features.csv` recalcula a
paridade.

## Supabase (M1) — passo a passo

Sem as chaves do passo 5, o app roda só local, como antes: nada trava
enquanto o projeto não existe. A interface do Supabase muda de vez em quando;
se um menu não estiver com o nome daqui, procure pelo equivalente.

### 1. Conta

Em supabase.com → **Start your project**. Entrar com GitHub ou e-mail. Se
pedir uma organização, qualquer nome (ex.: "Pessoal"), plano **Free**.

### 2. Projeto

**New project**:

- **Name:** `money-log` (é só um rótulo; não precisa bater com nada no código);
- **Database Password:** *Generate a password* e guardar num gerenciador de
  senhas. O app não usa essa senha, mas ela é a única entrada direta no banco;
- **Region:** **South America (São Paulo)**, `sa-east-1`;
- **Security:**
  - **Enable Data API: marcado.** O app fala com o banco por ela;
  - **Automatically expose new tables: desmarcado**, como o Supabase
    recomenda. As permissões estão explícitas no `schema.sql` (nota [A]):
    o usuário logado lê, insere e atualiza, mas não apaga; o anônimo não faz
    nada. Os testes rodam com e sem essa opção;
  - **Enable automatic RLS: marcado.** Rede de segurança para tabelas
    futuras; o `schema.sql` já liga e força a RLS em todas as atuais.

**Create new project** e esperar 1–2 minutos.

### 3. Schema

**SQL Editor** → **New query** → colar [`replica/schema.sql`](replica/schema.sql)
inteiro (Ctrl+A, Ctrl+C no VS Code) → **Run**.

- Tem que terminar em **"Success. No rows returned"**.
- Se avisar de operações destrutivas, pode confirmar: o projeto está vazio.
- Se der erro, guardar a mensagem inteira. O schema já rodou num Postgres
  real (PGlite), mas não no Supabase.

### 4. Confirmação de e-mail (decisão)

**Authentication** → **Sign In / Providers** → **Email** → "Confirm email":

- **desligado:** o cadastro entra direto. Razoável para duas pessoas que se
  conhecem. **Save**;
- **ligado:** o cadastro manda um link. Clicar nele abre uma página de erro
  ("localhost") no navegador, mas a conta fica confirmada; aí é só entrar no
  app.

### 5. Chaves e `.env.local`

**Project Settings** (engrenagem) → **API Keys**. A URL pode estar em
**Data API** ou no botão **Connect**, no topo do painel. Copiar:

- **Project URL** — `https://<id-do-projeto>.supabase.co`;
- **Publishable key** — começa com `sb_publishable_`. Se só houver o formato
  antigo, a **anon public** (longa, começa com `eyJ`).

**Nunca** a `secret` / `service_role`: ela ignora a RLS e iria dentro do app.

Criar `.env.local` na raiz do projeto (fica fora do git, pelo `.gitignore`),
sem aspas e sem espaço em volta do `=`:

```
EXPO_PUBLIC_SUPABASE_URL=https://<id-do-projeto>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=<publishable key, ou a anon>
```

### 6. Rodar

```powershell
npm.cmd start -- --clear
```

O `--clear` é obrigatório aqui: as variáveis entram no bundle na hora do
build, e o cache do Metro manteria o bundle sem elas.

No Expo Go, em vez do Início aparece a **tela de entrar**. "Ainda não tenho
conta" → e-mail e senha. Os lançamentos que já estão no aparelho sobem para a
conta. Conferir em **Início → Backup e conta**: "Último envio" com a hora de
agora e "Aguardando envio: nada".

### 7. Critério de pronto do M1, com as contas reais

- desinstalar o app (ou limpar os dados do Expo Go), reinstalar, entrar: os
  dados voltam;
- a outra pessoa cria a própria conta no celular dela;
- **isolamento**, no SQL Editor. Os dois ids estão em Authentication → Users:

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<id-da-pessoa-B>"}', true);
  select count(*) from transactions where user_id = '<id-da-pessoa-A>';
  rollback;
  ```

  Tem que dar **0**. Se der mais que zero, a RLS não está valendo e nada mais
  importa. (O mesmo teste roda em todas as tabelas no
  `src/sync/sync.test.ts`, mas lá o `auth` é imitação.)

## App instalável (APK Android, pelo EAS)

Para usar sem o computador e fora da rede de casa. O build roda na nuvem do
Expo (plano gratuito). iPhone exige conta de desenvolvedor da Apple
(US$ 99/ano); sem ela, iPhone só pelo Expo Go.

- `eas.json`: perfil `preview` gera APK para instalar direto; `production`
  gera o `.aab` da Play Store (não usado ainda).
- Identificador do app: `com.miguelangelo.moneylog` (`app.json`). **Não
  mudar depois de instalado**: outro identificador é outro app, com banco
  vazio.
- A aba "Design" só aparece no Metro (`__DEV__`), não no APK.
- O `.env.local` não sobe para o EAS (está no `.gitignore`). URL e chave do
  Supabase ficam nas variáveis do EAS, ambiente `preview`.

Passo a passo (versão do CLI fixa, para o build ser reproduzível):

1. Conta gratuita em expo.dev.
2. `npx.cmd eas-cli@24.8.0 login`
3. `npx.cmd eas-cli@24.8.0 init` — liga a pasta a um projeto do Expo e grava
   o `projectId` no `app.json`.
4. Variáveis do Supabase no ambiente `preview` (os mesmos valores do
   `.env.local`):

   ```powershell
   npx.cmd eas-cli@24.8.0 env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value <url> --visibility plaintext
   npx.cmd eas-cli@24.8.0 env:create --environment preview --name EXPO_PUBLIC_SUPABASE_KEY --value <publishable key> --visibility plaintext
   ```

5. `npx.cmd eas-cli@24.8.0 build -p android --profile preview` — na primeira
   vez, responder **sim** para gerar a keystore (o EAS guarda; ela assina
   todas as versões futuras). Leva de 10 a 20 minutos.
6. No fim sai um link e um QR code. Abrir no celular, baixar o APK e
   instalar (o Android pede para permitir instalar de fontes desconhecidas).

**Trocar do Expo Go para o APK no seu celular:** antes, conferir em "Backup
e conta" que "Aguardando envio" está em "nada". O APK é outro app, com banco
próprio e vazio: entra com a mesma conta e baixa tudo da nuvem.

**Mudou o código?** O APK não se atualiza sozinho: é preciso outro build e
instalar por cima (mesma keystore, os dados ficam). Atualização pelo ar
(EAS Update) fica para depois.

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
