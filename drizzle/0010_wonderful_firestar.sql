DROP INDEX `idx_cheapshare_user_bot_mode`;--> statement-breakpoint
ALTER TABLE `cheapshare_runs` ADD `strategy_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cheapshare_user_bot_mode` ON `cheapshare_runs` (`user_id`,`bot_id`,`mode`,`strategy_version`);