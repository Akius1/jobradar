# Deploying JobRadar

Runs entirely on free tiers. No card, nothing that can be suspended for billing.

## How it fits together

JobRadar barely needs a server. It sweeps job boards every 30 minutes and then
serves mostly-static JSON, which is a scheduled job rather than a web service.
That mismatch is why paid hosting felt wasteful and why most free tiers fit
badly: they sleep on inactivity, which silently kills the cron and leaves the
board frozen at whenever you last opened it.

So the work is split:

| Piece | Runs on | Why |
|---|---|---|
| The 30-minute sweep | GitHub Actions | Public repos get unlimited minutes. Nothing to keep awake. |
| Sweep output | A `data` branch | Force-pushed, so the repo never accumulates history. |
| Client + API | Vercel Hobby | Static site plus serverless functions, free. |

Live careers-page discovery still needs outbound HTTP at request time, so
`/api/job` stays a real function rather than being precomputed.

## One-time setup

### 1. Vercel

Import the repo at [vercel.com/new](https://vercel.com/new), then:

- **Root Directory: the repo root**, not `client`. The functions in `/api`
  import shared logic from `/server/src`, and Vercel cannot see outside the root
  directory you choose. Everything else comes from `vercel.json`.

Optional environment variables:

| Variable | Purpose |
|---|---|
| `RAPIDAPI_KEY` | Enables JSearch (LinkedIn / Indeed / Glassdoor). |
| `DATA_REPO` | Defaults to `Akius1/jobradar`. Set it if you fork. |

### 2. Kick off the first sweep

The Action runs every 30 minutes, but the `data` branch does not exist until the
first successful run, and the site returns 503 until it does. Trigger one by
hand: **Actions → Sweep job sources → Run workflow**.

It takes roughly two minutes. Afterwards you should have a `data` branch holding
`list.json`, `jobs.json` and `companies.json`.

If you want JSearch in CI too, add `RAPIDAPI_KEY` under
**Settings → Secrets and variables → Actions**.

## Checking it works

```bash
curl https://<your-app>.vercel.app/api/meta | head -c 400
```

Expect a live `lastRefresh` and `sourceStatus` for all 15 sources.

## Why the data lives on a branch

`jobs.json` is around 4MB. Committing that to `master` every 30 minutes would
add roughly 190MB of git objects a day and make the repo unusable within weeks.
The Action force-pushes a single commit to `data` instead, so the branch always
holds exactly one revision and history never grows.

The sweep restores the previous `jobs.json` before running, which is what lets
the 30-day archive and the auto-discovered company registry keep accumulating.
Skip that restore and every sweep starts from nothing, discovery stops
compounding, and the archive never gets deeper than a single run.

## Local development

Two terminals, unchanged:

```bash
cd server && npm install && npm start
```

```bash
cd client && npm install && npm run dev
```

The dev server serves the same routes from `server/src/index.js`, sharing
`query.js` with the serverless handlers so filtering cannot drift between them.

To run a single sweep without starting the server:

```bash
cd server && node src/sweep.js
```
