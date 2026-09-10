CREATE TABLE `continuation_feed` (
	`id` text PRIMARY KEY NOT NULL,
	`heartbeat` integer NOT NULL,
	`observed_at` integer,
	`price_e18` text,
	`round_start` integer,
	`open_e18` text,
	`market` text,
	`next_market` text,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `continuation_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`start_seconds` integer NOT NULL,
	`market_slug` text NOT NULL,
	`condition_id` text,
	`token_id` text,
	`direction` text,
	`stake_cents` integer NOT NULL,
	`status` text NOT NULL,
	`reference_price` text,
	`signal_price` text,
	`order_id` text,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`shares_micros` integer DEFAULT 0 NOT NULL,
	`fee_micros` integer DEFAULT 0 NOT NULL,
	`mark_micros` integer,
	`payout_micros` integer,
	`pnl_micros` integer,
	`winner` text,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `continuation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_continuation_run_round` ON `continuation_rounds` (`run_id`,`start_seconds`);--> statement-breakpoint
CREATE INDEX `idx_continuation_round_status` ON `continuation_rounds` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_continuation_order` ON `continuation_rounds` (`order_id`);--> statement-breakpoint
CREATE TABLE `continuation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'paused' NOT NULL,
	`base_lot_cents` integer NOT NULL,
	`loss_streak` integer DEFAULT 0 NOT NULL,
	`paper_cash_micros` integer DEFAULT 0 NOT NULL,
	`wallet_address` text,
	`wallet_cipher` text,
	`wallet_type` text,
	`connection_status` text DEFAULT 'disconnected' NOT NULL,
	`wallet_balance_micros` integer,
	`forced_minimum` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`checked_at` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_continuation_user_bot_mode` ON `continuation_runs` (`user_id`,`bot_id`,`mode`);--> statement-breakpoint
CREATE INDEX `idx_continuation_status` ON `continuation_runs` (`status`);--> statement-breakpoint
ALTER TABLE `bots` ADD `strategy_key` text;