ALTER TABLE `bots` ADD `family` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bots_family_name` ON `bots` (`family`,lower("name"));