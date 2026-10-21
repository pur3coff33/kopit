import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const households = sqliteTable("households", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  pinHash: text("pin_hash").notNull(),
  pinSalt: text("pin_salt").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until"),
  createdAt: integer("created_at").notNull(),
});

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  householdId: integer("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  /** The eye by the totals: this person sees every amount as ₱•••• until they tap it again. */
  hideAmounts: integer("hide_amounts", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    householdId: integer("household_id").notNull().references(() => households.id),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("categories_household_name").on(t.householdId, t.name)],
);

export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    householdId: integer("household_id").notNull().references(() => households.id),
    profileId: integer("profile_id").notNull().references(() => profiles.id),
    categoryId: integer("category_id").references(() => categories.id),
    amountCentavos: integer("amount_centavos").notNull(),
    /** Optional one-line description, up to 60 characters. */
    note: text("note"),
    spentAt: integer("spent_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("entries_household_spent").on(t.householdId, t.spentAt)],
);

/** Ids of deleted expenses, so a late offline resend can't bring one back. */
export const deletedEntries = sqliteTable("deleted_entries", {
  id: text("id").primaryKey(),
  householdId: integer("household_id").notNull().references(() => households.id),
  deletedAt: integer("deleted_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  householdId: integer("household_id").notNull().references(() => households.id),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/**
 * How each finished day went on its missions: a cache, rebuilt from the expenses whenever needed. Rows are
 * cleared when an expense on that day, the day before or a week before changes (see invalidateGarden).
 */
export const gardenDays = sqliteTable(
  "garden_days",
  {
    householdId: integer("household_id").notNull().references(() => households.id),
    /** Manila day key: days since the epoch in Manila time. */
    day: integer("day").notNull(),
    missions: integer("missions").notNull(),
    done: integer("done").notNull(),
    /** Comma-separated mission types met that day, for the month's "most beaten" mission. */
    doneTypes: text("done_types").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.day] })],
);

/**
 * Each day's missions, fixed the first time they're needed (normally the household's first open that day): the
 * 28-day baseline they were drawn from. Never cleared, so later edits to older expenses can't change a day's missions.
 */
export const dayMissions = sqliteTable(
  "day_missions",
  {
    householdId: integer("household_id").notNull().references(() => households.id),
    /** Manila day key. */
    day: integer("day").notNull(),
    /** The Baseline (missions.ts) as JSON. */
    baseline: text("baseline").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.day] })],
);
