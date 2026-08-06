// Himalayas: https://himalayas.app/jobs/api (free, no key)
// The API caps each response at 20 jobs, so we page through with offset.
const PAGES = 8;

// The feed intermittently emits its own column headers as values, so a run of
// postings arrives with companyName literally "name". Rendering that as the
// employer is worse than admitting we do not know.
const JUNK_COMPANY = /^(name|title|company|null|undefined|n\/a|-)?$/i;

function normalize(j, i) {
  const company = String(j.companyName || "").trim();
  // Both bounds present and non-zero, or we have no salary worth showing:
  // "$0k-$0k" was reaching the UI as though it were a real range.
  const hasSalary = j.minSalary > 0 && j.maxSalary > 0;

  return {
    id: `himalayas-${j.guid || i}`,
    source: "Himalayas",
    title: j.title,
    company: JUNK_COMPANY.test(company) ? "" : company,
    url: j.applicationLink || j.guid,
    locationText: (j.locationRestrictions || []).join(", ") || "Worldwide",
    salary: hasSalary
      ? `$${Math.round(j.minSalary / 1000)}k-$${Math.round(j.maxSalary / 1000)}k`
      : null,
    tags: j.categories || [],
    postedAt: (j.pubDate || 0) * 1000,
    // Himalayas is the one source that publishes a closing date. Carry it so
    // the archive can drop the role the day it lapses rather than a month later.
    expiresAt: j.expiryDate ? j.expiryDate * 1000 : null,
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
