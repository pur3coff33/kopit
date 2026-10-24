import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const households = sqliteTable("households", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  pinHash: text("pin_hash").notNull(),
  pinSalt: text("pin_salt").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until"),
  createdAt: integer("created_at").notNull(),
  /** 2: on the fixed categories. 1: still on its own old categories, until its first visit switches it (switch.ts). */
  categoriesSet: integer("categories_set").notNull().default(2),
});

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  householdId: integer("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  /** The eye by the total: this person sees the garden's totals as ₱1•,••• until they tap it again. */
  hideAmounts: integer("hide_amounts", { mode: "boolean" }).notNull().default(false),
  /** The screens whose first-time tour this person has had (or closed), comma-separated: "add,garden". */
  toursSeen: text("tours_seen").notNull().default(""),
  /** What this person has already had of the day's start (morning.ts), as JSON: {"leaf","note":"YYYY-MM-DD","wrapped":"YYYY-MM","week":"YYYY-MM-DD"}. */
  morningSeen: text("morning_seen").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    householdId: integer("household_id").notNull().references(() => households.id),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    /** Which of the fixed categories (categories.ts) this row is. Null: an old category, retired by the switch. */
    key: text("key"),
    /** A retired row: the category its expenses moved to (null: none), and the note they got if they had none. */
    movedTo: integer("moved_to"),
    movedNote: text("moved_note"),
    /** Only read by the one-time switch (switch.ts): old households could hide categories. Nothing sets it now. */
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("categories_household_name").on(t.householdId, t.name), uniqueIndex("categories_household_key").on(t.householdId, t.key)],
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
 * cleared when an expense on that day, the day before or a week before changes (see invalidateGarden), except
 * `final` ones: days before the household moved to the fixed categories, kept for good (switch.ts).
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
    /** A final day's missions as history shows them (PastMission[] as JSON); null on cached days. */
    items: text("items"),
    final: integer("final", { mode: "boolean" }).notNull().default(false),
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

/**
 * Each finished day's note (lib/daynote/): the numbers kop.it worked out and the few lines the AI wrote around them, as
 * JSON. Written the first time it's asked for; the row is deleted when an expense on that day changes (written again
 * then). Until the note is in, the row counts the tries at it and holds the claim of the phone writing it.
 */
export const dayNotes = sqliteTable(
  "day_notes",
  {
    householdId: integer("household_id").notNull().references(() => households.id),
    /** Manila day key. */
    day: integer("day").notNull(),
    /** The DayNote (lib/daynote/types.ts) as JSON; null until it's written. */
    note: text("note"),
    /** Tries at writing it that cost something (MAX_TRIES at most). */
    tries: integer("tries").notNull().default(0),
    /** A random id for whoever is writing it right now, and since when; null when no one is. */
    claim: text("claim"),
    claimedAt: integer("claimed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.day] })],
);
