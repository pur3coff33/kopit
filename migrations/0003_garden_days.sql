CREATE TABLE `garden_days` (
	`household_id` integer NOT NULL,
	`day` integer NOT NULL,
	`missions` integer NOT NULL,
	`done` integer NOT NULL,
	`done_types` text NOT NULL,
	PRIMARY KEY(`household_id`, `day`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
