# Contributing

How to run kopit locally, make changes, and look after a deployed copy.

By sending a pull request, you agree that your contribution is licensed under the [MIT License](LICENSE).

## Setup

You need Node and npm 11. npm 10.9 crashes while resolving the vitest peer dependencies. If you use [Volta](https://volta.sh), it picks up the versions pinned in `package.json` automatically.

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787/setup to create a household.

## Checks

```sh
npm test            # vitest, running inside the Workers runtime
npm run typecheck
```

Run both before you commit.

## Where things live

kopit is a single Cloudflare Worker: Hono with server-rendered JSX, and a D1 database through Drizzle.

```
src/index.ts        app entry, routes wired up here
src/routes/         one file per screen or API group
src/views/          shared layout and JSX components
src/lib/            the logic: money, time, stats, PINs, sessions…
src/db/schema.ts    Drizzle schema
src/backup.ts       nightly R2 backup (off for now, see below)
public/             static assets, service worker, browser JS
migrations/         generated SQL migrations, applied in order
scripts/            PIN reset and icon helpers
test/               one test file per area
```

There's no frontend framework. Pages are rendered on the server, and the small scripts in `public/js/` add the keypad, the offline queue and navigation between tabs.

## The first-time tours

The add, garden, history and garden shed screens each have a short tour that each person sees the first time they open the screen. It dims the screen and lights up one part at a time, with a note beside it. The stops and their words live in `tourSteps` in `src/views/tour.tsx`. Each stop points at the parts of its screen that carry its `data-spot` name, for example `data-spot="keypad"` on the keypad.

**When you change one of these screens, check its tour too.**

- **Moving or redesigning a part a stop points at:** keep its `data-spot` on the new element, and read the stop's note again. It may describe where things are or what they do.
- **Removing a part:** remove its stop, or point the stop at what replaced it.
- **Renaming a button or label:** update any note that mentions it by name (for example **More**, **＋ note**, **Undo**, **Switch**).
- **Adding something people need to know about:** add a stop. Keep each tour to 2–4 stops.
- **A new screen that needs a tour:** add it to `TOUR_SCREENS` and `tourSteps`, render `<Tour screen="…">` in the page, add `/js/tour-page.js` to its scripts, and add its path to `PATHS` in `test/tour.test.ts`.

`test/tour.test.ts` fails if a stop points at a `data-spot` its screen doesn't have. It can't tell when a note's words no longer match the screen, so that part is on you. To see a tour again, open `/?tour` while logged in: it plays the add screen's tour, and the others the next time each screen is opened.

## Changing the database

1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate`.
3. Commit the new file it creates in `migrations/`, along with the schema change.
4. Run `npm run db:migrate:local` to apply it to your local database.

## Conventions

- Money is stored as whole centavos, never floats. Use the helpers in `src/lib/money.ts`.
- Dates are Asia/Manila (UTC+8). Use `src/lib/time.ts` rather than `new Date()` arithmetic.
- Keep it within the Workers Free plan limits. Watch CPU time per request and the number of D1 queries.
- Commit messages follow `feat:`, `fix:`, `perf:`, `chore:` and so on, in lowercase.
- Branch off `main`, and merge back into `main`.

## Deploying

The first time:

```sh
npx wrangler login
npx wrangler d1 create kopit --location apac       # put the database_id into wrangler.jsonc
node -e "console.log(crypto.randomBytes(32).toString('hex'))"   # copy this value…
npx wrangler secret put PIN_PEPPER                  # …and paste it here
npx wrangler d1 migrations apply kopit --remote
npm run deploy                                      # → https://kopit.<you>.workers.dev
```

Keep `PIN_PEPPER` somewhere safe. Every PIN is hashed with it. If it's lost, no PIN can be checked or reset, and you'd need a new pepper and a PIN reset for every household.

After that, apply any new migrations, then deploy:

```sh
npx wrangler d1 migrations apply kopit --remote
npm run deploy
```

## Backups and restore

Nightly backups to R2 are switched off because R2 needs a payment method on the Cloudflare account. Two free options still work:

**D1 Time Travel** is always on and can restore the database to any minute in the last 30 days:

```sh
npx wrangler d1 time-travel info kopit
npx wrangler d1 time-travel restore kopit --timestamp=2026-10-19T03:00:00+08:00
```

**A manual export** to your computer, for example once a week:

```sh
npx wrangler d1 export kopit --remote --output kopit-2026-10-19.sql
```

### Turning on nightly R2 backups

The code in `src/backup.ts` is already written and tested. Every night at 03:00 Manila time it writes `backups/kopit-YYYY-MM-DD.sql` and keeps the newest 30. To switch it on:

1. Add a payment method in the Cloudflare dashboard. R2's free allowance is far more than kopit uses.
2. Run `npx wrangler r2 bucket create kopit-backups`.
3. In `wrangler.jsonc`, uncomment the `r2_buckets` and `triggers` lines, then run `npm run deploy`.
4. After the first few nights, check **Workers → kopit → Logs**. On the Free plan, a run that goes over its CPU limit fails quietly and writes no file.

To try it locally, run `npx wrangler dev --test-scheduled` with those lines uncommented, then:

```sh
curl "http://localhost:8787/__scheduled?cron=0+19+*+*+*"
```

To restore a nightly dump (sessions aren't in it, so everyone logs in again afterwards):

```sh
npx wrangler r2 object get kopit-backups/backups/kopit-2026-10-19.sql --file restore.sql --remote
npx wrangler d1 execute kopit --remote --command "DELETE FROM garden_days; DELETE FROM deleted_entries; DELETE FROM entries; DELETE FROM categories; DELETE FROM sessions; DELETE FROM profiles; DELETE FROM households;"
npx wrangler d1 execute kopit --remote --file restore.sql
```

## Resetting a forgotten PIN

```sh
PIN_PEPPER=<the production secret> node scripts/hash-pin.mjs <username> <new 6-digit pin>
npx wrangler d1 execute kopit --remote --command "<the UPDATE it printed>"
```

This also clears any lockout.

## Limits in the code

- `MAX_HOUSEHOLDS` in `src/lib/households.ts` caps a deployment at 15 households.
- `MAX_CENTAVOS` in `src/lib/money.ts` caps a single expense at ₱1,000,000.

## Known issues

Small things found in review and left for later are listed in [docs/known-issues.md](docs/known-issues.md).
