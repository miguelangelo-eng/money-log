ALTER TABLE `transactions` ADD `id_externo` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tx_id_externo_unico` ON `transactions` (`user_id`,`id_externo`) WHERE "id_externo" is not null;