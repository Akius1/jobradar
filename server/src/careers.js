// Finds where a company actually accepts applications.
//
// The first version of this guessed "/careers" and called it done, which 404s
// on any employer that uses /jobs, /join-us, /vacancies or anything else. The
// fix is to stop guessing: fetch the company's own homepage and read the links
// it publishes, because a site that has a careers page always links to it.
//
// Better still, those links often point at individual postings, so we can match
// the job title and land on the actual application form rather than an index.

import { titleSimilarity } from "./apply.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; JobRadar/1.0)" };
// Kept under the serverless discovery budget so one slow host cannot
// consume the entire request on its own.
const TIMEOUT_MS = Number(process.env.CAREERS_TIMEOUT_MS) || 5000;

// Paths worth trying when a homepage yields nothing useful.
const FALLBACK_PATHS = [
  "/jobs", "/careers", "/join-us", "/work-with-us", "/vacancies",
  "/opportunities", "/hiring", "/company/careers", "/about/careers", "/en/careers",
];

const LINK_RX = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
const CAREERS_HINT = /career|job|hiring|join[\s-]?us|vacanc|opportunit|position|work[\s-]with/i;

// Cache per origin. Discovery costs a couple of network round trips and the
// answer rarely changes, so repeat views of the same employer are free.
const cache = new Map();
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CACHE_MAX = 500;

// We only ever inspect the first stretch of a page (links, title, 404 text), so
// reading whole bodies is pure waste. Some marketing homepages run to several MB
// and, multiplied across concurrent lookups, that was enough to kill the process.
const MAX_BYTES = 512 * 1024;

/** Read a response but stop once we have as much as we could possibly need. */
async function readCapped(res) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (out.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } catch {
    /* truncated reads are fine, we only need the head */
  } finally {
    reader.cancel().catch(() => {});
  }
  return out;
}

/**
 * Cap how many lookups run at once. A single detail view can fan out to a
 * homepage fetch, five domain guesses and ten path probes; several views at
 * once multiplied that into hundreds of parallel requests and exhausted the
 * process. Extra callers queue here instead.
 */
const MAX_CONCURRENT = 3;
let active = 0;
const waiting = [];

async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) {
    await new Promise((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: UA,
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await readCapped(res);
    return { ok: res.ok, status: res.status, url: res.url, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plenty of sites answer 200 for a missing page and render "not found" in the
 * body, so status alone is not enough to trust a URL.
 */
function isRealPage(res) {
  if (!res || !res.ok) return false;
  const head = res.body.slice(0, 5000);
  if (/page not found|404 error|doesn't exist|does not exist/i.test(head)) return false;
  return res.body.length > 1500;
}

/**
 * A resolved URL is only useful if it still points somewhere specific. Links
 * are checked before they are followed, but a site can redirect /careers back
 * to its homepage, so the destination has to be re-checked after the redirect.
 */
function hasPath(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") !== "";
  } catch {
    return false;
  }
}

function absolute(href, origin) {
  try {
    return new URL(href, origin).toString();
  } catch {
    return null;
  }
}

/** Pull every career-ish link the homepage publishes. */
function harvestLinks(html, origin) {
  const out = [];
  for (const m of html.matchAll(LINK_RX)) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!CAREERS_HINT.test(`${href} ${text}`)) continue;

    const url = absolute(href, origin);
    if (!url || !url.startsWith("http")) continue;
    try {
      const parsed = new URL(url);
      // Stay on the employer's own domain; offsite links are usually aggregators.
      if (parsed.hostname !== new URL(origin).hostname) continue;
      // A link back to the homepage is never the careers page, even when its
      // anchor text says "Careers". Without this we hand back the root URL and
      // claim it is where you apply.
      if (parsed.pathname.replace(/\/+$/, "") === "") continue;
    } catch {
      continue;
    }
    out.push({ url, text });
  }
  return out;
}

/**
 * Some postings name the employer but never link them, which leaves nothing to
 * read. Derive a likely domain from the company name and confirm the site
 * actually belongs to them before using it, so we never send someone to a
 * squatter or an unrelated company that happens to own the obvious domain.
 */
export async function guessOrigin(company = "") {
  return withSlot(() => guessOriginInner(company));
}

async function guessOriginInner(company) {
  const slug = String(company).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug.length < 3 || slug.length > 30) return null;

  const candidates = [
    `https://${slug}.com`,
    `https://www.${slug}.com`,
    `https://${slug}.io`,
    `https://${slug}.ai`,
    `https://${slug}.co`,
  ];

  const checked = await Promise.all(
    candidates.map(async (url) => {
      const res = await get(url);
      if (!isRealPage(res)) return null;

      // The page must actually name the company. Comparing on alphanumerics
      // only lets "LaunchDarkly" match "Launch Darkly" in a title.
      const head = res.body.slice(0, 20000).toLowerCase().replace(/[^a-z0-9]/g, "");
      return head.includes(slug) ? new URL(res.url).origin : null;
    })
  );

  return checked.find(Boolean) || null;
}

/**
 * Discover the best application URL for a company.
 *
 * @param origin    the employer's site, e.g. "https://onthegosystems.com"
 * @param jobTitle  used to prefer a link pointing at this specific posting
 * @returns {url, kind, label} | null   kind: "exact-role" | "careers-index"
 */
export async function discoverApplyUrl(origin, jobTitle = "") {
  const key = `${origin}::${jobTitle}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

  const value = await withSlot(() => resolve(origin, jobTitle));

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function resolve(origin, jobTitle) {
  const home = await get(origin);

  if (isRealPage(home)) {
    const links = harvestLinks(home.body, origin);

    // A link whose slug or text matches the posting title beats any index page,
    // because it drops the applicant straight onto the role.
    let best = null;
    for (const link of links) {
      const slug = decodeURIComponent(link.url)
        .replace(/[?#].*$/, "")
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/[-_]+/g, " ");
      const score = Math.max(
        titleSimilarity(jobTitle, slug || ""),
        titleSimilarity(jobTitle, link.text)
      );
      if (score >= 0.7 && (!best || score > best.score)) best = { ...link, score };
    }

    if (best) {
      const verified = await get(best.url);
      if (isRealPage(verified) && hasPath(verified.url)) {
        return {
          url: verified.url,
          kind: "exact-role",
          label: "This exact role on the company site",
        };
      }
    }

    // Otherwise take the most index-like careers link the site advertises.
    const index = links.find((l) => /career|job|vacanc|position|opening/i.test(l.text)) || links[0];
    if (index) {
      const verified = await get(index.url);
      if (isRealPage(verified) && hasPath(verified.url)) {
        return {
          url: verified.url,
          kind: "careers-index",
          label: "Company careers page",
        };
      }
    }
  }

  // Homepage gave us nothing usable, so fall back to probing. Run these in
  // parallel: probing ten paths in sequence took six seconds on a site that had
  // no careers page at all, which is the worst case to be slowest on.
  const probes = await Promise.all(
    FALLBACK_PATHS.map(async (path) => {
      const url = absolute(path, origin);
      if (!url) return null;
      const res = await get(url);
      return isRealPage(res) && hasPath(res.url) ? res.url : null;
    })
  );

  // FALLBACK_PATHS is ordered by likelihood, so take the earliest that answered.
  const found = probes.find(Boolean);
  return found
    ? { url: found, kind: "careers-index", label: "Company careers page" }
    : null;
}
