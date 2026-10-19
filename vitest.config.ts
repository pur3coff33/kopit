import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { PIN_PEPPER: "test-pepper", TEST_MIGRATIONS: migrations },
          // Backups are off in wrangler.jsonc, but the code stays tested so it can be switched on later.
          r2Buckets: ["BACKUPS"],
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
