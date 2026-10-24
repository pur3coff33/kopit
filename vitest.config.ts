import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // Workers AI is remote-only: tests stay offline and hand each note's writer a stand-in instead (daynote.test.ts).
        remoteBindings: false,
        miniflare: {
          bindings: { PIN_PEPPER: "test-pepper", TEST_MIGRATIONS: migrations },
          // Backups are off in wrangler.jsonc, but the code stays tested so it can be switched on later.
          r2Buckets: ["BACKUPS"],
        },
      }),
    ],
    // Some route tests hash several PINs and sessions; give slow machines headroom.
    test: { setupFiles: ["./test/setup.ts"], testTimeout: 15_000 },
  };
});
