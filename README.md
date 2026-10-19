# kopit

Household expense tracker. Logging an expense means typing the amount, optionally tapping a category, and pressing **Save**. The spending screen shows where the money went, with a few gentle nudges.

It's one Cloudflare Worker (Hono, server-rendered with `hono/jsx`), with a D1 database (Drizzle) and a nightly SQL backup to R2. It installs as a PWA and saves expenses offline. There's no frontend framework: the browser code is in `public/js/`.

## Local development

```sh
npm install                 # npm 11 recommended (npm 10.9 crashes resolving vitest peers)
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev                 # http://localhost:8787 → /setup to create a household
npm test                    # vitest inside the Workers runtime
npm run typecheck
```

After changing `src/db/schema.ts`, run `npm run db:generate` and commit the new file in `migrations/`.

To test the nightly backup locally, run `npx wrangler dev --test-scheduled`, then:

```sh
curl "http://localhost:8787/__scheduled?cron=0+19+*+*+*"
```

## Deploy (first time)

```sh
npx wrangler login
npx wrangler d1 create kopit --location apac       # put the database_id into wrangler.jsonc
npx wrangler r2 bucket create kopit-backups
node -e "console.log(crypto.randomBytes(32).toString('hex'))"   # copy this value…
npx wrangler secret put PIN_PEPPER                  # …and paste it here
npx wrangler d1 migrations apply kopit --remote
npm run deploy                                      # → https://kopit.<you>.workers.dev
```

**Keep `PIN_PEPPER` somewhere safe.** Every PIN is hashed with it. If it's lost, no PIN can be checked or reset, and you'd have to set a new pepper and reset every household's PIN.

Later deploys: `npx wrangler d1 migrations apply kopit --remote` (only if there are new migrations), then `npm run deploy`.

## Install on phones

- **Android (Chrome):** open the workers.dev URL, then use the menu → **Install app**.
- **iPhone (Safari):** open the URL, then use **Share → Add to Home Screen**. Open kopit from the new icon and **log in once inside the app**: iOS keeps the home-screen app's cookies separate from Safari's.
- Each phone then picks who it belongs to. The login lasts a year.
- Offline saves are kept on the phone and sent the next time kopit is opened with signal. iPhones don't sync in the background, so open the app to send them.

## Backups and restore

A cron job (`0 19 * * *`, 03:00 Manila) writes `backups/kopit-YYYY-MM-DD.sql` to the `kopit-backups` bucket and keeps the newest 30. Sessions aren't backed up, so after a restore everyone logs in again.

Restore a dump:

```sh
npx wrangler r2 object get kopit-backups/backups/kopit-2026-10-19.sql --file restore.sql --remote
npx wrangler d1 execute kopit --remote --command "DELETE FROM deleted_entries; DELETE FROM entries; DELETE FROM categories; DELETE FROM sessions; DELETE FROM profiles; DELETE FROM households;"
npx wrangler d1 execute kopit --remote --file restore.sql
```

The dump has SQLite build each line, so the Worker does very little work. Still, glance at **Workers → kopit → Logs** after the first few nightly runs: on the Free plan, a run that goes over its CPU limit fails quietly and writes no file. D1 also has 30-day point-in-time restore built in:

```sh
npx wrangler d1 time-travel info kopit
npx wrangler d1 time-travel restore kopit --timestamp=2026-10-19T03:00:00+08:00
```

## Forgotten PIN

```sh
PIN_PEPPER=<the production secret> node scripts/hash-pin.mjs <username> <new 6-digit pin>
npx wrangler d1 execute kopit --remote --command "<the UPDATE it printed>"
```

This also clears any lockout. Otherwise, a household locks for 15 minutes after 5 wrong PINs. You can also change a PIN in the app: **Settings → Change PIN**.

## Limits worth knowing

- At most 5 households (`MAX_HOUSEHOLDS` in `src/lib/households.ts`).
- Amounts go up to ₱1,000,000 per expense and are stored as centavos. All dates use Asia/Manila time (UTC+8).
- Everything is sized to fit the Workers Free plan.
- Creating a new category needs internet. Saving an expense doesn't.
