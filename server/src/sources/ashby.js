// Ashby public job board API. Favoured by newer, well-funded startups, so this
// surfaces roles that rarely reach the big aggregators. Descriptions inline.

import { tokensFor, forgetToken } from "../discovery.js";
import { pooledMap } from "../pool.js";

const SEED = [
  "notion", "linear", "cursor", "ramp", "replit", "sardine", "resend", "neon",
];

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
      company: token.charAt(0).toUpperCase() + token.slice(1),
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
