// Landing.jobs: Portugal and wider EU, and unusually useful here because the
// API exposes relocation_paid as a first-class field rather than something we
// have to infer from prose. Paginated, newest first.

const PAGES = 4;

async function fetchPage(page) {
  const res = await fetch(`https://landing.jobs/api/v1/jobs?page=${page}&limit=50`, {
    headers: { "User-Agent": "JobRadar/1.0", Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const jobs = Array.isArray(data) ? data : data.jobs || data.data || [];

  return jobs.map((j) => {
    const places = (j.locations || [])
      .map((l) => (typeof l === "string" ? l : [l.city, l.country].filter(Boolean).join(", ")))
      .filter(Boolean);

    // Turn the structured flags into text the eligibility scorer understands.
    const bits = [];
    if (j.remote) bits.push("Remote");
    if (places.length) bits.push(places.join(" · "));
    if (j.relocation_paid) bits.push("Relocation paid");

    return {
      id: `landing-${j.id}`,
      source: "Landing.jobs",
      title: j.title,
      company: j.company_name || j.company?.name || "Unknown",
      url: j.url,
      locationText: bits.join(" · ") || "Not stated",
      salary:
        j.gross_salary_low && j.gross_salary_high
          ? `${j.currency_code || ""}${j.gross_salary_low}-${j.gross_salary_high}`.trim()
          : null,
      tags: (j.tags || []).map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean).slice(0, 5),
      postedAt: Date.parse(j.published_at || j.created_at),
      description: [j.role_description, j.main_requirements, j.nice_to_have, j.perks]
        .filter(Boolean)
        .join("\n"),
    };
  });
}

export async function fetchLandingJobs() {
  const results = await Promise.allSettled(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i + 1))
  );
  const jobs = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!jobs.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
  return jobs;
}
