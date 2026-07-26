// Remotive: https://remotive.com/api/remote-jobs (free, no key)
// The unfiltered category feed skews old, so we also run targeted searches
// which surface far more recent frontend/fullstack postings.
const QUERIES = [
  "frontend",
  "backend",
  "full stack",
  "devops",
  "data engineer",
  "machine learning",
  "mobile developer",
  "qa engineer",
];

function normalize(j) {
  return {
    id: `remotive-${j.id}`,
    source: "Remotive",
    title: j.title,
    company: j.company_name,
    url: j.url,
    locationText: j.candidate_required_location,
    salary: j.salary || null,
    tags: j.tags,
    postedAt: Date.parse(j.publication_date),
    description: (j.description || "").slice(0, 2000).replace(/<[^>]+>/g, " "),
  };
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "JobRadar/1.0" } });
  if (!res.ok) throw new Error(`Remotive HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map(normalize);
}

export async function fetchRemotive() {
  const urls = [
    "https://remotive.com/api/remote-jobs?category=software-dev&limit=200",
    ...QUERIES.map(
      (q) =>
        `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`
    ),
  ];
  const results = await Promise.allSettled(urls.map(get));
  const jobs = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!jobs.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
  return jobs;
}
