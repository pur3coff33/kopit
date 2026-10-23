// The fixed categories, the same for every household: six needs and five wants, each with ready-made notes.
// Built on research into how people sort their spending (see the design notes): a few broad groups, needs apart from
// wants, and one-off occasions together. Brand names only where they're the same across the country; anything
// regional (power and water companies, supermarkets) is generic, and a household types its own name once.
//
// Each household has one row per category (so expenses keep their foreign key), found by its `key`. Rows without a
// key are old categories a household had before the switch (switch.ts); they're never shown, only resolved.
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories } from "../db/schema";
import type { Env } from "../env";

export type CategoryKey =
  | "groceries"
  | "bills"
  | "transport"
  | "health"
  | "school"
  | "household"
  | "eating-out"
  | "shopping"
  | "fun"
  | "gifts"
  | "vices";
export type Group = "need" | "want";

export const FIXED: ReadonlyArray<{ key: CategoryKey; name: string; emoji: string; group: Group; presets: readonly string[] }> = [
  {
    key: "groceries",
    name: "Groceries",
    emoji: "🛒",
    group: "need",
    presets: ["Wet market", "Supermarket", "Corner store", "Rice", "Water refill", "Meat", "Fish", "Vegetables", "Fruit", "Eggs", "Bread", "Milk", "Coffee & sugar", "7-Eleven", "Alfamart"],
  },
  {
    key: "bills",
    name: "Bills",
    emoji: "💡",
    group: "need",
    presets: ["Electricity", "Water", "Internet", "Mobile load", "Rent", "Association dues", "Subscriptions", "Loan payment", "Installment", "Credit card", "SSS", "Pag-IBIG", "PhilHealth"],
  },
  {
    key: "transport",
    name: "Transport",
    emoji: "🚌",
    group: "need",
    presets: ["Jeepney", "Tricycle", "Bus", "Van", "Train", "Grab", "Motorcycle taxi", "Taxi", "Gas", "Parking", "Toll", "Car wash", "Car repair", "Motorcycle repair", "Ferry"],
  },
  {
    key: "health",
    name: "Health",
    emoji: "💊",
    group: "need",
    presets: ["Medicine", "Mercury Drug", "Watsons", "Generika", "TGP", "Checkup", "Lab tests", "Dental", "Vitamins", "Hospital", "Eyeglasses", "HMO", "Therapy"],
  },
  {
    key: "school",
    name: "School",
    emoji: "📚",
    group: "need",
    presets: ["Tuition", "School fees", "School allowance", "Supplies", "Projects", "Textbooks", "Uniform", "Printing", "Field trip", "School service", "National Book Store"],
  },
  {
    key: "household",
    name: "Household",
    emoji: "🧴",
    group: "need",
    presets: [
      "Toiletries", "Soap", "Shampoo", "Toothpaste", "Detergent", "Fabric conditioner", "Dishwashing liquid", "Cleaning supplies", "Cooking gas", "Diapers",
      "Baby stuff", "Pet food", "Laundry service", "Repairs", "Plumber", "Kitchen stuff", "Ace Hardware", "Wilcon", "Mr. DIY", "Daiso",
    ],
  },
  {
    key: "eating-out",
    name: "Eating out",
    emoji: "🍜",
    group: "want",
    presets: [
      "Jollibee", "McDonald's", "Chowking", "Mang Inasal", "Greenwich", "KFC", "Shakey's", "Max's", "Starbucks", "Coffee", "Milk tea",
      "Bakery", "Red Ribbon", "Goldilocks", "Food stall", "Street food", "GrabFood", "foodpanda", "Snacks", "Lunch", "Dinner",
    ],
  },
  {
    key: "shopping",
    name: "Shopping",
    emoji: "🛍️",
    group: "want",
    presets: ["Clothes", "Shoes", "Bags", "Gadgets", "Phone", "Accessories", "Makeup", "Skincare", "Shopee", "Lazada", "TikTok Shop", "SM Store", "Uniqlo", "Penshoppe", "Bench", "Thrift shop", "Appliances", "Home decor"],
  },
  {
    key: "fun",
    name: "Fun & outings",
    emoji: "🎉",
    group: "want",
    presets: [
      "Movies", "Mall trip", "Games", "Steam", "Mobile game", "Concert", "Karaoke", "Resort",
      "Beach", "Swimming", "Hotel", "Flights", "Cebu Pacific", "PAL", "Gym", "Sports", "Hobbies", "Books",
    ],
  },
  {
    key: "gifts",
    name: "Gifts & occasions",
    emoji: "🎁",
    group: "want",
    presets: [
      "Birthday", "Christmas", "Wedding", "Baptism", "Debut", "Graduation", "Anniversary", "Valentine's", "Mother's Day",
      "Father's Day", "Fiesta", "Party", "Souvenirs", "Condolence money", "Church offering", "Donation", "Money for family",
    ],
  },
  {
    // Drinking, smoking and gambling together: the spending a household most often wants to see plainly and cut.
    key: "vices",
    name: "Vices",
    emoji: "🚬",
    group: "want",
    presets: ["Beer", "Liquor", "Wine", "Bar", "Drinks", "Cigarettes", "Vape", "Lotto", "Scratch cards", "E-sabong", "Online casino", "Cards", "Mahjong"],
  },
];

export const WANTS: ReadonlySet<CategoryKey> = new Set(FIXED.filter((c) => c.group === "want").map((c) => c.key));

const ORDER = new Map(FIXED.map((c, i) => [c.key, i]));
const GROUP = new Map(FIXED.map((c) => [c.key, c.group]));

/** A person's name: trimmed, spaces collapsed, 1–24 characters; null otherwise. */
export function cleanName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, " ");
  return n.length >= 1 && n.length <= 24 ? n : null;
}

export type Cat = { id: number; key: CategoryKey; name: string; emoji: string; group: Group };

const pick = { id: categories.id, key: categories.key, name: categories.name, emoji: categories.emoji };

const toCat = (r: { id: number; key: string | null; name: string; emoji: string }): Cat => ({
  id: r.id,
  key: r.key as CategoryKey,
  name: r.name,
  emoji: r.emoji,
  group: GROUP.get(r.key as CategoryKey)!,
});

/** The household's categories, in the fixed order. */
export async function listCategories(env: Env, householdId: number): Promise<Cat[]> {
  const rows = await getDb(env)
    .select(pick)
    .from(categories)
    .where(and(eq(categories.householdId, householdId), isNotNull(categories.key)))
    .orderBy(asc(categories.sortOrder));
  return rows.map(toCat).sort((a, b) => ORDER.get(a.key)! - ORDER.get(b.key)!);
}

/** One of the household's categories; undefined for another household's, or an old retired one. */
export async function getCategory(env: Env, householdId: number, id: number): Promise<Cat | undefined> {
  const [row] = await getDb(env)
    .select(pick)
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId), isNotNull(categories.key)));
  return row ? toCat(row) : undefined;
}

/**
 * Where an expense with category `id` goes: one of the fixed ones stays itself; an old retired one (still sent by a phone
 * that saved it offline before the switch) goes where its expenses moved, with the note they got. Undefined when
 * `id` isn't this household's at all.
 */
export async function resolveCategory(
  env: Env,
  householdId: number,
  id: number,
): Promise<{ categoryId: number | null; name: string | null; note: string | null } | undefined> {
  const db = getDb(env);
  const [row] = await db
    .select({ key: categories.key, name: categories.name, movedTo: categories.movedTo, movedNote: categories.movedNote })
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
  if (!row) return undefined;
  if (row.key !== null) return { categoryId: id, name: row.name, note: null };
  const to = row.movedTo === null ? undefined : await getCategory(env, householdId, row.movedTo);
  return { categoryId: to?.id ?? null, name: to?.name ?? null, note: row.movedNote };
}
