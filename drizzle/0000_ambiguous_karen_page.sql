CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`nome` text NOT NULL,
	`tipo` text NOT NULL,
	`instituicao` text,
	`icone` text DEFAULT 'wallet' NOT NULL,
	`cor` text,
	`saldo_inicial_cents` integer DEFAULT 0 NOT NULL,
	`arquivada` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_nome_unico` ON `accounts` (`user_id`,`nome`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tipo` text NOT NULL,
	`transaction_id` text,
	`budget_id` text,
	`invoice_id` text,
	`titulo` text NOT NULL,
	`corpo` text,
	`lido` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alerts_user_lido_idx` ON `alerts` (`user_id`,`lido`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`mes_referencia` text,
	`limite_cents` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_cat_mes_unico` ON `budgets` (`user_id`,`category_id`,`coalesce("mes_referencia"`,` '1900-01-01')`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`nome` text NOT NULL,
	`tipo` text NOT NULL,
	`icone` text DEFAULT 'tag' NOT NULL,
	`cor` text DEFAULT '#888888' NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `categories_user_tipo_idx` ON `categories` (`user_id`,`tipo`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_nome_unico` ON `categories` (`user_id`,`tipo`,`nome`);--> statement-breakpoint
CREATE TABLE `credit_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`nome` text NOT NULL,
	`icone` text DEFAULT 'card' NOT NULL,
	`limite_cents` integer DEFAULT 0 NOT NULL,
	`dia_fechamento` integer NOT NULL,
	`dia_vencimento` integer NOT NULL,
	`conta_pagamento_id` text,
	`arquivado` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`conta_pagamento_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credit_cards_user_idx` ON `credit_cards` (`user_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`arquivo_nome` text NOT NULL,
	`formato` text NOT NULL,
	`sha256` text NOT NULL,
	`account_id` text,
	`credit_card_id` text,
	`total_linhas` integer DEFAULT 0 NOT NULL,
	`importadas` integer DEFAULT 0 NOT NULL,
	`ignoradas` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pendente' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_sha_unico` ON `import_batches` (`user_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credit_card_id` text NOT NULL,
	`mes_referencia` text NOT NULL,
	`data_fechamento` text NOT NULL,
	`data_vencimento` text NOT NULL,
	`status` text DEFAULT 'aberta' NOT NULL,
	`pagamento_tx_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`credit_card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_card_mes_unico` ON `invoices` (`credit_card_id`,`mes_referencia`);--> statement-breakpoint
CREATE INDEX `invoices_user_status_idx` ON `invoices` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tabela` text NOT NULL,
	`row_id` text NOT NULL,
	`op` text NOT NULL,
	`payload` text NOT NULL,
	`tentativas` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_ordem_idx` ON `outbox` (`seq`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`avatar_path` text,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`plataforma` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` text,
	`ultimo_push_em` text,
	`ultimo_pull_em` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`competencia` text NOT NULL,
	`descricao` text DEFAULT '' NOT NULL,
	`category_id` text,
	`account_id` text,
	`credit_card_id` text,
	`invoice_id` text,
	`transfer_account_id` text,
	`pago` integer DEFAULT true NOT NULL,
	`pago_em` text,
	`observacao` text,
	`anexo_path` text,
	`series_id` text,
	`parcela_n` integer,
	`parcela_de` integer,
	`import_batch_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tx_user_competencia_idx` ON `transactions` (`user_id`,`competencia`);--> statement-breakpoint
CREATE INDEX `tx_user_cat_comp_idx` ON `transactions` (`user_id`,`category_id`,`competencia`);--> statement-breakpoint
CREATE INDEX `tx_account_idx` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `tx_invoice_idx` ON `transactions` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `tx_transfer_account_idx` ON `transactions` (`transfer_account_id`);--> statement-breakpoint
CREATE INDEX `tx_series_idx` ON `transactions` (`series_id`);--> statement-breakpoint
CREATE INDEX `tx_user_updated_idx` ON `transactions` (`user_id`,`updated_at`);