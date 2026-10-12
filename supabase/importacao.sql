-- Importação de extrato (2026-10-12) — para um projeto Supabase CRIADO ANTES
-- desta versão. Projeto novo já recebe isto pelo replica/schema.sql.
--
-- Colar no SQL Editor e rodar. Pode rodar mais de uma vez.
--
-- Rode ANTES de importar o primeiro extrato pelo app. O push grava só as
-- colunas que existem no servidor (as outras são ignoradas em silêncio):
-- sem esta coluna, o id da linha importada não chegaria ao backup, e um
-- celular restaurado do backup importaria tudo de novo.

alter table public.transactions add column if not exists id_externo text;

create unique index if not exists tx_id_externo_unico
  on public.transactions (user_id, id_externo)
  where id_externo is not null;
