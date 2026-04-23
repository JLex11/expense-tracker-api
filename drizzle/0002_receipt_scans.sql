CREATE TABLE `receipt_scans` (
	`scan_id` text PRIMARY KEY NOT NULL,
	`client_scan_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`locale` text NOT NULL,
	`currency` text NOT NULL,
	`timezone` text NOT NULL,
	`image_object_key` text NOT NULL,
	`parsed_data_json` text,
	`failure_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_scans_user_client_unique` ON `receipt_scans` (`user_id`,`client_scan_id`);
--> statement-breakpoint
CREATE INDEX `receipt_scans_user_scan_idx` ON `receipt_scans` (`user_id`,`scan_id`);
--> statement-breakpoint
CREATE INDEX `receipt_scans_status_updated_idx` ON `receipt_scans` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `receipt_scan_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bucket_key` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_scan_usage_user_bucket_unique` ON `receipt_scan_usage` (`user_id`,`bucket_key`);
--> statement-breakpoint
CREATE TABLE `receipt_scan_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bucket_key` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_scan_rate_limits_user_bucket_unique` ON `receipt_scan_rate_limits` (`user_id`,`bucket_key`);
