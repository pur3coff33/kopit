export type Env = {
  DB: D1Database;
  /** Optional: R2 needs a payment method on the Cloudflare account, so backups start switched off. */
  BACKUPS?: R2Bucket;
  ASSETS: Fetcher;
  PIN_PEPPER: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    householdId: number;
    householdCreatedAt: number;
    profile: { id: number; name: string; index: number; hideAmounts: boolean } | null;
    profileId: number;
    profileName: string;
    profileIndex: number;
    /** This phone's person tapped the eye: show the totals as ₱1•,•••. */
    hideAmounts: boolean;
  };
};
