ALTER TABLE `categories` ADD `key` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `moved_to` integer;--> statement-breakpoint
ALTER TABLE `categories` ADD `moved_note` text;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_household_key` ON `categories` (`household_id`,`key`);--> statement-breakpoint
ALTER TABLE `garden_days` ADD `items` text;--> statement-breakpoint
ALTER TABLE `garden_days` ADD `final` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `categories_set` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
-- Households that already exist keep their old categories until their first visit switches them (src/lib/switch.ts).
UPDATE `households` SET `categories_set` = 1;
