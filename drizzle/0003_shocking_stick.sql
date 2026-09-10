CREATE TABLE `profit_loss_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`recipient_ids` text NOT NULL,
	`status` text DEFAULT 'prepared' NOT NULL,
	`posting_token` text,
	`created_at` text NOT NULL,
	`expires_at` integer NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`actor_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_profit_loss_actor` ON `profit_loss_batches` (`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_profit_loss_created` ON `profit_loss_batches` (`created_at`);