// The fixed categories, the same for every household: seven needs and five wants, each with ready-made notes.
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
import { DAY_MS } from "./time";

export type CategoryKey =
  | "groceries"
  | "meals"
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

/** `description` says in a line what goes in it; it shows under the name when the category's notes slide up. */
export const FIXED: ReadonlyArray<{ key: CategoryKey; name: string; emoji: string; group: Group; description: string; presets: readonly string[] }> = [
  {
    key: "groceries",
    name: "Groceries",
    emoji: "🛒",
    description: "Food and basics for home: market, supermarket, water refill, cleaning supplies",
    group: "need",
    presets: [
      "Wet market", "Supermarket", "Corner store", "Rice", "Water refill", "Meat", "Fish", "Vegetables", "Fruit", "Eggs", "Bread", "Milk", "Coffee & sugar",
      "Detergent", "Fabric conditioner", "Dishwashing liquid", "Cleaning supplies", "7-Eleven", "Alfamart",
    ],
  },
  {
    // Food bought because there's no other way on a work or school day; Eating out is the treat.
    key: "meals",
    name: "Meals",
    emoji: "🍱",
    description: "Food you have to buy when you're out: office lunch, canteen, carinderia, baon",
    group: "need",
    presets: ["Office lunch", "Lunch", "Breakfast", "Dinner", "Carinderia", "Turo-turo", "Canteen", "Food stall", "Rice meal", "Baon", "Merienda"],
  },
  {
    key: "bills",
    name: "Bills",
    emoji: "💡",
    description: "Must-pays every month: power, water, internet, cooking gas, rent, loans, contributions",
    group: "need",
    presets: ["Electricity", "Water", "Internet", "Mobile load", "Cooking gas", "Rent", "Association dues", "Subscriptions", "Loan payment", "Installment", "Credit card", "SSS", "Pag-IBIG", "PhilHealth"],
  },
  {
    key: "transport",
    name: "Transport",
    emoji: "🚌",
    description: "Getting around: fares, rides, gas, parking, repairs",
    group: "need",
    presets: ["Jeepney", "Tricycle", "Bus", "Van", "Train", "Grab", "Motorcycle taxi", "Taxi", "Gas", "Parking", "Toll", "Car wash", "Car repair", "Motorcycle repair", "Ferry"],
  },
  {
    key: "health",
    name: "Personal care & Health",
    emoji: "💊",
    description: "Looking after yourself: haircuts, toiletries, medicine, checkups, dental, vitamins",
    group: "need",
    presets: [
      "Haircut", "Barber", "Salon", "Nails", "Spa", "Massage", "Toiletries", "Soap", "Shampoo", "Toothpaste",
      "Medicine", "Mercury Drug", "Watsons", "Generika", "TGP", "Checkup", "Lab tests", "Dental", "Vitamins", "Hospital", "Eyeglasses", "HMO", "Therapy",
    ],
  },
  {
    key: "school",
    name: "Work & Education",
    emoji: "📚",
    description: "Studying and working: tuition, allowance, supplies, training, licenses",
    group: "need",
    presets: [
      "Tuition", "School fees", "School allowance", "Supplies", "Projects", "Textbooks", "Uniform", "Printing", "Field trip", "School service",
      "National Book Store", "Training", "Seminar", "Review center", "Board exam", "Licenses", "Work tools",
    ],
  },
  {
    key: "household",
    name: "Family & Relationships",
    emoji: "👨‍👩‍👧",
    description: "Family, the people you love and the home you share: padala, kids, dates, pets, repairs",
    group: "need",
    presets: [
      "Money for family", "Padala", "Allowance for kids", "Diapers", "Baby stuff", "Date", "Pet food", "Vet",
      "Laundry service", "Repairs", "Plumber", "Kitchen stuff", "Ace Hardware", "Wilcon", "Mr. DIY", "Daiso",
    ],
  },
  {
    key: "eating-out",
    name: "Eating out",
    emoji: "🍜",
    description: "Treats: fast food, coffee, milk tea, restaurants, delivery",
    group: "want",
    presets: [
      "Jollibee", "McDonald's", "Chowking", "Mang Inasal", "Greenwich", "KFC", "Shakey's", "Max's", "Starbucks", "Coffee", "Milk tea",
      "Bakery", "Red Ribbon", "Goldilocks", "Street food", "GrabFood", "foodpanda", "Snacks",
    ],
  },
  {
    key: "shopping",
    name: "Shopping",
    emoji: "🛍️",
    description: "Things you want: clothes, gadgets, online orders, beauty",
    group: "want",
    presets: ["Clothes", "Shoes", "Bags", "Gadgets", "Phone", "Accessories", "Makeup", "Skincare", "Shopee", "Lazada", "TikTok Shop", "SM Store", "Uniqlo", "Penshoppe", "Bench", "Thrift shop", "Appliances", "Home decor"],
  },
  {
    key: "fun",
    name: "Fun & outings",
    emoji: "🎉",
    description: "Going out and hobbies: movies, trips, games, resorts, gym",
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
    description: "Birthdays, holidays, weddings, church, donations",
    group: "want",
    presets: [
      "Birthday", "Christmas", "Wedding", "Baptism", "Debut", "Graduation", "Anniversary", "Valentine's", "Mother's Day",
      "Father's Day", "Fiesta", "Party", "Souvenirs", "Condolence money", "Church offering", "Donation",
    ],
  },
  {
    // Drinking, smoking and gambling together: the spending a household most often wants to see plainly and cut.
    key: "vices",
    name: "Vices",
    emoji: "🚬",
    description: "Drinking, smoking and gambling",
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

const EVERYDAY: readonly CategoryKey[] = ["groceries", "meals", "transport", "bills"];

/**
 * The add screen's "Your usual": the household's four most used categories of the last 60 days (most first; a tie goes
 * to the one used last), topped up from the everyday ones so a new household has some too.
 */
export async function usualCategories(env: Env, householdId: number, now: number, n = 4): Promise<Cat[]> {
  const cats = await listCategories(env, householdId);
  const { results } = await env.DB.prepare(
    `SELECT c.id AS id FROM entries e JOIN categories c ON c.id = e.category_id
     WHERE e.household_id = ? AND c.key IS NOT NULL AND e.spent_at >= ?
     GROUP BY c.id ORDER BY COUNT(*) DESC, MAX(e.spent_at) DESC LIMIT ?`,
  )
    .bind(householdId, now - 60 * DAY_MS, n)
    .all<{ id: number }>();
  const used = results.map((r) => cats.find((c) => c.id === r.id)!).filter(Boolean);
  const everyday = EVERYDAY.map((k) => cats.find((c) => c.key === k)!).filter((c) => c && !used.includes(c));
  return [...used, ...everyday].slice(0, n);
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
