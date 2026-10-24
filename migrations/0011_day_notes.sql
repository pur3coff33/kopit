CREATE TABLE `day_notes` (
	`household_id` integer NOT NULL,
	`day` integer NOT NULL,
	`note` text,
	`tries` integer DEFAULT 0 NOT NULL,
	`claim` text,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `day`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
