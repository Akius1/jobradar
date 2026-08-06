// Ashby public job board API. Favoured by newer, well-funded startups, so this
// surfaces roles that rarely reach the big aggregators. Descriptions inline.

import { tokensFor, forgetToken } from "../discovery.js";
import { pooledMap } from "../pool.js";

// Every token here was confirmed against the live posting API before being
// added. Discovery expands this set on its own; the seed exists for employers
// that never appear in an aggregator feed at all, which is precisely the case
// active probing cannot reach — nothing ever mentions them to probe from.
const SEED = [
  "notion", "linear", "cursor", "ramp", "replit", "sardine", "resend", "neon",
  "openai", "snowflake", "harvey", "sierra", "clickhouse", "cohere", "preply",
  "plaid", "nubank", "langchain", "vanta", "clickup", "baseten", "supabase",
  "temporal", "benchling", "sentry", "miro", "watershed", "render", "encord",
  "modal", "confluent", "astronomer", "hex", "roboflow", "redis", "workos",
  "column", "runpod", "oyster", "anyscale", "tradeify", "zapier",
  "airbyte", "railway", "moderntreasury", "prefect", "stytch", "unit",
  "neptune", "babbel", "buffer", "influxdata", "bunny",
];

/**
 * Ashby's posting API never names the company, so the board token is all we
 * have. Tokens are slugs, and rendering them raw gave "Duck-duck-go" and
 * "Runway-ml" in the UI. Split on the separators and title-case each word, but
 * leave anything that is already a domain ("hive.co") alone.
 */
function companyFrom(token) {
  if (/\.[a-z]{2,}$/i.test(token)) return token;
  return token
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function fetchCompany(token) {
  const res = await fetch(
    `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`,
    { headers: { "User-Agent": "JobRadar/1.0" } }
  );
  if (res.status === 404) {
    forgetToken("ashby", token);
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();

  return (data.jobs || [])
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      id: `ashby-${token}-${j.id}`,
      source: "Ashby",
      title: j.title,
      company: companyFrom(token),
      url: j.jobUrl || j.applyUrl,
      locationText: [j.location, j.isRemote ? "Remote" : null]
        .filter(Boolean)
        .join(" · "),
      salary: j.compensation?.compensationTierSummary || null,
      tags: [j.department, j.team, j.employmentType].filter(Boolean),
      postedAt: Date.parse(j.publishedAt),
      description: (j.descriptionPlain || j.descriptionHtml || "").slice(0, 6000),
    }));
}

export async function fetchAshby() {
  const results = await pooledMap(tokensFor("ashby", SEED), fetchCompany, 6);
  const jobs = results.flatMap((r) => (r.ok ? r.value : []));
  if (!jobs.length && results.every((r) => !r.ok)) {
    throw results[0]?.error || new Error("Ashby: all boards failed");
  }
  return jobs;
}
