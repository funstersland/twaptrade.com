CREATE TABLE `continuation_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`order_id` text NOT NULL,
	`side` text NOT NULL,
	`token_id` text NOT NULL,
	`transaction_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`block_number` integer NOT NULL,
	`gross_micros` integer NOT NULL,
	`shares_micros` integer NOT NULL,
	`fee_micros` integer NOT NULL,
	`cash_micros` integer NOT NULL,
	`price` text NOT NULL,
	`trade_ids` text NOT NULL,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `continuation_rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_continuation_fills_round` ON `continuation_fills` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_continuation_fills_order` ON `continuation_fills` (`order_id`);