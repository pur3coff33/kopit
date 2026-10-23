-- Meals joins the fixed categories (a need: food you have to buy when you're out), Household is now Family & Others and
-- School is now Work & Education. Households already on the fixed categories get all three: a household's own old
-- "Meals" from before the switch comes back as it, otherwise a new one is added; a rename is skipped where an old row
-- already has the name. Households still waiting for their switch get them then (switch.ts uses the fixed list).
UPDATE `categories` SET `name` = 'Family & Others', `emoji` = '🏠'
WHERE `key` = 'household' AND `name` <> 'Family & Others'
  AND NOT EXISTS (SELECT 1 FROM `categories` o WHERE o.`household_id` = `categories`.`household_id` AND o.`name` = 'Family & Others');--> statement-breakpoint
UPDATE `categories` SET `name` = 'Work & Education'
WHERE `key` = 'school' AND `name` <> 'Work & Education'
  AND NOT EXISTS (SELECT 1 FROM `categories` o WHERE o.`household_id` = `categories`.`household_id` AND o.`name` = 'Work & Education');--> statement-breakpoint
UPDATE `categories` SET `key` = 'meals', `name` = 'Meals', `emoji` = '🍱', `sort_order` = 1, `moved_to` = NULL, `moved_note` = NULL
WHERE `id` IN (
  SELECT min(c.`id`) FROM `categories` c JOIN `households` h ON h.`id` = c.`household_id`
  WHERE h.`categories_set` = 2 AND c.`key` IS NULL AND lower(c.`name`) = 'meals'
    AND NOT EXISTS (SELECT 1 FROM `categories` m WHERE m.`household_id` = c.`household_id` AND m.`key` = 'meals')
  GROUP BY c.`household_id`
);--> statement-breakpoint
INSERT INTO `categories` (`household_id`, `key`, `name`, `emoji`, `sort_order`, `created_at`)
SELECT h.`id`, 'meals', 'Meals', '🍱', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `households` h
WHERE h.`categories_set` = 2 AND NOT EXISTS (SELECT 1 FROM `categories` m WHERE m.`household_id` = h.`id` AND m.`key` = 'meals');
