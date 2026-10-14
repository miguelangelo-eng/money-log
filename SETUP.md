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

## Estado (2026-10-12)

**Validado no Android:** M0, M2 (cartão), grupo 1, M1 (login, backup e
sincronização com o Supabase, com as duas contas reais), grupo 2, ícone na
categoria, orçamento e rosca de gastos. O app roda como **APK** nos dois
celulares (seção "App instalável"). **Todos os 23 obrigatórios feitos**.
`npm run verify`: **187 testes**.

**Importar extrato (versão 1.1.0):** feito e testado, ainda **não visto no
aparelho**. Exige APK novo e um SQL no Supabase: seção "Importar extrato do
banco".

Código em [github.com/miguelangelo-eng/money-log](https://github.com/miguelangelo-eng/money-log)
(público). Os commits usam o e-mail noreply do GitHub, configurado só neste
repositório; o GitHub recusa push que exponha o e-mail pessoal.

**Não visto no aparelho:** pagar a fatura (a regra está testada).

**Próximo:** os desejáveis
(`should` em [`replica/features.csv`](replica/features.csv)): busca e filtro,
alertas, exportar CSV, login com Google. `python
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

### Atualização pelo ar (EAS Update)

Mudança só de código (telas, regras, textos) chega aos celulares sem APK:

```powershell
npm.cmd run publicar -- "o que mudou, em uma linha"
```

O script roda o `verify` e só então publica no canal `preview` com as
variáveis do ambiente `preview` do EAS. **Não publicar com `eas update` à
mão sem `--environment preview`**: sem as variáveis do Supabase, o app
atualizado acha que não tem nuvem, cai no modo só local e para de
sincronizar, sem erro na tela.

No celular, a atualização é baixada numa abertura e aplicada na seguinte, ou
na hora por "Backup e conta → Verificar atualização". Os dados ficam: moram
no SQLite, não no bundle.

**Quando precisa de APK novo:** ao entrar ou mudar dependência NATIVA (o
que se instala com `npx expo install` e tem código Android, como
`react-native-svg`), plugin ou configuração nativa do `app.json`. Aí:
subir `version` no `app.json` (ex.: 1.0.0 → 1.1.0) e gerar o APK. A
`runtimeVersion` segue a versão do app (`policy: appVersion`), então uma
atualização nunca chega a um APK de versão diferente — que é o que impede
JavaScript novo de rodar sobre código nativo velho.

## Importar extrato do banco

Lê o extrato da conta (OFX ou CSV) e a fatura do cartão (CSV) do Nubank;
OFX de outros bancos também lê, com menos regras prontas. Entrada:
**Lançamentos → Importar extrato do banco**.

**Para ligar (uma vez):**

1. **SQL no Supabase**, antes da primeira importação: SQL Editor → colar
   [`supabase/importacao.sql`](supabase/importacao.sql) → Run. Acrescenta a
   coluna `id_externo`. Sem ela o backup perde o id das linhas importadas, e
   um celular restaurado importaria tudo de novo. Projeto novo já recebe
   isso pelo `replica/schema.sql`.
2. **APK novo** (versão 1.1.0): o seletor de arquivo é dependência nativa,
   então a atualização pelo ar não chega ao APK 1.0.0 — ver "Quando precisa
   de APK novo". `npx.cmd eas-cli@24.8.0 build -p android --profile preview`
   e instalar por cima nos dois celulares; os dados ficam.

**No app do Nubank:** conta → extrato → exportar (OFX ou CSV, escolher o
período); cartão → fatura → exportar CSV. O arquivo vai para Downloads.

**Ordem:** faturas primeiro (da mais antiga para a mais nova), depois a
conta. Cada linha de uma fatura vai para a fatura do app que corresponde ao
arquivo — não pela data da compra: o Nubank lança as parcelas no dia do
fechamento anterior. O "Pagamento de fatura" da conta pode ter **qualquer
valor** (o banco aceita pagar antes do fechamento e em partes): ele quita a
fatura fechada mais antiga que ainda deve; se nenhuma deve, adianta a fatura
em curso. A fatura fica "paga" quando os pagamentos cobrem o total e o
último é depois do fechamento.

**O que o app faz sozinho** (regras em `src/lib/extrato/regras.ts`; o resto
em `src/data/importacao.ts`):

- **Não duplica:** cada linha guarda o id do banco (`id_externo`). Extratos
  com períodos sobrepostos, ou o OFX e o CSV do mesmo mês, não duplicam; o
  mesmo arquivo de novo só traz o que falta. Linha importada e **excluída**
  não volta — a não ser que a importação inteira tenha sido excluída
  (importação desfeita: o arquivo entra de novo). O que foi lançado à mão (mesmo valor e sentido, até 3 dias de
  diferença) é **conciliado**: ganha o id do banco em vez de virar outro
  lançamento.
- **Pix no Crédito:** o par entrada/saída na conta é ignorado; o gasto vem na
  fatura.
- **RDB / caixinha:** transferência para a conta "Investimentos" (criada na
  primeira vez).
- **Aprende:** a escolha feita na prévia vira histórico. Categoria trocada
  é lembrada, e na prévia a escolha vale para as linhas iguais.
- **Pix vindo do seu próprio nome:** se a outra conta é acompanhada no app,
  é "Transferência de" essa conta. Se não é — o salário cai no Santander e
  vem por Pix para o Nubank —, para o app esse Pix é a **entrada**: marque
  como receita "Salário". Transferência já gravada se converte na tela do
  lançamento ("Converter em receita", inclusive "os iguais" de outros
  meses); a importação seguinte já sugere a receita.
- **Palpite de categoria** pela palavra (99/Uber → Transporte, Spotify →
  Assinaturas, ...), quando não há histórico. IOF herda a categoria da compra.
- **Fatura:** compra em fatura já paga no app não entra; parcela vira "Loja
  (7/10)"; estorno abate da fatura.
- **Saldo:** com OFX, compara o saldo final do banco com o do app e oferece
  ajustar o **saldo inicial** da conta (o caso típico: a conta foi cadastrada
  com zero). Não cria lançamento de ajuste, que contaria como receita.

**Privacidade:** o arquivo é lido no celular e não vai a lugar nenhum; só os
lançamentos gerados sobem no backup. Extrato não entra no git (`*.ofx` e
`/*.csv` no `.gitignore`); os testes usam extratos inventados.

## Lançar pelo WhatsApp — EM BACKLOG

**Pausado em 2026-10-12, por decisão do usuário.** O código está pronto e
testado; o que travou foi a Meta. Onde parou:

- Já feito no projeto do Supabase: `supabase/whatsapp.sql` aplicado; a Edge
  Function `whatsapp` publicada (recusa chamada sem assinatura: 401) com os 4
  segredos gravados.
- Já feito na Meta: app "Money Log Bot", número de teste, webhook apontando
  para a função.
- **Bloqueios:** (1) a conta do WhatsApp Business recém-criada devolve
  **erro 131031 "Business Account locked"** ao enviar, mesmo aparecendo como
  "Aprovada" no painel (hipótese não confirmada: falta forma de pagamento,
  exigida desde 30/09/2026 para mensagens pagas); (2) com o app **não
  publicado**, a Meta só entrega webhooks de teste do painel, não mensagens
  reais. Publicar exige URL de política de privacidade, ícone e categoria.
- No app, o botão "Lançar pelo WhatsApp" só aparece com
  `EXPO_PUBLIC_WHATSAPP_NUMERO` configurado — hoje fica escondido.

**Para retomar:** resolver o 131031 (Qualidade da conta / suporte da Meta, ou
cadastrar forma de pagamento), publicar o app na Meta (política de
privacidade numa página pública), gerar um token novo e regravar
`WHATSAPP_TOKEN`, assinar o campo `messages` do webhook, e seguir do passo 7
abaixo. **Alternativa avaliada:** Telegram (bot oficial, gratuito, sem
empresa nem publicação) — reaproveita o SQL, o leitor e a tela; só troca a
Edge Function.

Passo a passo original:


Mandar "mercado 42,90" para um número e o lançamento aparecer no app. Peças:
`supabase/whatsapp.sql` (vínculo, lançar, desfazer — testado no PGlite),
`supabase/functions/whatsapp/` (Edge Function que a Meta chama) e a tela
"Backup e conta → Lançar pelo WhatsApp". O bot só cria lançamentos (e desfaz
o último que ele criou); o celular recebe pelo pull.

**Custo (Meta, desde 01/10/2026):** a mensagem que vocês mandam não é
cobrada; cada resposta do bot é uma "mensagem de serviço", com 1.000 grátis
por mês por número. Duas pessoas lançando bastante ficam bem abaixo. O número
de teste da Meta não exige cartão e conversa com até 5 números.

1. **Banco:** SQL Editor do Supabase → colar `supabase/whatsapp.sql` → Run.
2. **App na Meta:** developers.facebook.com → Meus apps → Criar app → caso de
   uso de WhatsApp (conectar com clientes) → no produto WhatsApp, em
   "Configuração da API":
   - anote o **Phone number ID** do número de teste (não é o número);
   - em "Para", **adicione os dois celulares** (o seu e o dela); cada um
     confirma com um código.
3. **Token permanente** (o da tela de configuração vence em 24 h):
   Configurações do negócio → Usuários do sistema → criar um (Admin) →
   atribuir o app → gerar token com `whatsapp_business_messaging` e
   `whatsapp_business_management`, validade "Nunca".
4. **Chave secreta do app:** Configurações do app → Básico → Chave secreta.
   É ela que assina cada chamada do webhook; a função recusa o que não
   bater.
5. **Publicar a função** (CLI do Supabase pelo npx, sem Docker):

   ```powershell
   npx.cmd supabase@2.118.0 login
   npx.cmd supabase@2.118.0 link --project-ref <id-do-projeto>
   npx.cmd supabase@2.118.0 secrets set WHATSAPP_TOKEN=<token> WHATSAPP_APP_SECRET=<chave secreta> WHATSAPP_VERIFY_TOKEN=<texto-que-voce-inventar> WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   npm.cmd run whatsapp:publicar
   ```

   Esses quatro valores são segredos: ficam no Supabase, nunca no app, no
   `.env.local` nem no git.
6. **Webhook na Meta:** WhatsApp → Configuração → Webhook:
   - URL de callback: `https://<id-do-projeto>.supabase.co/functions/v1/whatsapp`
   - Token de verificação: o mesmo `WHATSAPP_VERIFY_TOKEN`
   - depois, em "Campos do webhook", assinar **messages**.
7. **Número do bot no app** (não é segredo): em `.env.local` e no ambiente
   `preview` do EAS:

   ```powershell
   npx.cmd eas-cli@24.8.0 env:create --environment preview --name EXPO_PUBLIC_WHATSAPP_NUMERO --value <numero-com-ddi> --visibility plaintext
   ```

   e publicar a atualização (`npm.cmd run publicar -- "WhatsApp"`).
8. **Conectar:** no app, Backup e conta → Lançar pelo WhatsApp → gerar
   código → "Abrir no WhatsApp" → enviar. O bot responde "✅ Pronto!". Daí,
   "mercado 42,90".

**Se o bot não responder** a um número brasileiro com o erro "recipient not in
allowed list" nos logs da função: a Meta às vezes identifica o celular SEM o
nono dígito. Adicione o número também nesse formato em "Para" (passo 2).

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
  JSON (`Unexpected token` seguido do caractere invisível U+FEFF). Para JSON, gravar sem BOM.
- **`npm` bloqueado pela política de execução** — usar `npm.cmd` / `npx.cmd`.
- **`node` fora do PATH de sessão antiga** — reabrir o VS Code inteiro.
- **Não há Postgres nem Docker.** O `schema.sql` é validado no PGlite
  (`src/test-support/postgres.ts`), com o `auth` do Supabase imitado. Lá o
  dono das tabelas é superusuário e **ignora a RLS**: teste de acesso tem que
  passar por `comoUsuario`.
- **SQL inválido só falha quando o SQLite executa** — nem o typecheck nem o
  bundle pegam. Por isso existe o `npm run db:check`.
