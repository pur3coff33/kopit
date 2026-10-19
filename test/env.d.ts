import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as KopitEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends KopitEnv {
      TEST_MIGRATIONS: D1Migration[];
      BACKUPS: R2Bucket; // always bound in tests (vitest.config.ts)
    }
  }
}
