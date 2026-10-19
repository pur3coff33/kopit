// Outbox-first saving: the entry is on the phone before any network request starts,
// so closing the app mid-save or a hanging request can never lose it.
// Resending is safe because the server ignores ids it has already seen.

export const SAVE_TIMEOUT_MS = 7000;

/**
 * Sends one entry. Returns { status: "saved", note } | { status: "queued" } | { status: "rejected" }.
 * "queued" means it stays in the outbox for a later flush; "rejected" (HTTP 400) can never succeed.
 */
export async function sendQueued(entry, { remove, post, timeoutMs = SAVE_TIMEOUT_MS }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await post(entry, ctrl.signal);
  } catch {
    return { status: "queued" };
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) {
    await remove(entry.id);
    const body = await res.json().catch(() => ({}));
    return { status: "saved", note: body.note };
  }
  if (res.status === 400) {
    await remove(entry.id);
    return { status: "rejected" };
  }
  return { status: "queued" };
}

export async function saveEntry(entry, deps) {
  await deps.enqueue(entry);
  return sendQueued(entry, deps);
}
