-- Triggers do outbox: toda escrita local entra na fila de push, na mesma
-- transação da escrita. Escrito à mão (drizzle-kit não gera trigger).
--
-- A condição `is not 1` cobre a ausência da linha em sync_state (null): antes
-- do primeiro sync, a fila também é alimentada. Durante a aplicação de um pull
-- (aplicando = 1) não é, senão cada linha baixada voltaria no próximo push.
CREATE TRIGGER `profiles_outbox_ins` AFTER INSERT ON `profiles`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('profiles', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `profiles_outbox_upd` AFTER UPDATE ON `profiles`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('profiles', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_outbox_ins` AFTER INSERT ON `accounts`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('accounts', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_outbox_upd` AFTER UPDATE ON `accounts`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('accounts', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `credit_cards_outbox_ins` AFTER INSERT ON `credit_cards`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('credit_cards', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `credit_cards_outbox_upd` AFTER UPDATE ON `credit_cards`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('credit_cards', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `invoices_outbox_ins` AFTER INSERT ON `invoices`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('invoices', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `invoices_outbox_upd` AFTER UPDATE ON `invoices`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('invoices', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `categories_outbox_ins` AFTER INSERT ON `categories`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('categories', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `categories_outbox_upd` AFTER UPDATE ON `categories`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('categories', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_outbox_ins` AFTER INSERT ON `import_batches`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('import_batches', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_outbox_upd` AFTER UPDATE ON `import_batches`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('import_batches', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_outbox_ins` AFTER INSERT ON `transactions`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('transactions', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_outbox_upd` AFTER UPDATE ON `transactions`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('transactions', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `budgets_outbox_ins` AFTER INSERT ON `budgets`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('budgets', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `budgets_outbox_upd` AFTER UPDATE ON `budgets`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('budgets', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `alerts_outbox_ins` AFTER INSERT ON `alerts`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('alerts', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `alerts_outbox_upd` AFTER UPDATE ON `alerts`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('alerts', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `push_tokens_outbox_ins` AFTER INSERT ON `push_tokens`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('push_tokens', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER `push_tokens_outbox_upd` AFTER UPDATE ON `push_tokens`
WHEN (SELECT `aplicando` FROM `sync_state` WHERE `id` = 1) IS NOT 1
BEGIN
  INSERT INTO `outbox` (`tabela`, `row_id`, `op`, `payload`, `created_at`)
  VALUES ('push_tokens', NEW.`id`, 'upsert', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
