// Filtering and facet counting, as pure functions over a job array.
//
// Extracted from the Express app so the same logic serves both the local dev
// server and the Vercel functions. Nothing here touches the store or the
// filesystem: callers pass the jobs in, which is what makes it usable in a
// serverless handler that loads its data over the network.

import { ROLE_LABELS, CATEGORIES, categoryOf } from "./filter.js";

/** Selectable freshness windows, in hours. */
export const WINDOWS = [
  { key: "2h", label: "2 hours", hours: 2 },
  { key: "6h", label: "6 hours", hours: 6 },
  { key: "12h", label: "12 hours", hours: 12 },
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "48h", label: "2 days", hours: 48 },
  { key: "7d", label: "1 week", hours: 24 * 7 },
  { key: "30d", label: "1 month", hours: 24 * 30 },
];
export const DEFAULT_WINDOW = "48h";

export function windowCutoff(key) {
  const w = WINDOWS.find((x) => x.key === key) || WINDOWS.find((x) => x.key === DEFAULT_WINDOW);
  return Date.now() - w.hours * 60 * 60 * 1000;
}

/** Comma-separated facet value into a Set, or null when the facet is unset. */
export function parseFacet(value) {
  if (!value || value === "all") return null;
  const parts = String(value).split(",").filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

/** Apply every active facet. Multi-select is OR within a group, AND across groups. */
export function applyFacets(jobs, query) {
  const roles = parseFacet(query.role);
  if (roles) jobs = jobs.filter((j) => roles.has(j.role));

  const elig = parseFacet(query.eligibility);
  if (elig) {
    jobs = jobs.filter(
      (j) => elig.has(j.eligibility) || (elig.has("relocation") && j.relocation)
    );
  }

  const sources = parseFacet(query.source);
  if (sources) jobs = jobs.filter((j) => sources.has(j.source));

  const q = query.q;
  if (q) {
    // Every word has to land somewhere, but not all in the same field and not in
    // the order typed: "senior react" should still find "React Engineer, Senior".
    // The discipline and location are searchable too, so "devops" finds a role
    // titled "SRE" and "nigeria" finds one posted for Lagos.
    const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    jobs = jobs.filter((j) => {
      const haystack = [
        j.title,
        j.company,
        j.role,
        ROLE_LABELS.find((r) => r.key === j.role)?.label,
        j.locationText,
        ...(j.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }

  return jobs;
}

/**
 * Facet counts over the selected time window only, never over the other active
 * facets, so a chip's number does not move as you toggle its siblings.
 */
export function buildMeta(all, withinKey, extra = {}) {
  const windowed = all.filter((j) => j.postedAt >= windowCutoff(withinKey));

  const counts = {};
  const eligibility = { eligible: 0, maybe: 0, restricted: 0, relocation: 0 };
  const sources = {};
  for (const j of windowed) {
    counts[j.role] = (counts[j.role] || 0) + 1;
    eligibility[j.eligibility] = (eligibility[j.eligibility] || 0) + 1;
    if (j.relocation) eligibility.relocation += 1;
    sources[j.source] = (sources[j.source] || 0) + 1;
  }

  const now = Date.now();
  const windows = WINDOWS.map((w) => ({
    ...w,
    count: all.filter((j) => j.postedAt >= now - w.hours * 60 * 60 * 1000).length,
  }));

  const roles = ROLE_LABELS.map((r) => ({ ...r, count: counts[r.key] || 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    total: windowed.length,
    retained: all.length,
    within: withinKey || DEFAULT_WINDOW,
    windows,
    roles,
    eligibility,
    sources,
    ...extra,
  };
}
