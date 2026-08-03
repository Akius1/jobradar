import express from "express";
import cors from "cors";
import cron from "node-cron";
import { getState, getJobs } from "./store.js";
import { refreshAll } from "./fetcher.js";
import { applyFacets, buildMeta, windowCutoff } from "./query.js";
import { buildPrep } from "./prep.js";
import { discoveryStats, findBoardFor } from "./discovery.js";
import { isPaywalled, friction, companyKey, resolveApplyRoutes, employerOrigin } from "./apply.js";
import { discoverApplyUrl, guessOrigin } from "./careers.js";

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors());
app.use(express.json());

// Fly polls this. It must answer immediately even while the first sweep is
// still running, otherwise the machine is killed mid-boot and never finishes.
app.get("/health", (_req, res) => {
  const state = getState();
  res.json({
    ok: true,
    jobs: state.jobs.length,
    lastRefresh: state.lastRefresh,
    uptime: Math.round(process.uptime()),
  });
});

// ---- API ----
//
// Filtering and facet logic lives in query.js so this dev server and the Vercel
// functions cannot drift apart. Production serves these same routes from
// serverless handlers reading the sweep output.

app.get("/api/jobs", (req, res) => {
  const all = getJobs();
  const inWindow = all.filter((j) => j.postedAt >= windowCutoff(req.query.within));
  const jobs = applyFacets(inWindow, req.query).sort((a, b) => b.postedAt - a.postedAt);

  // Descriptions are only needed on the detail screen, keep the list light.
  const list = jobs.map(({ description, ...rest }) => ({
    ...rest,
    paywalled: isPaywalled(rest.source),
  }));
  res.json({ jobs: list, meta: localMeta(all, req.query.within) });
});

// Single job + its positioning brief. Also returns a few similar live roles.
// Takes the id as a query param, source ids can contain slashes and colons,
// which would break a path segment.
app.get("/api/job", async (req, res) => {
  const jobs = getJobs();
  const job = jobs.find((j) => j.id === req.query.id);
  if (!job) {
    return res
      .status(404)
      .json({ error: "This role has aged out of the archive." });
  }
  const related = jobs
    .filter((j) => j.id !== job.id && j.role === job.role && j.eligibility === job.eligibility)
    .sort((a, b) => b.postedAt - a.postedAt)
    .slice(0, 4);

  // If this role sits behind a paywall, work out how to reach the employer
  // without paying: their own ATS board, or a cheaper source carrying the
  // same company.
  const paywalled = isPaywalled(job.source);
  let applyRoutes = null;
  if (paywalled) {
    const freeAlt = jobs
      .filter(
        (j) =>
          j.id !== job.id &&
          companyKey(j.company) === companyKey(job.company) &&
          friction(j.source) < friction(job.source)
      )
      .sort((a, b) => friction(a.source) - friction(b.source))[0];

    // Read the employer's own site to find where they really take applications.
    // Done here rather than during a sweep: it costs a couple of round trips, so
    // it should only run for roles someone actually opens. Results are cached.
    // Many ads name the employer without ever linking them, so fall back to
    // deriving the domain from the company name (verified before use).
    const origin = employerOrigin(job) || (await guessOrigin(job.company));
    const discovered = origin ? await discoverApplyUrl(origin, job.title) : null;

    applyRoutes = resolveApplyRoutes(job, findBoardFor(job.company), freeAlt, discovered);
  }

  res.json({ job, prep: buildPrep(job), related, paywalled, applyRoutes });
});

app.get("/api/meta", (req, res) => res.json(localMeta(getJobs(), req.query.within)));

app.post("/api/refresh", async (req, res) => {
  try {
    const result = await refreshAll();
    res.json({ ok: true, ...result, meta: localMeta(getJobs(), req.query.within) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Shared facet counts plus the live-only fields the dev server can report. */
function localMeta(all, withinKey) {
  const state = getState();
  return buildMeta(all, withinKey, {
    lastRefresh: state.lastRefresh,
    sourceStatus: state.sourceStatus,
    discovered: discoveryStats(),
    jsearchEnabled: Boolean(process.env.RAPIDAPI_KEY),
  });
}

// ---- Boot ----

app.listen(PORT, () => {
  console.log(`JobRadar server listening on http://localhost:${PORT}`);
  // Initial fetch on boot, then refresh every 30 minutes.
  refreshAll().catch((err) => console.error("Initial refresh failed:", err));
  cron.schedule("*/30 * * * *", () =>
    refreshAll().catch((err) => console.error("Scheduled refresh failed:", err))
  );
});
