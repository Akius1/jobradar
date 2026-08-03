// Loads sweep output published by the GitHub Action.
//
// The Action force-pushes to a "data" branch, so raw.githubusercontent always
// serves the newest sweep without needing a redeploy. Responses are cached in
// module scope, which survives across warm invocations of the same function
// instance and keeps the common path off the network entirely.

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
    throw new Error(`Could not load ${file} (HTTP ${res.status}). Has the sweep run yet?`);
  }

  const value = await res.json();
  cache.set(file, { at: Date.now(), value });
  return value;
}

/** Slim records, no descriptions. Enough for the list and every facet count. */
export const loadList = () => loadJson("list.json");

/** Full records including descriptions. Only the detail view needs these. */
export const loadFull = () => loadJson("jobs.json");

/** Auto-discovered ATS board tokens, used to route around paywalls. */
export const loadCompanies = () => loadJson("companies.json").catch(() => ({}));

/** Consistent cache headers: the CDN can serve while we revalidate behind it. */
export function setCacheHeaders(res, seconds = 300) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`
  );
}
