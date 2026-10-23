-- Vices joins the fixed categories (drinking, smoking, gambling). Households already on them get the tile: a household's
-- own old "Vices" from before the switch comes back as it, otherwise a new one is added. Households still waiting for
-- their switch get it then (switch.ts adds every missing fixed category).
UPDATE `categories` SET `key` = 'vices', `name` = 'Vices', `emoji` = '🚬', `sort_order` = 10, `moved_to` = NULL, `moved_note` = NULL
WHERE `id` IN (
  SELECT min(c.`id`) FROM `categories` c JOIN `households` h ON h.`id` = c.`household_id`
  WHERE h.`categories_set` = 2 AND c.`key` IS NULL AND lower(c.`name`) = 'vices'
    AND NOT EXISTS (SELECT 1 FROM `categories` v WHERE v.`household_id` = c.`household_id` AND v.`key` = 'vices')
  GROUP BY c.`household_id`
);--> statement-breakpoint
INSERT INTO `categories` (`household_id`, `key`, `name`, `emoji`, `sort_order`, `created_at`)
SELECT h.`id`, 'vices', 'Vices', '🚬', 10, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `households` h
WHERE h.`categories_set` = 2 AND NOT EXISTS (SELECT 1 FROM `categories` v WHERE v.`household_id` = h.`id` AND v.`key` = 'vices');
