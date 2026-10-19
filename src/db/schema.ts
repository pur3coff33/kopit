import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    spentAt: integer("spent_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("entries_household_spent").on(t.householdId, t.spentAt)],
);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  householdId: integer("household_id").notNull().references(() => households.id),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
