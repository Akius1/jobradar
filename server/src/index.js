import express from "express";
import cors from "cors";
import cron from "node-cron";
import { getState, getJobs } from "./store.js";
import { refreshAll } from "./fetcher.js";
import { ROLE_LABELS } from "./filter.js";
import { buildPrep } from "./prep.js";
import { discoveryStats } from "./discovery.js";

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors());
app.use(express.json());

// ---- API ----

// Selectable freshness windows, in hours.
export const WINDOWS = [
  { key: "2h", label: "2 hours", hours: 2 },
  { key: "6h", label: "6 hours", hours: 6 },
  { key: "12h", label: "12 hours", hours: 12 },
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "48h", label: "2 days", hours: 48 },
  { key: "7d", label: "1 week", hours: 24 * 7 },
  { key: "30d", label: "1 month", hours: 24 * 30 },
];
const DEFAULT_WINDOW = "48h";

/** Comma-separated facet value into a Set, or null when the facet is unset. */
function parseFacet(value) {
  if (!value || value === "all") return null;
  const parts = String(value).split(",").filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

function windowCutoff(key) {
  const w = WINDOWS.find((x) => x.key === key) || WINDOWS.find((x) => x.key === DEFAULT_WINDOW);
  return Date.now() - w.hours * 60 * 60 * 1000;
}

/** Apply every active facet. Multi-select is OR within a group, AND across groups. */
function applyFacets(jobs, query) {
  const roles = parseFacet(query.role);
  if (roles) jobs = jobs.filter((j) => roles.has(j.role));

  const elig = parseFacet(query.eligibility);
  if (elig) {
    jobs = jobs.filter(
      (j) => elig.has(j.eligibility) || (elig.has("relocation") && j.relocation)
    );
  }

  const sources = parseFacet(query.source);
  if (sources) jobs = jobs.filter((j) => sources.has(j.source));

  return jobs;
}

app.get("/api/jobs", (req, res) => {
  const { q, within } = req.query;
  const cutoff = windowCutoff(within);
  const inWindow = getJobs().filter((j) => j.postedAt >= cutoff);

  let jobs = applyFacets(inWindow, req.query);

  if (q) {
    const needle = q.toLowerCase();
    jobs = jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(needle) ||
        j.company.toLowerCase().includes(needle) ||
        (j.tags || []).some((t) => t.toLowerCase().includes(needle))
    );
  }

  jobs.sort((a, b) => b.postedAt - a.postedAt);
  // Descriptions are only needed on the detail screen, keep the list light.
  const list = jobs.map(({ description, ...rest }) => rest);
  res.json({ jobs: list, meta: buildMeta(inWindow, within) });
});

// Single job + its positioning brief. Also returns a few similar live roles.
// Takes the id as a query param, source ids can contain slashes and colons,
// which would break a path segment.
app.get("/api/job", (req, res) => {
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

  res.json({ job, prep: buildPrep(job), related });
});

app.get("/api/meta", (req, res) => res.json(buildMeta(null, req.query.within)));

app.post("/api/refresh", async (req, res) => {
  try {
    const result = await refreshAll();
    res.json({ ok: true, ...result, meta: buildMeta(null, req.query.within) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Facet counts are computed over the selected time window only, not over the
 * other active facets, so a chip's number never changes as you toggle its
 * siblings. Window counts are computed over everything retained.
 */
function buildMeta(windowed, withinKey) {
  const state = getState();
  const all = getJobs();
  const jobs = windowed || all.filter((j) => j.postedAt >= windowCutoff(withinKey));

  const counts = {};
  const eligibility = { eligible: 0, maybe: 0, restricted: 0, relocation: 0 };
  const sources = {};
  for (const j of jobs) {
    counts[j.role] = (counts[j.role] || 0) + 1;
    eligibility[j.eligibility] = (eligibility[j.eligibility] || 0) + 1;
    if (j.relocation) eligibility.relocation += 1;
    sources[j.source] = (sources[j.source] || 0) + 1;
  }

  const now = Date.now();
  const windows = WINDOWS.map((w) => ({
    ...w,
    count: all.filter((j) => j.postedAt >= now - w.hours * 60 * 60 * 1000).length,
  }));
  // Only surface roles that actually have live postings, busiest first.
  const roles = ROLE_LABELS.map((r) => ({ ...r, count: counts[r.key] || 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    total: jobs.length,
    retained: all.length,
    within: withinKey || DEFAULT_WINDOW,
    windows,
    lastRefresh: state.lastRefresh,
    sourceStatus: state.sourceStatus,
    roles,
    eligibility,
    sources,
    discovered: discoveryStats(),
    jsearchEnabled: Boolean(process.env.RAPIDAPI_KEY),
  };
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
