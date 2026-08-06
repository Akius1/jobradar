// Lever public postings API. One request per company returns full descriptions
// inline, so no second phase is needed.

import { tokensFor, forgetToken } from "../discovery.js";
import { pooledMap } from "../pool.js";

// Verified against the live postings API before being added; discovery grows
// the rest. See the note in ashby.js on why a seed is still needed at all.
const SEED = [
  "palantir", "qonto", "contentsquare", "swordhealth", "younited", "ledger",
  "wealthfront", "tradeify", "anyscale",
];

async function fetchCompany(token) {
  const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  // A discovered token that 404s is not a real board; stop polling it.
  if (res.status === 404) {
    forgetToken("lever", token);
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((j) => ({
    id: `lever-${token}-${j.id}`,
    source: "Lever",
    title: j.text,
    company: token.charAt(0).toUpperCase() + token.slice(1),
    url: j.hostedUrl || j.applyUrl,
    locationText:
      j.categories?.location ||
      (j.workplaceType === "remote" ? "Remote" : "Not stated"),
    salary: null,
    tags: [j.categories?.team, j.categories?.commitment].filter(Boolean),
    postedAt: j.createdAt,
    // Trimmed here rather than downstream: a sweep holds every board in memory
    // at once, so peak usage should not scale with full posting length.
    description: [j.descriptionPlain, j.additionalPlain]
      .filter(Boolean)
      .join("\n")
      .slice(0, 6000),
  }));
}

export async function fetchLever() {
  const tokens = tokensFor("lever", SEED);
  // Boards can exceed 5MB each. Six in flight balances throughput against
  // the socket resets that appear at higher concurrency; retries cover the rest.
  const results = await pooledMap(tokens, fetchCompany, 6);
  const jobs = results.flatMap((r) => (r.ok ? r.value : []));

  // Only treat it as a source failure if every single board errored, which
  // means the host is down or blocking rather than one token being stale.
  if (!jobs.length && results.every((r) => !r.ok)) {
    throw results[0]?.error || new Error("Lever: all boards failed");
  }
  return jobs;
}
