import { fetchRemotive } from "./sources/remotive.js";
import { fetchRemoteOK } from "./sources/remoteok.js";
import { fetchArbeitnow } from "./sources/arbeitnow.js";
import { fetchHimalayas } from "./sources/himalayas.js";
import { fetchWWR } from "./sources/weworkremotely.js";
import { fetchJobicy } from "./sources/jobicy.js";
import { fetchJSearch } from "./sources/jsearch.js";
import { fetchGreenhouse } from "./sources/greenhouse.js";
import { fetchLever } from "./sources/lever.js";
import { fetchAshby } from "./sources/ashby.js";
import { fetchHackerNews } from "./sources/hackernews.js";
import { fetchWorkingNomads } from "./sources/workingnomads.js";
import { fetchLandingJobs } from "./sources/landingjobs.js";
import { fetchWpFeeds } from "./sources/wpfeeds.js";
import { fetchRecruitee } from "./sources/recruitee.js";
import { fetchDelon } from "./sources/delon.js";
import { fetchBambooHR } from "./sources/bamboohr.js";
import { processJob } from "./filter.js";
import { mergeJobs } from "./store.js";
import { harvestTokens, discoveryStats, probeCompanies } from "./discovery.js";
import { pooledMap } from "./pool.js";

/**
 * Ordered light to heavy, and run through a bounded pool rather than all at
 * once. The employer boards hold hundreds of connections open for minutes; when
 * everything started simultaneously they starved the small feeds, and RemoteOK
 * would time out purely because Ashby and Lever had saturated the socket pool.
 */
const SOURCES = [
  // Single-request feeds: seconds each.
  ["RemoteOK", fetchRemoteOK],
  ["Jobicy", fetchJobicy],
  ["JSearch", fetchJSearch],
  ["WorkingNomads", fetchWorkingNomads],
  ["Arbeitnow", fetchArbeitnow],
  ["RegionalFeeds", fetchWpFeeds],
  ["WeWorkRemotely", fetchWWR],
  ["Remotive", fetchRemotive],
  ["Himalayas", fetchHimalayas],
  ["Landing.jobs", fetchLandingJobs],
  ["HackerNews", fetchHackerNews],
  // Nigerian board: small, but every posting on it is reachable from here.
  ["DelonJobs", fetchDelon],
  // Direct-from-employer boards: roles land here before any aggregator sees
  // them, but each polls dozens to hundreds of companies.
  ["Recruitee", fetchRecruitee],
  ["BambooHR", fetchBambooHR],
  ["Greenhouse", fetchGreenhouse],
  ["Lever", fetchLever],
  ["Ashby", fetchAshby],
];

// How many sources may be in flight at once.
const SOURCE_CONCURRENCY = 5;

// New company names to test against the ATS APIs per sweep. The backlog is
// worked through a slice at a time so the first sweep after a deploy is not
// dramatically slower than the rest; at 48 sweeps a day it drains quickly.
const PROBE_BUDGET = 150;

/**
 * The employer boards poll hundreds of companies and some payloads are large
 * (a single Lever board can exceed 5MB), so they need far more headroom than a
 * one-request feed. Sixty seconds is plenty for everything else.
 */
// Raised alongside the discovery caps: these three now poll several times the
// number of boards they used to, and the timeout rejects the source as a whole,
// so overshooting it costs every posting rather than the slow board's. A full
// sweep measures around two minutes against a fifteen-minute CI budget, so the
// headroom is free.
const TIMEOUTS = {
  Greenhouse: 300_000,
  Lever: 300_000,
  Ashby: 300_000,
  Recruitee: 120_000,
  HackerNews: 120_000,
};

let inFlight = null;

export function refreshAll() {
  // Collapse concurrent refreshes into one.
  if (inFlight) return inFlight;
  inFlight = doRefresh().finally(() => (inFlight = null));
  return inFlight;
}

async function doRefresh() {
  console.log("Refreshing all sources…");
  const started = Date.now();
  const sourceStatus = {};

  // Timeouts start when a source is picked up by a worker, not when queued.
  const settled = await pooledMap(
    SOURCES,
    ([name, fn]) => withTimeout(fn(), TIMEOUTS[name] || 60_000),
    SOURCE_CONCURRENCY,
    0 // sources handle their own retries internally
  );

  const jobs = [];
  const companyNames = [];
  settled.forEach((r, i) => {
    const name = SOURCES[i][0];
    const result = r.ok
      ? { status: "fulfilled", value: r.value }
      : { status: "rejected", reason: r.error };
    if (result.status === "fulfilled") {
      // Mine every posting for employer ATS links before filtering, so we learn
      // about companies even from roles we are not going to keep.
      harvestTokens(result.value);
      // Names are collected from every posting, not just the ones we keep: a
      // company whose only listed role is non-technical may still have a board
      // full of engineering ones we would never otherwise learn about.
      for (const j of result.value) if (j.company) companyNames.push(j.company);
      const processed = result.value.map(processJob).filter(Boolean);
      jobs.push(...processed);
      sourceStatus[name] = { ok: true, fetched: result.value.length, matched: processed.length };
      console.log(`  ${name}: ${result.value.length} fetched → ${processed.length} matched`);
    } else {
      sourceStatus[name] = { ok: false, error: String(result.reason?.message || result.reason) };
      console.warn(`  ${name} FAILED: ${result.reason?.message || result.reason}`);
    }
  });

  const { added, total } = mergeJobs(jobs, sourceStatus);

  // Runs after the sources, so anything found here is polled from the next
  // sweep on. Deliberately last: it is the one step whose failure should not
  // cost us a single posting we already have in hand.
  try {
    const probed = await probeCompanies(companyNames, PROBE_BUDGET, pooledMap);
    if (Object.keys(probed).length) {
      console.log(
        `  New boards found by probing: ${Object.entries(probed)
          .map(([k, v]) => `${k} +${v}`)
          .join(", ")}`
      );
    }
  } catch (err) {
    console.warn(`  Board probing failed: ${err.message}`);
  }

  const discovered = discoveryStats();
  console.log(`Refresh done in ${Date.now() - started}ms, ${added} new, ${total} live`);
  console.log(
    `  Company registry: ${Object.entries(discovered)
      .filter(([k]) => k !== "updatedAt")
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`
  );
  return { added, total, sourceStatus, discovered };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    ),
  ]);
}
