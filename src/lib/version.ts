import type { Env } from "../env";

// The deploy this Worker runs: when its version was uploaded (an ISO time, so a later deploy sorts after it).
// It's the same for every request an isolate serves, so it's kept here for the layout to stamp on each page.
let running = "";

/** Notes the running deploy; called on every request, before any page renders. */
export function noteVersion(env: Env) {
  running = env.CF_VERSION_METADATA.timestamp;
}

/** The running deploy, as stamped on pages and answered at /version. */
export function version() {
  return running;
}
