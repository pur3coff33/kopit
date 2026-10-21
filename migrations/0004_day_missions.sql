CREATE TABLE `day_missions` (
	`household_id` integer NOT NULL,
	`day` integer NOT NULL,
	`baseline` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `day`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
