# kopit

Household expense tracker. Logging an expense means typing the amount, optionally tapping a category, and pressing **Save**. The spending screen shows where the money went, with a few gentle nudges.

It's one Cloudflare Worker (Hono, server-rendered with `hono/jsx`), with a D1 database (Drizzle). An optional nightly SQL backup to R2 is switched off for now. It installs as a PWA and saves expenses offline. There's no frontend framework: the browser code is in `public/js/`.

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

## Deploy (first time)

```sh
npx wrangler login
npx wrangler d1 create kopit --location apac       # put the database_id into wrangler.jsonc
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

Nightly backups to R2 are **switched off**, because R2 needs a payment method on the Cloudflare account. Without them you still have two free options:

- **D1 Time Travel** is automatic, free and needs no setup. It can restore the database to any minute in the last 30 days:

  ```sh
  npx wrangler d1 time-travel info kopit
  npx wrangler d1 time-travel restore kopit --timestamp=2026-10-19T03:00:00+08:00
  ```

- **Export a copy to your computer** whenever you like (for example, at each weekly review):

  ```sh
  npx wrangler d1 export kopit --remote --output kopit-2026-10-19.sql
  ```

### Turning nightly R2 backups on later

The code is already written and tested (`src/backup.ts`). It writes `backups/kopit-YYYY-MM-DD.sql` every night at 03:00 Manila and keeps the newest 30. To switch it on:

1. Add a payment method in the Cloudflare dashboard (R2's free allowance is far more than kopit needs).
2. Run `npx wrangler r2 bucket create kopit-backups`.
3. In `wrangler.jsonc`, uncomment the `r2_buckets` and `triggers` lines, then run `npm run deploy`.
4. After the first few nights, check **Workers → kopit → Logs**. On the Free plan, a run that goes over its CPU limit fails quietly and writes no file.

To try it locally, run `npx wrangler dev --test-scheduled` with those lines uncommented, then `curl "http://localhost:8787/__scheduled?cron=0+19+*+*+*"`.

To restore a nightly dump (sessions aren't included, so everyone logs in again afterwards):

```sh
npx wrangler r2 object get kopit-backups/backups/kopit-2026-10-19.sql --file restore.sql --remote
npx wrangler d1 execute kopit --remote --command "DELETE FROM deleted_entries; DELETE FROM entries; DELETE FROM categories; DELETE FROM sessions; DELETE FROM profiles; DELETE FROM households;"
npx wrangler d1 execute kopit --remote --file restore.sql
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
