// Working Nomads: global remote board with strong coverage outside the US,
// including Latin America and APAC. Location strings are region lists such as
// "Europe, North America, Latin America, APAC", which the eligibility scorer
// reads directly.

import { pooledMap } from "../pool.js";

export async function fetchWorkingNomads() {
  // One request, but it lands mid-sweep alongside every other source, so a
  // transient socket failure here is worth retrying rather than reporting.
  const [result] = await pooledMap([null], async () => {
    const res = await fetch("https://www.workingnomads.com/api/exposed_jobs/", {
      headers: { "User-Agent": "JobRadar/1.0" },
    });
    if (!res.ok) throw new Error(`WorkingNomads HTTP ${res.status}`);
    return res.json();
  }, 1, 2);
  if (!result.ok) throw result.error;
  const data = result.value;
  if (!Array.isArray(data)) throw new Error("WorkingNomads: unexpected payload");

  return data.map((j, i) => ({
    id: `wnomads-${(j.url || i).split("/").filter(Boolean).pop()}`,
    source: "WorkingNomads",
    title: j.title,
    company: j.company_name || "Unknown",
    url: j.url,
    locationText: j.location || "Remote",
    salary: null,
    tags: String(j.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5),
    postedAt: Date.parse(j.pub_date),
    description: j.description || "",
  }));
}
