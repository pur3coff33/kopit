import { hashPinCore, newSalt } from "../src/lib/pin-core.js";

/** SQL that sets a household's PIN and clears any lockout. */
export async function resetSql(pepper, username, pin) {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must be 6 digits");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("username must be 3–32 lowercase letters, numbers, dots, dashes or underscores");
  const salt = newSalt();
  const hash = await hashPinCore(pepper, salt, pin);
  return `UPDATE households SET pin_hash='${hash}', pin_salt='${salt}', failed_attempts=0, locked_until=NULL WHERE username='${username}';`;
}
