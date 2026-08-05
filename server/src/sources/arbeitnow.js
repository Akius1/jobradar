// Arbeitnow: https://www.arbeitnow.com/api/job-board-api (free, no key)
// Includes visa-sponsorship flags, useful for the relocation angle.

/**
 * The API is PHP-backed and serialises a list as a JSON object whenever its
 * keys are not a clean 0..n range, so `job_types` arrives as ["Full-time"] on
 * most rows and as {"1":"entry"} on others. Spreading the object form threw,
 * and because that happened inside .map it took the whole feed down rather than
 * the one row: several hundred postings lost to a single malformed field.
 */
function toList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  if (typeof value === "string" && value) return [value];
  return [];
}

export async function fetchArbeitnow() {
  const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (!res.ok) throw new Error(`Arbeitnow HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((j) => {
    const tags = toList(j.tags);
    const visa = tags.some((t) => /visa/i.test(t));
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
      tags: [...tags, ...toList(j.job_types)],
      postedAt: j.created_at * 1000,
      description: (j.description || "").slice(0, 2000).replace(/<[^>]+>/g, " "),
    };
  });
}
