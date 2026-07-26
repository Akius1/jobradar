// Recruitee: widely used by European and Latin American startups, so it reaches
// employers the US-centric aggregators never list. Token list is almost entirely
// discovered rather than curated.

import { tokensFor, forgetToken } from "../discovery.js";
import { pooledMap } from "../pool.js";

const SEED = ["bunq", "sendcloud"];

async function fetchCompany(token) {
  const res = await fetch(`https://${token}.recruitee.com/api/offers/`, {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (res.status === 404) {
    forgetToken("recruitee", token);
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();

  return (data.offers || []).map((o) => ({
    id: `recruitee-${token}-${o.id}`,
    source: "Recruitee",
    title: o.title,
    company: token.charAt(0).toUpperCase() + token.slice(1),
    url: o.careers_url || o.careers_apply_url,
    locationText: o.remote
      ? [o.location, "Remote"].filter(Boolean).join(" · ")
      : o.location || [o.city, o.country].filter(Boolean).join(", ") || "Not stated",
    salary: null,
    tags: [o.department, o.employment_type_code].filter(Boolean),
    // "2026-07-24 13:38:47 UTC" is not ISO, so normalise before parsing.
    postedAt: Date.parse(String(o.published_at || o.created_at).replace(" UTC", "Z").replace(" ", "T")),
    description: [o.description, o.requirements].filter(Boolean).join("\n"),
  }));
}

export async function fetchRecruitee() {
  const tokens = tokensFor("recruitee", SEED);
  const results = await pooledMap(tokens, fetchCompany, 6);
  return results.flatMap((r) => (r.ok ? r.value : []));
}
