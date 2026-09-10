ALTER TABLE `profiles` ADD `last_session_accent` text DEFAULT 'mint' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `accent` text DEFAULT 'mint' NOT NULL;