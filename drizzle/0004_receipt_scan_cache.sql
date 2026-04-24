ALTER TABLE `receipt_scans` ADD `image_hash` text;
--> statement-breakpoint
ALTER TABLE `receipt_scans` ADD `processing_key` text;
--> statement-breakpoint
CREATE INDEX `receipt_scans_processing_status_idx` ON `receipt_scans` (`processing_key`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_scans_user_processing_inflight_unique` ON `receipt_scans` (`user_id`,`processing_key`) WHERE `status` in ('queued', 'processing') and `processing_key` is not null;
