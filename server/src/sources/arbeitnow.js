// Arbeitnow: https://www.arbeitnow.com/api/job-board-api (free, no key)
// Includes visa-sponsorship flags, useful for the relocation angle.
export async function fetchArbeitnow() {
  const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (!res.ok) throw new Error(`Arbeitnow HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((j) => {
    const visa = (j.tags || []).some((t) => /visa/i.test(t));
    return {
      id: `arbeitnow-${j.slug}`,
      source: "Arbeitnow",
      title: j.title,
      company: j.company_name,
      url: j.url,
      locationText: [j.location, j.remote ? "Remote" : null, visa ? "Visa sponsorship" : null]
        .filter(Boolean)
        .join(" · "),
      salary: null,
      tags: [...(j.tags || []), ...(j.job_types || [])],
      postedAt: j.created_at * 1000,
      description: (j.description || "").slice(0, 2000).replace(/<[^>]+>/g, " "),
    };
  });
}
