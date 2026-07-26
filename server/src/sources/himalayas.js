// Himalayas: https://himalayas.app/jobs/api (free, no key)
// The API caps each response at 20 jobs, so we page through with offset.
const PAGES = 8;

function normalize(j, i) {
  return {
    id: `himalayas-${j.guid || i}`,
    source: "Himalayas",
    title: j.title,
    company: j.companyName,
    url: j.applicationLink || j.guid,
    locationText: (j.locationRestrictions || []).join(", ") || "Worldwide",
    salary:
      j.minSalary && j.maxSalary
        ? `$${Math.round(j.minSalary / 1000)}k-$${Math.round(j.maxSalary / 1000)}k`
        : null,
    tags: j.categories || [],
    postedAt: (j.pubDate || 0) * 1000,
    // description is the full posting (~8k chars); excerpt is only a teaser.
    description: j.description || j.excerpt || "",
  };
}

async function getPage(offset) {
  const res = await fetch(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`, {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (!res.ok) throw new Error(`Himalayas HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map(normalize);
}

export async function fetchHimalayas() {
  const offsets = Array.from({ length: PAGES }, (_, i) => i * 20);
  const results = await Promise.allSettled(offsets.map(getPage));
  const jobs = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!jobs.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
  return jobs;
}
