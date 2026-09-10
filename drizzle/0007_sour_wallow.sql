CREATE TABLE `continuation_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`side` text DEFAULT 'SELL' NOT NULL,
	`status` text NOT NULL,
	`requested_shares_micros` integer NOT NULL,
	`limit_price` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `continuation_rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_continuation_orders_round` ON `continuation_orders` (`round_id`);--> statement-breakpoint
ALTER TABLE `continuation_rounds` ADD `sold_shares_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `continuation_rounds` ADD `sale_proceeds_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `continuation_rounds` ADD `sale_fee_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `continuation_rounds` ADD `exit_stable_since` integer;--> statement-breakpoint
ALTER TABLE `continuation_rounds` ADD `exit_bid_micros` integer;