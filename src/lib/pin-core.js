// Plain JS on purpose: shared by the Worker and scripts/hash-pin.mjs (Node 22).
const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** hex HMAC-SHA256(key = pepper, message = salt + ":" + pin) */
export async function hashPinCore(pepper, salt, pin) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(`${salt}:${pin}`)));
}

export function newSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}
