# Deploying JobRadar

Server on Fly.io, client on Vercel. **Deploy the server first**, because the
client config needs its URL.

---

## 1. Server (Fly.io)

### Install flyctl

```bash
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Restart your terminal afterwards so `fly` is on PATH, then:

```bash
fly auth signup
```

Fly requires a card even on the free allowance. This shape (one always-on
shared-cpu-1x/512MB machine plus a 1GB volume) runs at roughly **$3 to $4 a
month**. Check current pricing before confirming.

### Create the app

From the `server/` directory:

```bash
fly launch --no-deploy
```

Answer the prompts like this:

| Prompt | Answer |
|---|---|
| `An existing fly.toml file was found... Would you like to use this fly.toml configuration?` | **y** |
| `Would you like to tweak these settings before proceeding?` | **n** |
| Postgres / Redis / Tigris storage | **n** to all |

The first one defaults to **N**, so pressing Enter rejects it. Type the `y`. If
you let Fly generate a fresh config instead, it drops the volume mount,
`auto_stop_machines = false` and the health check, and you end up with a server
that never runs its cron and loses its data on every deploy.

If the name `jobradar-api` is taken (names are globally unique), pick another
and remember it for step 2.

### Create the volume BEFORE deploying

This is the step that matters most. Without it the 30-day archive and the
auto-discovered company registry are written to the container filesystem and
wiped on every deploy, so discovery restarts from its seed list each time.

```bash
fly volumes create jobradar_data --size 1 --region lhr
```

The region must match `primary_region` in `fly.toml`.

### Deploy

```bash
fly deploy
```

Fly builds remotely, so you do not need Docker running locally.

### Verify

```bash
fly logs
```

You want to see `JobRadar server listening`, then `Refreshing all sources…`, and
about 90 seconds later `Refresh done in …` followed by the `Company registry:`
line. Then:

```bash
curl https://YOUR-APP.fly.dev/health
```

### Optional: LinkedIn and Indeed listings

```bash
fly secrets set RAPIDAPI_KEY=your_key_here
```

Setting a secret triggers a redeploy on its own.

---

## 2. Client (Vercel)

### Point it at your server

Edit `client/vercel.json` and replace the destination host with your real Fly
app URL:

```json
"destination": "https://YOUR-APP.fly.dev/api/:path*"
```

Commit and push that change.

This is a rewrite rather than a direct call, which means the browser only ever
talks to your Vercel domain. No CORS configuration, and no code change to the
existing `/api` fetch calls.

### Import the repo

1. Go to [vercel.com/new](https://vercel.com/new) and import `Akius1/jobradar`
2. Set **Root Directory** to `client` (this is the one setting that is easy to
   miss and it fails the build if wrong)
3. Leave the build command and output directory alone; `vercel.json` sets them
4. Deploy

Every push to `master` redeploys automatically from here on.

---

## Notes

**Hash routing means no SPA rewrite is needed.** Detail URLs look like
`/#/job/<id>`, so the fragment never reaches the server and cannot 404.

**Do not enable `auto_stop_machines`.** Sweeps run on a 30-minute cron. A
machine that suspends when idle never refreshes, so you would only ever see data
from whenever you last opened the page.

**If the machine dies mid-sweep with no stack trace, that is OOM.** Raise memory
in `fly.toml`:

```bash
fly scale memory 1024
```

**Watch the first few sweeps.** The company registry grows on its own, and each
new company adds requests to the next sweep. If sweeps start approaching the
180s timeout, lower the per-ATS caps in `server/src/discovery.js`.
