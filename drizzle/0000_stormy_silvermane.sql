CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`referral_code` text NOT NULL,
	`referred_by` text,
	`created_at` text NOT NULL,
	`last_login_at` text NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profiles_referral_code` ON `profiles` (`referral_code`);--> statement-breakpoint
CREATE INDEX `idx_profiles_referred_by` ON `profiles` (`referred_by`);