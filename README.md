# 📡 JobRadar

Aggregates **every software role** posted across remote job boards worldwide,
filterable from the **last 2 hours to the last month**, and grades each one on
whether someone applying from Nigeria / Africa can actually get hired.

Click any role for a detail screen with an eligibility breakdown, the stack the
posting is really screening on, and a discipline-specific plan for positioning
yourself against it.

## Why an aggregator, not a scraper

LinkedIn and X both hard-block scrapers (auth walls, bot detection, ToS). Rather
than build on something that breaks weekly, JobRadar pulls from public APIs and
RSS feeds, including **JSearch**, which legitimately resells LinkedIn, Indeed
and Glassdoor listings through RapidAPI.

## Sources

| Source | Key needed | Notes |
|---|---|---|
| Remotive | no | category feed + 8 targeted searches |
| RemoteOK | no | |
| Arbeitnow | no | German market, occasional visa flags |
| Himalayas | no | paginated, 8 pages |
| WeWorkRemotely | no | 5 category RSS feeds |
| Jobicy | no | |
| JSearch | **yes** | LinkedIn / Indeed / Glassdoor, skipped without a key |
| **Greenhouse** | no | 32 company boards, direct from employer |
| **Lever** | no | 6 company boards, direct from employer |
| **Ashby** | no | 8 company boards, favoured by funded startups |
| **HackerNews** | no | Who is hiring thread, posted by founders directly |
| **Recruitee** | no | EU and LatAm startups, mostly auto-discovered |
| **WorkingNomads** | no | global remote, strong LatAm and APAC coverage |
| **Landing.jobs** | no | Portugal and EU, exposes a relocation_paid flag |
| **RegionalFeeds** | no | EURemoteJobs, Jobspresso, NoDesk, Programathor (Brazil) |

### The hidden job market

The last four are where roles actually surface first. A company posts to its own
Greenhouse or Ashby board, and only later (sometimes never) syndicates out to an
aggregator. Applying from these puts you in a far smaller pile.

Board tokens sit at the top of each adapter in `server/src/sources/`. To add a
company, take the token from its board URL (`boards.greenhouse.io/<token>`,
`jobs.lever.co/<token>`, `jobs.ashbyhq.com/<token>`) and append it to the list.

Greenhouse is fetched in two phases, because its list endpoint is cheap and
carries `first_published`. Recent software roles are identified from that before
any full description is pulled. Fetching content for every posting instead would
move roughly 60MB per sweep.

Hacker News must be queried through `search_by_date` scoped to the official
`whoishiring` account. The plain relevance-ranked search returns the 2016 and
2017 threads, which sit outside every freshness window and silently yield zero.

## Run it

Two terminals:

```bash
cd server && npm install && npm start
```

```bash
cd client && npm install && npm run dev
```

Then open http://localhost:5173. The server sweeps all sources on boot and every
30 minutes after (`node-cron`), and stores results in `server/data/jobs.json`.

### Optional: LinkedIn / Indeed / Glassdoor

Get a free RapidAPI key for [JSearch](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)
(~200 requests/month free; JobRadar throttles to 3 requests per 12h), then:

```bash
set RAPIDAPI_KEY=your_key_here && npm start
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/jobs?within=&role=&eligibility=&source=&q=` | Filtered list (descriptions stripped) |
| `GET /api/job?id=<id>` | One role + positioning brief + similar roles |
| `GET /api/meta?within=` | Counts, windows, discipline taxonomy, source health |
| `POST /api/refresh` | Force a sweep now |

The single-job route takes its id as a **query param**, not a path segment.
Source ids contain slashes and colons that would break path routing.

### Filtering

`within` selects the freshness window: `2h`, `6h`, `12h`, `24h`, `48h` (default),
`7d`, `30d`. Postings are retained for 30 days and narrowed at query time.

`role`, `eligibility` and `source` each accept a **comma-separated list**.
Multi-select is OR within a group and AND across groups, so
`?role=frontend,backend&eligibility=eligible,relocation` reads as
"(frontend OR backend) AND (open worldwide OR offers relocation)".

`eligibility=relocation` is not a fourth verdict. It cuts across all three,
because a region-locked role that sponsors a visa is still reachable.

Facet counts are computed over the selected time window only, not over the other
active facets, so a chip's number never shifts as you toggle its siblings.

## Disciplines

Titles are matched against an ordered taxonomy (most specific first), so
"Machine Learning Engineer" lands in AI/ML rather than a generic bucket:

`AI / ML · Data · Security · Blockchain / Web3 · Game Dev · Embedded / IoT ·
Mobile · DevOps / Cloud · QA / Test · Fullstack · Frontend · Backend ·
Lead / Manager · General Software`

Generic titles ("Software Engineer") fall through to tag inspection, React +
Node tags resolve to Fullstack. Non-engineering roles are dropped outright.
Only disciplines with live postings appear as filters.

## How eligibility scoring works

Every posting's location text and description are matched against three
patterns in `server/src/filter.js`:

- 🟢 **Open worldwide**, says "worldwide", "anywhere", "global", "EMEA", or
  names an African country
- 🟠 **Policy unstated**, remote with no explicit geography, or based in a
  country we have no rule for. Worth applying to; many are genuinely open
- 🔴 **Region-locked**, "USA", "United States", "must be EU-based", timezone
  requirements. A relocation/visa mention softens this to 🟠 rather than hiding it

**Precedence matters.** The posting's own location field is the strong signal;
the description is only consulted when that field is generic ("Remote"). Without
that rule, boilerplate like "we're a global team" upgrades an Ecuador-only role
to "open worldwide", which is exactly the mistake this tool exists to prevent.

## Architecture

```
server/
  src/index.js       Express API + 30-min cron
  src/fetcher.js     runs 15 sources through a pool, per-source timeouts
  src/filter.js      discipline taxonomy + eligibility scoring + HTML cleanup
  src/prep.js        skill extraction + positioning playbooks
  src/contact.js     published-address extraction + outreach search links
  src/discovery.js   mines ATS tokens from postings, self-growing company list
  src/pool.js        bounded concurrency + retry for every multi-request source
  src/store.js       JSON persistence, dedupe, 30-day expiry, schema versioning
  src/sources/*.js   one adapter per board → normalized shape
client/
  src/App.jsx        hash routing, filters, search, job cards
  src/JobDetail.jsx  detail screen: eligibility, skills, playbook, outreach, posting
  src/shared.js      verdict labels + relative time
```

A failing source never breaks a sweep, `Promise.allSettled` isolates each one
and the UI reports how many are live. Filter state lives above the route switch,
so it survives a trip into a role and back.

### Gotchas worth knowing

- **WeWorkRemotely's RSS double-escapes its HTML.** Angle-bracket entities must
  be decoded *before* stripping tags, or `&lt;p&gt;` renders as visible markup.
  The feed also trips fast-xml-parser's entity-expansion limit, hence
  `processEntities: false`.
- **Himalayas returns both `excerpt` (~280 chars) and `description` (~8k).** Use
  the latter, or skill extraction has nothing to work with.
- **The store is schema-versioned.** Jobs are only re-scored when re-fetched, so
  a scoring change would otherwise leave old verdicts frozen in the cache. Bump
  `SCHEMA_VERSION` in `store.js` and the stale file is discarded on next boot.
- **JSearch is quota-throttled to one run per 12h.** At 30-minute sweeps it would
  otherwise burn the 200/month free tier in about two days.

## Reaching a human

Applications sent into an ATS mostly vanish. The detail screen carries a
**Reach a human** panel that:

- surfaces application addresses **the employer published in its own ad** (HN
  posters in particular write "email me at ..."), labelled as either a team
  inbox or a contact named in the ad
- builds LinkedIn, careers-page and X **search links you click yourself**
- adapts the advice to the source: an HN thread wants a public reply as well as
  an email, while a company board means you are early and should move fast

**What it deliberately does not do:** guess or permute addresses
(`firstname.lastname@company.com`), verify them against a mail server, scrape
profiles, or store anyone's details. That turns research into personal-data
harvesting, which breaches Nigeria's NDPA and the GDPR, and gets a sending
domain blacklisted so the outreach stops landing anyway. Everything surfaced
here is either published by the employer for exactly this purpose, or a search
link the user runs themselves.

Scraping LinkedIn and X directly was considered and rejected. Both sit behind
auth walls, both actively block automation, and both prohibit it in their terms.
JSearch is the sanctioned route to LinkedIn and Indeed listings.

## Company discovery

The company list is not maintained by hand. Every sweep already pulls thousands
of postings, and many link back to the employer's own applicant tracking system.
`server/src/discovery.js` mines those links for board tokens and writes them to
`data/companies.json`, so the next sweep polls those companies directly.

The effect compounds. A Brazilian startup mentioned once in a Hacker News
comment becomes a board we poll from then on, along with every role it posts
afterwards. The first sweep discovered 99 companies from the seed list alone,
and Ashby went from 535 postings to 1,242 on the following pass.

Tokens are recognised for Greenhouse, Lever, Ashby, Workable and Recruitee.
Boards that return 404 are pruned via `forgetToken`, so dead entries do not
accumulate, and per-ATS caps stop a runaway feed from making sweeps unbounded.

To seed a company directly, add its token to the `SEED` array in the relevant
adapter. Everything else arrives on its own.

## Regional coverage

Reach as measured over a 30-day window, 661 roles across 305 distinct companies:

| Region | Roles |
|---|---|
| North America | 171 |
| Worldwide | 138 |
| Europe | 86 |
| Brazil / LatAm | 55 |
| Japan / APAC | 28 |

Landing.jobs (Portugal and the wider EU) is the only source exposing
`relocation_paid` as a structured field rather than something inferred from
prose. Programathor is Brazilian and posts in Portuguese, which is why the role
classifier carries Portuguese, Spanish and German keywords: without them,
"Desenvolvedor Backend" and "Engenheiro de Dados" are silently discarded.

## Scheduling and limits

Sources run through a bounded pool (`server/src/pool.js`) rather than all at
once, ordered light to heavy. This matters more than it sounds: the employer
boards hold hundreds of connections open for minutes, and when everything
started simultaneously they saturated the socket pool so badly that RemoteOK,
a single fast request, timed out. Pooling at five concurrent sources fixed the
starvation and cut a sweep from 153s to 98s.

Each source gets a timeout matched to its shape (180s for the ATS crawlers, 60s
for single-request feeds), and the pool retries transient network failures once
with backoff. Lever needs particular care: a single board such as Palantir's
exceeds 5MB, so descriptions are trimmed at the adapter rather than downstream,
keeping peak memory independent of posting length.

## Reality check on volume

Roughly 1,000 postings get fetched per sweep, ~420 are software roles, and
**80-100 fall inside the 48-hour window**, of which 15-25 grade as
Africa-friendly. That is the honest daily size of this market, so treat a small
number as accurate rather than broken. Widen the window in the UI to see more.

Two things measured, not assumed:

- **Relocation mentions are rare on remote-first boards** (1 genuine mention in
  240 postings). The relocation filter works, but it only fills up once JSearch
  is enabled, since those listings include onsite roles that do sponsor visas.
- **WeWorkRemotely dominates the 7-day and 30-day windows** and is overwhelmingly
  "Anywhere in the World", so the Africa-friendly ratio climbs sharply as the
  window widens. That is real data, not a scoring drift.
