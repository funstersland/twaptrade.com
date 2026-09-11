CREATE TABLE `cheapshare_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `cheapshare_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cheapshare_event_revision` ON `cheapshare_events` (`run_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_cheapshare_event_kind` ON `cheapshare_events` (`run_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `cheapshare_feed` (
	`id` text PRIMARY KEY NOT NULL,
	`lease` text NOT NULL,
	`lease_until` integer NOT NULL,
	`heartbeat` integer NOT NULL,
	`data_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cheapshare_markets` (
	`slug` text PRIMARY KEY NOT NULL,
	`strike` text NOT NULL,
	`source` text NOT NULL,
	`locked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cheapshare_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`mode` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_event` text NOT NULL,
	`state_json` text NOT NULL,
	`wallet_address` text,
	`wallet_cipher` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cheapshare_user_bot_mode` ON `cheapshare_runs` (`user_id`,`bot_id`,`mode`);