// Delon Jobs (https://jobs.delon.ng), a Nigerian job board.
//
// Worth having for the obvious reason: this board is written for the people
// JobRadar is written for. A Lagos role posted here is Africa-eligible by
// construction, where every other source in the list has to be argued down from
// "worldwide" to "actually reachable".
//
// There is no API and no feed. robots.txt is "Disallow:" with nothing after
// it, an explicit allow-all, so polite crawling is sanctioned rather than
// merely unpunished. We keep to that: an identifying User-Agent, a couple of
// requests in flight at most, a hard cap per sweep, and no attempt to reach
// anything the site does not link publicly.
//
// The site renders exactly twelve results per query and has no pagination at
// all, so breadth comes from asking its own search a set of role terms and
// taking the union. Twelve queries reach 78 distinct postings, 63 of them
// technical, which is most of what the board carries.

import { pooledMap } from "../pool.js";

const ORIGIN = "https://jobs.delon.ng";
const UA = {
  "User-Agent": "JobRadar/1.0 (+https://github.com/Akius1/jobradar)",
};

// The site is slow and drops connections under load, so these are generous.
const TIMEOUT_MS = 20000;
const CONCURRENCY = 2;

// Detail pages are one request each, and only they carry the employer and the
// closing date. The union of the queries below lands around 71 postings, so
// this clears the whole board with room to spare rather than truncating it;
// it is a cap against the board growing unexpectedly, not a sampling rate.
const MAX_DETAILS = 90;

// Mirrors the store's archive window. Kept as its own constant rather than
// imported, so this source stays free of the store and remains a pure fetch.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Role terms, not a crawl. Each returns up to twelve; the union is the corpus.
const QUERIES = [
  "engineer", "developer", "software", "backend", "frontend", "fullstack",
  "data", "devops", "qa", "architect", "programmer", "it",
];

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The markup carries no stable classes for the fields we want, but it does lay
 * them out as label-then-value in document order. Flattening to a list of text
 * runs and reading the token after each label survives restyling, where a
 * selector chain would not.
 */
function textRuns(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((s) => s.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const after = (runs, label) => {
  const i = runs.findIndex((r) => r.toLowerCase() === label.toLowerCase());
  return i >= 0 ? runs[i + 1] || null : null;
};

/**
 * "Published 21 hours ago" → epoch ms, read from the run-up to a card's link.
 *
 * Takes the *last* match in the window rather than the first. Cards sit
 * adjacent in the markup with no boundary we can anchor on, so a window wide
 * enough to always contain this card's date also reaches back into the
 * previous one — and matching first hands every posting its neighbour's date.
 */
function parseAgo(text, now = Date.now()) {
  const all = [...(text || "").matchAll(/(\d+)\s*(minute|hour|day|week|month)s?\s*ago/gi)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  const unit = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 };
  return now - Number(m[1]) * unit[m[2].toLowerCase()];
}

/** "11 Sep, 2026" → epoch ms, or null when the site leaves it blank. */
function parseDeadline(text) {
  if (!text) return null;
  const t = Date.parse(String(text).replace(",", ""));
  return Number.isFinite(t) ? t : null;
}

/** Slugs linked from one search result page. */
function slugsIn(html) {
  return [
    ...new Set(
      [...html.matchAll(/jobs\.delon\.ng\/jobs\/([a-z0-9-]+)/g)].map((m) => m[1])
    ),
  ];
}

/**
 * A posting. Returns null rather than a half-record when the page does not
 * parse: every path on this site answers 200 with the site chrome, so a
 * missing title is the only reliable way to tell a real page from a soft 404.
 */
function parseDetail(html, slug) {
  const runs = textRuns(html);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = h1 ? h1[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
  if (!title) return null;

  // Between the heading and the first labelled field sits "company | location".
  // Anchor on "Salary" and walk back to the nearest heading before it: the
  // title also appears in the page <title> and again under "Similar Jobs", and
  // searching forward from the wrong one finds no fields at all.
  const salaryIdx = runs.findIndex((r) => /^salary$/i.test(r));
  const titleIdx = salaryIdx > 0 ? runs.lastIndexOf(title, salaryIdx - 1) : -1;
  const between = titleIdx >= 0 ? runs.slice(titleIdx + 1, salaryIdx) : [];

  // Either side of the pipe can be blank: the board lists many roles on behalf
  // of undisclosed clients, and a Lagos posting often omits the city.
  const parts = between.join(" ").split("|").map((s) => s.replace(/(^[\s,]+|[\s,]+$)/g, "").trim());
  const company = parts[0] || "";
  const locationText = parts[1] || "";

  const salary = after(runs, "Salary");
  const jobType = after(runs, "Job Type");
  const deadline = parseDeadline(after(runs, "Deadline"));

  const descStart = runs.findIndex((r) => /^job description$/i.test(r));
  const descEnd = runs.findIndex((r) => /^(login to apply|share this job|similar jobs)$/i.test(r));
  const description =
    descStart >= 0
      ? runs.slice(descStart + 1, descEnd > descStart ? descEnd : undefined).join("\n")
      : "";

  return {
    id: `delon-${slug}`,
    source: "DelonJobs",
    title,
    // Roughly three in four postings here are placed for a client the board
    // does not name. Falling through to "Unknown" would read as a parse
    // failure; saying who you actually apply through is both true and useful,
    // and keeps these visibly distinct from postings by the employer direct.
    company: company && !/^delon/i.test(company) ? company : "Via DelonJobs",
    url: `${ORIGIN}/jobs/${slug}`,
    // A Nigerian board naming no city almost always means Nigeria, and saying
    // so is what makes these roles read as reachable rather than "unstated".
    // But not when the posting advertises itself as remote: one of these is a
    // fully remote role requiring US-hours overlap, and calling it Nigerian
    // would grade it eligible on a location it never claimed.
    locationText:
      locationText ||
      (/\bremote\b/i.test(`${title} ${description}`) ? "Remote" : "Nigeria"),
    salary: salary && !/^n\/?a$/i.test(salary) ? salary : null,
    tags: [jobType, "nigeria"].filter(Boolean),
    postedAt: null, // filled from the listing card, which is where the date lives
    expiresAt: deadline,
    description,
  };
}

export async function fetchDelon() {
  // Phase one: ask the site's own search for each role term and union the hits.
  const pages = await pooledMap(QUERIES, (q) =>
    get(`${ORIGIN}/search?job_title=${encodeURIComponent(q)}`), CONCURRENCY, 1);

  const html = pages.filter((p) => p.ok && p.value).map((p) => p.value);
  if (!html.length) throw new Error("DelonJobs: no search page responded");

  // Publication dates only appear on the cards, so pair each slug with the
  // freshest "published N ago" seen next to it across the result pages.
  const postedBySlug = new Map();
  const slugs = new Set();
  for (const page of html) {
    for (const slug of slugsIn(page)) {
      slugs.add(slug);
      const at = page.indexOf(`/jobs/${slug}`);
      const posted = parseAgo(page.slice(Math.max(0, at - 1200), at));
      if (posted && (!postedBySlug.has(slug) || posted > postedBySlug.get(slug))) {
        postedBySlug.set(slug, posted);
      }
    }
  }

  // Phase two: the employer, location and closing date are only on the detail
  // page, one request each.
  //
  // Most of this board is old. Three quarters of what the search returns is
  // past the archive's 30-day window and would be discarded the moment it
  // arrived, so filtering on the date we already have from the card turns ~60
  // detail fetches into ~15. That matters more here than anywhere else in the
  // sweep: this is a small site being polled every half hour, and the cheapest
  // request is the one we work out we never needed.
  //
  // A card whose date would not parse is kept rather than assumed stale: an
  // unreadable date is not evidence of anything.
  const freshEnough = Date.now() - RETENTION_MS;
  const ordered = [...slugs]
    .filter((s) => !postedBySlug.has(s) || postedBySlug.get(s) >= freshEnough)
    .sort((a, b) => (postedBySlug.get(b) || 0) - (postedBySlug.get(a) || 0))
    .slice(0, MAX_DETAILS);

  const details = await pooledMap(
    ordered,
    async (slug) => {
      const page = await get(`${ORIGIN}/jobs/${slug}`);
      return page ? parseDetail(page, slug) : null;
    },
    CONCURRENCY,
    1
  );

  const jobs = details
    .filter((d) => d.ok && d.value)
    .map((d) => d.value)
    .map((j) => ({
      ...j,
      // No date anywhere is not a reason to drop a real posting, but it must
      // not read as brand new either, or it would top every freshness window.
      postedAt: postedBySlug.get(j.id.replace(/^delon-/, "")) || Date.now() - 7 * 864e5,
    }));

  if (!jobs.length) throw new Error("DelonJobs: search returned nothing parseable");
  return jobs;
}
