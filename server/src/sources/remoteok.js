// RemoteOK: https://remoteok.com/api (free, no key; first array item is a legal notice)
export async function fetchRemoteOK() {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "JobRadar/1.0 (personal job aggregator)" },
  });
  if (!res.ok) throw new Error(`RemoteOK HTTP ${res.status}`);
  const data = await res.json();
  return data
    .filter((j) => j && j.id && j.position)
    .map((j) => ({
      id: `remoteok-${j.id}`,
      source: "RemoteOK",
      title: j.position,
      company: j.company,
      url: j.url || `https://remoteok.com/l/${j.id}`,
      locationText: j.location || "Remote",
      salary:
        j.salary_min && j.salary_max
          ? `$${Math.round(j.salary_min / 1000)}k-$${Math.round(j.salary_max / 1000)}k`
          : null,
      tags: j.tags,
      postedAt: j.epoch ? j.epoch * 1000 : Date.parse(j.date),
      description: (j.description || "").slice(0, 2000).replace(/<[^>]+>/g, " "),
    }));
}
