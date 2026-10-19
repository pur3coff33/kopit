import { applyD1Migrations, env, reset } from "cloudflare:test";
import { afterEach, beforeEach } from "vitest";

// Storage is shared across tests by default; give every test a clean, migrated database.
beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(async () => {
  await reset();
});
