// JSearch (RapidAPI): aggregates LinkedIn / Indeed / Glassdoor postings.
// Requires RAPIDAPI_KEY in env; silently skipped when absent.
//
// Quota guard: the free tier is ~200 requests/MONTH. Sweeps run every 30 min,
// so calling this every sweep would burn the month's quota in ~2 days. We
// throttle to one JSearch run per 12h → 3 queries × 2/day ≈ 180/month.
const THROTTLE_MS = 12 * 60 * 60 * 1000;

const QUERIES = [
  "software engineer remote worldwide",
  "frontend developer remote worldwide",
  "backend developer remote worldwide",
];

let lastRun = 0;
let lastResults = [];

export async function fetchJSearch() {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return [];

  // Serve the cached batch until the throttle window elapses.
  if (Date.now() - lastRun < THROTTLE_MS) return lastResults;

  const all = [];
  for (const query of QUERIES) {
    const url = new URL("https://jsearch.p.rapidapi.com/search");
    url.searchParams.set("query", query);
    url.searchParams.set("date_posted", "today");
    url.searchParams.set("num_pages", "1");
    const res = await fetch(url, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
    });
    if (!res.ok) throw new Error(`JSearch HTTP ${res.status}`);
    const data = await res.json();
    for (const j of data.data || []) {
      all.push({
        id: `jsearch-${j.job_id}`,
        source: "JSearch",
        title: j.job_title,
        company: j.employer_name,
        url: j.job_apply_link,
        locationText: [j.job_city, j.job_country, j.job_is_remote ? "Remote" : null]
          .filter(Boolean)
          .join(", "),
        salary:
          j.job_min_salary && j.job_max_salary
            ? `$${Math.round(j.job_min_salary / 1000)}k-$${Math.round(j.job_max_salary / 1000)}k`
            : null,
        tags: j.job_employment_type ? [j.job_employment_type.toLowerCase()] : [],
        postedAt: j.job_posted_at_timestamp ? j.job_posted_at_timestamp * 1000 : Date.now(),
        description: (j.job_description || "").slice(0, 2000),
      });
    }
  }

  lastRun = Date.now();
  lastResults = all;
  return all;
}
