// Loads sweep output published by the GitHub Action.
//
// The Action force-pushes to a "data" branch, so raw.githubusercontent always
// serves the newest sweep without needing a redeploy. Responses are cached in
// module scope, which survives across warm invocations of the same function
// instance and keeps the common path off the network entirely.

import { shardOf } from "../server/src/shard.js";

const REPO = process.env.DATA_REPO || "Akius1/jobradar";
const BRANCH = process.env.DATA_BRANCH || "data";
const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// GitHub's raw CDN caches for around five minutes, so asking more often than
// the sweep interval gains nothing.
const TTL = 5 * 60 * 1000;

const cache = new Map();

async function loadJson(file) {
  const hit = cache.get(file);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const res = await fetch(`${BASE}/${file}`, {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (!res.ok) {
    // Serve stale rather than erroring: a brief blip on GitHub's side should
    // not take the whole board down.
    if (hit) return hit.value;
    const err = new Error(`Could not load ${file} (HTTP ${res.status}). Has the sweep run yet?`);
    err.status = res.status; // callers distinguish "no such file" from "GitHub is down"
    throw err;
  }

  const value = await res.json();
  cache.set(file, { at: Date.now(), value });
  return value;
}

/** Slim records, no descriptions. Enough for the list and every facet count. */
export const loadList = () => loadJson("list.json");

/**
 * One full record, description included. The archive is sharded by id, so this
 * pulls a few hundred KB rather than the whole month: the unsharded jobs.json
 * had reached 100MB, and fetching and parsing it put /api/job within a second
 * or two of its own maxDuration.
 */
export async function loadJob(id) {
  const shard = await ifPresent(`jobs/${shardOf(id)}.json`);
  if (shard) return shard.find((j) => j.id === id) || null;

  // The data branch held a single jobs.json before the archive was sharded.
  // Only reachable between this deploying and the first sweep that publishes
  // shards; safe to delete once one has run.
  const legacy = await ifPresent("jobs.json");
  return legacy?.jobs?.find((j) => j.id === id) || null;
}

/**
 * Null when the file is genuinely not there, but still throws on anything else.
 * A GitHub outage must not read as "no such role" and 404 the detail page.
 */
async function ifPresent(file) {
  try {
    return await loadJson(file);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Auto-discovered ATS board tokens, used to route around paywalls. */
export const loadCompanies = () => loadJson("companies.json").catch(() => ({}));

/** Consistent cache headers: the CDN can serve while we revalidate behind it. */
export function setCacheHeaders(res, seconds = 300) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`
  );
}
