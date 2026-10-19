// Operator PIN reset. Usage:
//   PIN_PEPPER=<the production secret> node scripts/hash-pin.mjs <username> <6-digit pin>
// then run the printed SQL with: npx wrangler d1 execute kopit --remote --command "<sql>"
import { resetSql } from "./hash-pin-lib.mjs";

const [username, pin] = process.argv.slice(2);
const pepper = process.env.PIN_PEPPER;
if (!pepper || !username || !pin) {
  console.error("Usage: PIN_PEPPER=... node scripts/hash-pin.mjs <username> <6-digit pin>");
  process.exit(1);
}
try {
  console.log(await resetSql(pepper, username.trim().toLowerCase(), pin));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
