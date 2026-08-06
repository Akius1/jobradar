// Hacker News "Ask HN: Who is hiring?" (monthly thread).
//
// These are posted directly by founders and engineering leads rather than
// recruiters, and a large share never appear on any job board. Each top-level
// comment is one role, conventionally formatted as:
//   Company | Role | Location | REMOTE | salary | url
//
// Comment bodies frequently include an application address the poster has
// published themselves, which the contact extractor picks up downstream.

// search_by_date, not search: relevance ranking surfaces the 2016 and 2017
// threads, which are entirely outside any freshness window. Scoping to the
// official whoishiring account avoids copycat threads too.
const SEARCH =
  "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6";

async function latestThreads() {
  const res = await fetch(SEARCH, { headers: { "User-Agent": "JobRadar/1.0" } });
  if (!res.ok) throw new Error(`HN search HTTP ${res.status}`);
  const data = await res.json();
  // "Who wants to be hired" is the inverse thread (candidates, not roles).
  return (data.hits || [])
    .filter((h) => /who is hiring/i.test(h.title || ""))
    .sort((a, b) => b.created_at_i - a.created_at_i)
    .slice(0, 2) // current month plus the previous, for early-month coverage
    .map((h) => h.objectID);
}

async function threadComments(id) {
  const res = await fetch(`https://hn.algolia.com/api/v1/items/${id}`, {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.children || []).filter((c) => c.text && !c.deleted);
}

// Posters use the pipe convention but not a fixed field order, so classify each
// segment by what it contains rather than trusting its position.
const ROLE_RX =
  /\b(engineer|engineering|developer|dev\b|programmer|architect|scientist|designer|analyst|devops|sre|full[\s-]?stack|front[\s-]?end|back[\s-]?end|mobile|ios|android|data|ml|ai|security|qa|manager|lead|head of|director|cto|intern|founding)\b/i;
const SALARY_RX = /\$|\b\d{2,3}\s*k\b|\bequity\b|\bsalary\b|\bcompensation\b/i;
const LOCATION_RX =
  /\b(remote|onsite|on-site|hybrid|worldwide|anywhere|relocation|visa|[A-Z]{2,3}\b|USA|UK|EU)\b|,\s*[A-Z]/;
const URL_RX = /https?:\/\//i;

// A real location field is short. Posters who drop a pipe leave the entire ad
// body in that slot, and LOCATION_RX matches "remote" four hundred characters
// in, so whole paragraphs were reaching the UI as the location.
const MAX_LOCATION = 60;

function tidyLocation(raw) {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_LOCATION) return s;

  // Where a location does precede body copy it nearly always ends at a closing
  // bracket or the first sentence break. Anything still long after that is
  // prose, and "Not stated" is more honest than a paragraph.
  const lead = s.split(/(?<=\))\s|\.\s|\s{2,}|•/)[0].trim();
  return lead && lead.length <= MAX_LOCATION ? lead : null;
}

/** Split the header row into company, role, location and salary. */
function classifyFields(parts) {
  const [company, ...rest] = parts;
  const used = new Set();

  const take = (rx, extra = () => true) => {
    const hit = rest.find((p, i) => !used.has(i) && rx.test(p) && extra(p));
    if (hit) used.add(rest.indexOf(hit));
    return hit || null;
  };

  // Order matters: salary and URLs are the least ambiguous, claim them first.
  const salary = take(SALARY_RX, (p) => !ROLE_RX.test(p));
  take(URL_RX);
  const title = take(ROLE_RX);
  const location = tidyLocation(take(LOCATION_RX));

  return { company, title, location, salary };
}

/** First line of a posting, split on the conventional pipe separator. */
function parseHeader(text) {
  const plain = text
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  const firstLine = plain.split("\n")[0].trim();
  const parts = firstLine.split("|").map((p) => p.trim()).filter(Boolean);
  return { plain, parts };
}

export async function fetchHackerNews() {
  const threads = await latestThreads();
  if (!threads.length) throw new Error("no Who is hiring thread found");

  const batches = await Promise.allSettled(threads.map(threadComments));
  const comments = batches.flatMap((b) => (b.status === "fulfilled" ? b.value : []));

  return comments
    .map((c) => {
      const { plain, parts } = parseHeader(c.text);
      if (parts.length < 2) return null;

      const { company, title, location, salary } = classifyFields(parts);
      // Without a recognisable role in the header there is nothing to classify.
      if (!title) return null;

      return {
        id: `hn-${c.id}`,
        source: "HackerNews",
        title: title.slice(0, 120),
        company: company.slice(0, 60),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        locationText: location || "Not stated",
        salary: salary || null,
        tags: ["hacker news"],
        postedAt: (c.created_at_i || 0) * 1000,
        description: plain,
      };
    })
    .filter(Boolean);
}
