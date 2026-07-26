// Jobicy: https://jobicy.com/api/v2/remote-jobs (free, no key)
export async function fetchJobicy() {
  const res = await fetch(
    "https://jobicy.com/api/v2/remote-jobs?count=50&industry=dev",
    { headers: { "User-Agent": "JobRadar/1.0" } }
  );
  if (!res.ok) throw new Error(`Jobicy HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((j) => ({
    id: `jobicy-${j.id}`,
    source: "Jobicy",
    title: j.jobTitle,
    company: j.companyName,
    url: j.url,
    locationText: j.jobGeo || "Remote",
    salary:
      j.annualSalaryMin && j.annualSalaryMax
        ? `${j.salaryCurrency || "$"}${Math.round(j.annualSalaryMin / 1000)}k-${Math.round(j.annualSalaryMax / 1000)}k`
        : null,
    tags: Array.isArray(j.jobIndustry) ? j.jobIndustry : [],
    postedAt: Date.parse(j.pubDate),
    description: (j.jobExcerpt || "").slice(0, 2000).replace(/<[^>]+>/g, " "),
  }));
}
