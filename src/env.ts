export type Env = {
  DB: D1Database;
  /** Optional: R2 needs a payment method on the Cloudflare account, so backups start switched off. */
  BACKUPS?: R2Bucket;
  /** Workers AI, for each day's note (lib/daynote/). Without it there are simply no notes. */
  AI?: Ai;
  /** "1" in local dev (npm run dev): notes are made-up lines around the real numbers, and the AI is never asked. */
  DUMMY_NOTES?: string;
  ASSETS: Fetcher;
  CF_VERSION_METADATA: WorkerVersionMetadata;
  PIN_PEPPER: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    householdId: number;
    householdCreatedAt: number;
    profile: { id: number; name: string; index: number; hideAmounts: boolean; toursSeen: string[] } | null;
    profileId: number;
    profileName: string;
    profileIndex: number;
    /** This phone's person tapped the eye: show the totals as ₱1•,•••. */
    hideAmounts: boolean;
    /** The screens whose first-time tour this phone's person has had. */
    toursSeen: string[];
  };
};
