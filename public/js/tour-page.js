// Starts a screen's first-time tour (garden, history, garden shed). The add screen starts its own from add.js, where it
// has to take turns with yesterday's leaf and Wrapped.
import { startTour } from "./tour.js";

/** Starts this screen's tour if it's due; returns a function that stops it. */
export function mount() {
  const dialog = document.querySelector("#tour");
  if (dialog) startTour(dialog);
  return () => {};
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();
