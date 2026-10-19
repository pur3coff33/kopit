export type Env = {
  DB: D1Database;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  PIN_PEPPER: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { householdId: number; profileId: number; profileName: string };
};
