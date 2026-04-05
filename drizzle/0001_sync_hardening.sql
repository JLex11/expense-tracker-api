CREATE INDEX `categories_user_updated_idx` ON `categories` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `expenses_user_updated_idx` ON `expenses` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `expenses_user_date_idx` ON `expenses` (`user_id`,`date`);
--> statement-breakpoint
CREATE INDEX `expenses_recurring_lookup_idx` ON `expenses` (`user_id`,`recurring_rule_id`,`date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_recurring_occurrence_unique` ON `expenses` (`user_id`,`recurring_rule_id`,`date`) WHERE `recurring_rule_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `recurring_rules_user_updated_idx` ON `recurring_expense_rules` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `recurring_rules_due_active_idx` ON `recurring_expense_rules` (`is_active`,`next_due_at`);
--> statement-breakpoint
CREATE INDEX `budgets_user_updated_idx` ON `budgets` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_user_category_month_unique` ON `budgets` (`user_id`,`category_id`,`month_key`);
