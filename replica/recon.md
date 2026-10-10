# Recon map: Organizze + Mobills (Android/iOS, com apoio da web)

Scope: o núcleo de controle financeiro manual — contas, cartões com fatura,
lançamentos (incluindo parcelado e recorrente), categorias, orçamento por
categoria e relatórios mensais.
For: uso próprio de duas pessoas, com **finanças totalmente separadas**. Dois
usuários, dois conjuntos de dados independentes, nada compartilhado. Cada um
usa o app como se fosse o único usuário; o outro não vê nada.
Date: 2026-10-10 (escopo de compartilhamento revisado no mesmo dia)

Alvo da reconstrução: Expo / React Native, backend com sync.
Fora do MVP: conexão bancária automática (Open Finance).

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Organizze — site oficial | https://www.organizze.com.br/ | lista de features e o pitch do core loop; nomes dos planos (Conectado, Conectado Plus) |
| 2 | Organizze — App Store (BR/pt) | https://apps.apple.com/us/app/organizze-finan%C3%A7as-pessoais/id677699286?l=pt-BR | 4,7/5 em 539 classificações; IAP "Plano Mensal Manual" / "Plano Mensal Conectado" / "Plano Anual" — confirma que o gate é a conexão bancária, não o lançamento manual |
| 3 | Organizze — ajuda: compartilhar acesso | https://ajuda.organizze.com.br/hc/pt-br/articles/9964934097171-Android-Minha-conta-Compartilhando-seu-acesso-com-outra-pessoa | **fonte-chave**: compartilhar = entregar as credenciais. Sem multiusuário real |
| 4 | Organizze — ajuda: adicionar cartão (web) | https://ajuda.organizze.com.br/hc/pt-br/articles/6159569013907-Web-Cart%C3%A3o-de-cr%C3%A9dito-Adicionar-cart%C3%A3o | campos exatos do cartão: ícone, nome, limite, fechamento, vencimento, conta de pagamento |
| 5 | Organizze — ajuda: adicionar lançamento no cartão | https://ajuda.organizze.com.br/hc/pt-br/articles/5994594652051-Web-Cart%C3%A3o-de-cr%C3%A9dito-Adicionar-lan%C3%A7amento | 3 caminhos de entrada; "Acesso Rápido" na tela inicial |
| 6 | Organizze — ajuda: conciliação bancária | https://ajuda.organizze.com.br/hc/pt-br/articles/5994220061203-Web-Lan%C3%A7amentos-Concilia%C3%A7%C3%A3o-banc%C3%A1ria | importação de arquivo para conta e cartão |
| 7 | Organizze — ajuda: importar planilha | https://ajuda.organizze.com.br/hc/pt-br/articles/5994105941139-Web-Lan%C3%A7amentos-Importar-uma-planilha | caminho de import sem Open Finance — é o nosso MVP |
| 8 | Organizze — ajuda: transferência | https://ajuda.organizze.com.br/hc/pt-br/articles/5662802680595-Web-Lan%C3%A7amentos-Como-lan%C3%A7ar-uma-transfer%C3%AAncia | transferência como terceiro tipo de lançamento |
| 9 | Organizze — ajuda: seção Funcionalidades | https://ajuda.organizze.com.br/hc/pt-br/sections/5662518219027-Funcionalidades | índice de features (403 ao fetch; lido via resultados de busca) |
| 10 | Canaltech — como usar o Organizze | https://canaltech.com.br/apps/como-usar-organizze/ | walkthrough: menu inferior de 5 ícones, FAB "+", fluxo do cartão, importação por notificação |
| 11 | TechTudo — como usar o Organizze | https://www.techtudo.com.br/dicas-e-tutoriais/2019/01/aplicativo-para-controle-de-gastos-saiba-como-usar-o-organizze.ghtml | telas de onboarding, login social, Metas, Relatórios, Configurações (iOS e Android) |
| 12 | Mobills — App Store (BR) | https://apps.apple.com/br/app/mobills-controle-de-gastos/id921838244 | 4,7/5 em ~169 mil avaliações; dashboard customizável, modo escuro, metas; crítica recorrente ao paywall |
| 13 | Mobills — pricing | https://www.mobills.com.br/pricing/ | Premium R$ 99,90/ano; "mais de 30 funcionalidades"; o que é pago |
| 14 | Mobills — ajuda: compartilhar conta | https://mobills.zendesk.com/hc/en-us/articles/1260805031729-Can-I-share-my-account-with-someone-else | mesma limitação do Organizze: compartilhar login |
| 15 | Reclame Aqui — Mobills | https://www.reclameaqui.com.br/mobills-educacao-financeira/sem-controle-financeiro_6Ff7L0bp7U9PqXVG/ | relato de valores "desaparecendo" com múltiplas contas |
| 16 | idinheiro — review Organizze | https://www.idinheiro.com.br/financaspessoais/organizze-app/ | visão de terceiros sobre telas e limitações |

Fontes **não** usadas, de propósito: nenhum bundle JS, nenhum APK decompilado,
nenhuma captura de tráfego de rede, nenhuma conta que não seja do usuário.
Os centrais de ajuda Zendesk devolvem HTTP 403 a fetch automatizado; o que
está aqui veio de resultado de busca e de páginas públicas abertas
normalmente — sem crawler e sem laço.

## Core loop

Lançar todo dinheiro que entra e sai em contas e cartões, com categoria, e ver
no fim do mês para onde ele foi — por categoria e contra um limite que você
mesmo definiu.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Intro / onboarding | primeiro boot | explicar o app; "Pular" disponível | carrossel, botão pular | primeira execução |
| S02 | Cadastro / Login | após intro | criar conta grátis ou entrar com Google/Facebook | campos e-mail+senha, botões sociais | vazio, erro de credencial, carregando |
| S03 | Home / Dashboard | tab 1 | resumo do mês: saldo das contas, gastos, contas a vencer e a receber | cards de saldo, "Acesso Rápido", widget de cartões, FAB "+", ícone de sino | vazio (sem conta cadastrada), preenchido, carregando |
| S04 | Lançamentos do mês | tab 2 | lista de todos os registros do mês | lista agrupada por data, seletor de mês, filtro, FAB "+" | vazio, preenchido, filtrado, carregando |
| S05 | Escolher tipo de lançamento | FAB "+" em S03/S04 | despesa · receita · transferência | 3 ações grandes | — |
| S06 | Formulário de lançamento | após S05 | registrar valor, categoria, conta/cartão, data | teclado numérico de valor, seletor de categoria, seletor de conta, date picker, toggles "pago/recebido", repetir e parcelar, anexo, observação | novo, edição, inválido, salvando |
| S07 | Detalhe do lançamento | toque em item de S04 | ver, editar, duplicar, excluir | campos read-only, menu de ações | normal, confirmação de exclusão (série vs. ocorrência) |
| S08 | Contas | Configurações ou widget da home | lista de contas com saldo | lista com ícone/instituição, saldo, total | vazio, preenchido |
| S09 | Adicionar / editar conta | "+" em S08 | nome, tipo, instituição, saldo inicial | form, seletor de ícone/banco, moeda | novo, edição, erro de validação |
| S10 | Cartões de crédito | Configurações ou widget da home | lista de cartões com fatura atual e limite usado | cards com barra de limite | vazio, preenchido |
| S11 | Adicionar / editar cartão | "+ Adicionar cartão" em S10 | cadastrar cartão | ícone, nome, limite, **dia de fechamento**, **dia de vencimento**, conta de pagamento | novo, edição |
| S12 | Fatura do cartão | toque em cartão em S10 | lançamentos da fatura, total, navegar entre faturas | lista, seletor de fatura, botão "Pagar fatura" | aberta, fechada, paga, vazia |
| S13 | Categorias | Configurações | gerenciar categorias de despesa e receita | lista com ícone e cor, separada por tipo | padrão do sistema, customizada |
| S14 | Nova / editar categoria | "+" em S13 | nome, ícone, cor, tipo | form, grade de ícones, paleta | novo, edição, em uso (não pode excluir) |
| S15 | Relatórios | tab 4 | gráficos do mês: balanço e gastos por categoria | gráfico de rosca por categoria, barras receita vs. despesa, setas de mês, drill-down | vazio (sem dados no mês), preenchido |
| S16 | Metas / Limite de gastos | tab 5 | definir valor máximo por categoria e acompanhar | lista de categorias com barra de progresso, form de limite | sem meta, dentro do limite, estourado |
| S17 | Configurações | menu / "..." | conta, preferências, categorias, contas, cartões | lista de seções | — |
| S18 | Notificações / alertas | ícone de sino em S03 | contas a vencer, dinheiro a receber, limite estourado | lista | vazio, com itens |
| S19 | Importar extrato / conciliação | Configurações ou tela de lançamentos | importar arquivo e casar com lançamentos existentes | upload, mapeamento de colunas, lista de candidatos a conciliar, confirmação | nenhum arquivo, parseando, conflito/duplicata, concluído |
| S20 | Compartilhar acesso | Configurações > Minha conta | (no original) instruir a entregar as credenciais | texto de ajuda | — · **não implementada**: fora do escopo |

Notas de honestidade sobre esta tabela:

- `replica/screens/` está **vazio**. Não capturei screenshot nenhum: as lojas
  e os centrais de ajuda bloqueiam download automatizado, e as capturas de
  loja são material protegido deles. Sem imagem, o `replica-diff` não vai ter
  baseline visual — só o score de paridade de feature.
  **Isto é uma lacuna real do recon**, não um detalhe. Se você tem conta no
  Organizze ou no Mobills, as capturas das suas próprias telas resolvem; elas
  ficam em `replica/screens/` e nunca entram no app.
- Rotas não aparecem porque não há: são apps nativos, a navegação é por tab
  bar e stack. A coluna "route" diz como se chega.
- S19 é uma reconstrução a partir dos artigos de conciliação e import de
  planilha. O passo a passo exato da UI eu não vi.

## Flows

```
F01 Primeiro uso: cadastro até o primeiro lançamento
    S01 -> S02 -> S03 (vazio) -> S09 (criar conta) -> S03 -> S05 -> S06 -> S04
    happy path clicks: ~12
    edge: pula o cadastro de conta e lança sem conta; e-mail já existe;
          login social cancelado; saldo inicial negativo

F02 Lançar uma despesa manual
    S03 (FAB +) -> S05 (despesa) -> S06 -> S04
    happy path clicks: 5 (valor, categoria, conta, data default hoje, salvar)
    **é o fluxo que roda dez vezes por dia — cada toque aqui importa**
    edge: valor zero; categoria nova no meio do fluxo; data futura (vira
          previsto, não realizado); offline

F03 Compra no cartão e pagamento da fatura
    S03 -> S05 -> S06 (conta = cartão) -> S12 (fatura acumula) -> "Pagar fatura" -> S08 (debita a conta)
    happy path clicks: 6 + 2
    **a parte de modelagem mais traiçoeira**: a compra não sai do saldo na
    hora, sai quando a fatura é paga. Fechamento != vencimento. Compra depois
    do fechamento cai na fatura seguinte.
    edge: compra na virada do fechamento; pagamento parcial; estorno;
          fatura paga com outra conta; compra parcelada atravessando faturas

F04 Transferência entre contas
    S05 (transferência) -> S06 (origem, destino, valor) -> S04
    happy path clicks: 5
    edge: origem = destino; transferência não pode contar como receita nem
          como despesa no relatório (erro clássico de duplicar o valor)

F05 Definir limite por categoria e acompanhar
    S16 -> escolher categoria -> valor -> S16 (barra) -> S18 (alerta ao estourar)
    happy path clicks: 4
    edge: limite menor que o já gasto no mês; categoria sem gasto; mês virou

F06 Ver para onde foi o dinheiro no mês
    S03 -> S15 -> toque na categoria -> lista filtrada (S04)
    happy path clicks: 3
    edge: mês sem lançamento; despesa sem categoria; transferência aparecendo
          indevidamente no gráfico

F07 Importar extrato e conciliar
    S19 -> escolher arquivo -> mapear -> revisar duplicatas -> confirmar -> S04
    happy path clicks: ~7
    edge: OFX com encoding quebrado; CSV com vírgula decimal e separador vírgula;
          import repetido do mesmo arquivo; lançamento já digitado à mão
          (é o caso que define se a conciliação presta)

F08 Despesa parcelada e despesa fixa recorrente
    S06 (toggle parcelar em 12x / repetir todo mês) -> S04 (12 ocorrências)
    happy path clicks: 7
    edge: editar uma ocorrência vs. a série toda; excluir a série; valor que
          não divide redondo (R$ 100 em 3x); parcela que cai em fatura fechada

F09 Compartilhar acesso  [existe no original; FORA DO NOSSO ESCOPO]
    S17 -> S20 -> entregar e-mail e senha
    happy path clicks: 2
    No original, compartilhar é entregar a credencial (fontes 3 e 14). Nós não
    reconstruímos nem isso nem uma versão melhor: a decisão de escopo é
    finanças separadas, então S20 não é implementada. Cada pessoa tem o seu
    login e os seus dados, e é só.

F10 Alerta de conta a vencer
    S06 (despesa futura não paga) -> S18 -> S07 (marcar como paga)
    happy path clicks: 3
    edge: venceu e não foi pago; pago fora do app
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, pressed, focus, disabled, loading | todas |
| FAB "+" | simples, expansível em 3 ações | fechado, aberto | S03, S04 |
| Tab bar | 5 itens | ativo, inativo, com badge | S03, S04, S15, S16 |
| Entrada de valor monetário | despesa (vermelho), receita (verde) | vazio, digitando, inválido | S06 |
| Seletor de categoria | lista, grade com ícone | fechado, aberto, busca, vazio, criar nova | S06, S14, S16 |
| Seletor de conta/cartão | lista com ícone e saldo | fechado, aberto, sem contas | S06, S09, S11 |
| Date picker | dia, mês | hoje, passado, futuro | S06, S12, S15 |
| Item de lançamento | despesa, receita, transferência, parcelado | pago, pendente, atrasado | S04, S12 |
| Card de saldo | conta, cartão, consolidado | positivo, negativo, oculto (modo privacidade) | S03, S08, S10 |
| Barra de progresso | limite de gasto, limite do cartão | ok, atenção, estourado | S10, S16 |
| Gráfico de rosca por categoria | — | vazio, com dados, fatia selecionada | S15 |
| Gráfico de barras receita × despesa | mensal | vazio, com dados | S15 |
| Seletor de mês | setas + rótulo | mês atual, passado, futuro | S04, S12, S15, S16 |
| Estado vazio | por tela, com call-to-action | — | S03, S04, S08, S10, S15, S16 |
| Toast / snackbar | sucesso, erro, desfazer | — | todas |
| Modal de confirmação | excluir ocorrência, excluir série | — | S07, S14 |
| Seletor de ícone e cor | grade | — | S09, S11, S14 |
| Pull to refresh | — | idle, sincronizando, erro de sync | S03, S04 |

## Inferred data model

```
User        id, email, nome, avatar, auth_provider, created_at
            o escopo de TODO dado é o user_id. Não há entidade de livro
            compartilhado, nem papéis, nem convite: a decisão de escopo
            (2026-10-10) é finanças separadas. Cada linha de cada tabela
            pertence a exatamente um usuário.
            evidence: S02, login social (fonte 11)
            confidence: high

Account     id, user_id, nome, tipo (corrente | poupança | dinheiro |
            investimento), instituição, ícone, saldo_inicial, arquivada
            evidence: S08, S09, fonte 1 ("Suas contas e cartões num só lugar")
            confidence: high

CreditCard  id, user_id, nome, ícone, limite, dia_fechamento, dia_vencimento,
            conta_pagamento_id, arquivado
            evidence: S11 e fonte 4 — os campos são literalmente estes
            confidence: high

Invoice     id, credit_card_id, mês_referência, data_fechamento,
            data_vencimento, total, status (aberta | fechada | paga),
            transação_pagamento_id
            evidence: S12, fonte 4 (artigos de pagar fatura)
            confidence: medium — que a fatura seja entidade própria é inferência;
            poderia ser derivada dos lançamentos. replica-architect decide.

Category    id, user_id | null (null = padrão do sistema), nome, tipo
            (despesa | receita), ícone, cor, parent_id
            evidence: S13, S14, fonte 1 ("Criação de categorias")
            confidence: high — exceto parent_id (subcategoria), que é guess

Transaction id, user_id, tipo (despesa | receita | transferência), valor,
            data_competência, descrição, category_id, account_id |
            credit_card_id, invoice_id, pago (bool), data_pagamento,
            conta_destino_id (transferência), observação, anexo_url,
            série_id, parcela_n, parcela_de, import_batch_id
            evidence: S06, S07, fontes 5 e 8
            confidence: high — todos os campos têm evidência no original.
            Sem paid_by nem rateio: com finanças separadas, o dono do
            lançamento é sempre o dono dos dados.

RecurrenceRule id, série_id, frequência (mensal | semanal | anual),
            dia, data_fim | ocorrências, valor
            evidence: F08, fonte 1 (fixas, parceladas, recorrentes)
            confidence: medium — modelar como regra ou materializar N
            lançamentos é decisão do architect; o original parece materializar
            (editar uma ocorrência vs. a série é uma pergunta na UI)

Budget      id, user_id, category_id, mês_referência | recorrente,
            valor_limite
            evidence: S16, fonte 1 ("Limite de gastos")
            confidence: high

ImportBatch id, user_id, arquivo_nome, formato (ofx | csv), hash,
            importado_em, contagem, status
            evidence: S19, fontes 6 e 7
            confidence: medium — o hash é nosso, para barrar import duplicado

Alert       id, user_id, tipo (a_vencer | a_receber | limite_estourado),
            transaction_id | budget_id, lido
            evidence: S18, fonte 1 ("Receba alertas de contas a pagar")
            confidence: medium
```

Relationships:
`User 1-n Account` · `User 1-n CreditCard` · `CreditCard 1-n Invoice` ·
`User 1-n Category` · `User 1-n Transaction` ·
`Account 1-n Transaction` · `Invoice 1-n Transaction` ·
`Category 1-n Transaction` · `User 1-n Budget` ·
`Category 1-1 Budget` por mês · `ImportBatch 1-n Transaction`

Escopo de dados: **tudo pendura em `user_id`**, igual ao original. Uma única
regra de acesso ("o dono vê as suas linhas e mais ninguém") cobre o banco
inteiro, o que é o cenário mais simples possível de autorização.

Registrado para quando a pergunta voltar: **adicionar compartilhamento depois
é migração de schema**, não feature. Precisaria de uma entidade de livro, de
vínculo usuário↔livro, e de trocar o `user_id` por ela em 8 tabelas, com
backfill dos dados já lançados. É um custo conhecido e aceito, não um
esquecimento — a decisão de hoje é finanças separadas.

## Feature matrix

See `features.csv`. Must: 23, should: 13, could: 8, skip: 8 (52 linhas).

Com finanças separadas, praticamente toda feature obrigatória **existe no
original**: sobram 5 linhas marcadas `original=no`, e nenhuma delas é
obrigatória (barrar import duplicado, edição offline, widget, biometria,
multi-moeda).

Consequência que vale dizer em voz alta: este app **não tem diferencial
funcional** em relação ao plano manual do Organizze. A razão de construir
passa a ser outra, e é legítima — dados sob seu controle, sem paywall
mudando de regra, sem anúncio, e o aprendizado de construir. Mas não é
"o app faz algo que os outros não fazem".

## Out of scope (cannot or should not be cloned)

- **Conexão bancária automática / Open Finance.** É o que o Organizze cobra
  para liberar (IAP "Plano Mensal Conectado" vs. "Manual", fonte 2) e não é
  uma API que se "liga": no Brasil passa por instituição autorizada ou por
  agregador (Pluggy, Belvo), com contrato e custo por conta conectada. Fora do
  MVP por regulação e por dinheiro, não por dificuldade técnica.
- **Importação lendo notificações do Android** (o atalho do Organizze, fonte 10).
  Tecnicamente possível, mas o acesso a notificações é política restrita na
  Play Store e exige justificativa; e lê notificação de banco, o que é dado
  sensível de terceiro. Fica como `could` com ressalva.
- **IA de categorização, leitura de recibo e o agente MCP** (fonte 1). Dá para
  fazer, mas é custo por token recorrente num app de duas pessoas. Depois.
- **Assessor financeiro por IA no WhatsApp** (Mobills PRO): API oficial do
  WhatsApp Business tem custo e aprovação. Não.
- **Parcerias e integrações** (Mobills + Wellhub/Gympass): é contrato comercial
  deles, não feature.
- **Base histórica e conteúdo editorial** (blog, cursos de educação financeira):
  é o ativo deles.
- **Ícones de banco e marcas das instituições.** São marcas registradas de
  terceiros. Usar o nome do banco em texto é descritivo e aceitável; empacotar
  os logotipos no app, não. O `replica-design` precisa de um conjunto próprio.

## Size

Screens 19 implementadas (S20 fora), flows 9 (F09 fora), entities 10.

Hard parts, em ordem de quanto podem atrasar o projeto:

1. **Ciclo de fatura de cartão.** Fechamento, vencimento, compra que cruza a
   virada, parcelamento atravessando faturas, pagamento que debita outra conta.
   É regra de negócio densa e é onde o usuário percebe erro na hora.
2. **Séries: parcelado e recorrente.** Editar/excluir uma ocorrência ou a
   série toda, com a parcela que não divide redondo.
3. Conciliação de import (OFX/CSV) contra o que já foi digitado à mão.
4. Edição offline com sincronização. Muito mais simples do que era: um só
   editor por conjunto de dados, então "o último grava" até resolve — não há
   dois celulares disputando a mesma fatura.

Size: **M** (algumas semanas). Caiu de L para M com o escopo separado: saíram
o rateio, o convite, a atribuição por pessoa e a resolução de conflito
multiusuário. O caminho continua sendo a fatia vertical do `F02` — lançar uma
despesa e vê-la no relatório — ponta a ponta antes de tocar em cartão de
crédito.
