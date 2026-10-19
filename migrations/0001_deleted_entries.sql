CREATE TABLE `deleted_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`deleted_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
