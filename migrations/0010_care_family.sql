-- Health is now Personal care & Health (haircuts and toiletries go there too) and Family & Others is now Family &
-- Relationships (👨‍👩‍👧). Same rows, so every expense stays where it is; a rename is skipped where an old row already has
-- the name. Households still waiting for their switch get the new names then (switch.ts uses the fixed list).
UPDATE `categories` SET `name` = 'Personal care & Health'
WHERE `key` = 'health' AND `name` <> 'Personal care & Health'
  AND NOT EXISTS (SELECT 1 FROM `categories` o WHERE o.`household_id` = `categories`.`household_id` AND o.`name` = 'Personal care & Health');--> statement-breakpoint
UPDATE `categories` SET `name` = 'Family & Relationships', `emoji` = '👨‍👩‍👧'
WHERE `key` = 'household' AND `name` <> 'Family & Relationships'
  AND NOT EXISTS (SELECT 1 FROM `categories` o WHERE o.`household_id` = `categories`.`household_id` AND o.`name` = 'Family & Relationships');
