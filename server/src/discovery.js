// Self-expanding company registry.
//
// Every sweep already pulls thousands of postings, and a large share of them
// link back to the employer's own applicant tracking system. Harvesting those
// tokens turns the aggregate feed into a discovery engine: a Brazilian startup
// mentioned once in a Hacker News thread becomes a board we poll directly from
// then on, along with every other role it posts.
//
// This is why the company list does not need to be curated by hand, and why
// coverage reaches places a hand-written list never would.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Shares DATA_DIR with the job store: on a deployment both must live on the
// mounted volume, or the registry falls back to its seed list on every restart
// and the compounding effect is lost.
const DATA_DIR =
  process.env.DATA_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = path.join(DATA_DIR, "companies.json");

// Token patterns for each ATS we can actually poll.
const PATTERNS = {
  greenhouse: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_]{2,40})/gi,
  lever: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9-]{2,40})/gi,
  ashby: /jobs\.ashbyhq\.com\/([a-z0-9._-]{2,40})/gi,
  workable: /(?:apply\.workable\.com|([a-z0-9-]{2,40})\.workable\.com)\/(?:j\/)?([a-z0-9-]{2,40})?/gi,
  recruitee: /([a-z0-9-]{2,40})\.recruitee\.com/gi,
};

// Words that appear in these URL positions but are not company tokens.
const NOT_A_TOKEN = new Set([
  "embed", "job", "jobs", "www", "api", "boards", "board", "apply", "careers",
  "job_board", "search", "static", "assets", "images", "s3", "cdn", "help",
  "support", "blog", "about", "privacy", "terms", "index", "en", "us",
]);

// Hard ceilings so a runaway feed cannot make each sweep take forever.
const CAPS = { greenhouse: 350, lever: 200, ashby: 300, workable: 150, recruitee: 150 };

// ---- Active discovery ----
//
// Harvesting links only finds a company that some *other* feed already talks
// about. A startup that posts nothing but its own Ashby board is invisible to
// it, however many roles it has open, because no aggregator ever prints the URL.
//
// So we also work the other way round: take a company name we have seen
// anywhere, turn it into the slug an ATS would use, and ask the ATS directly
// whether that board exists. Roughly two in five names resolve to a real board.
const PROBES = {
  ashby: {
    url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    hasPostings: (d) => (d.jobs || []).length > 0,
  },
  greenhouse: {
    // The board endpoint rather than its job list: it answers in a couple of KB
    // where a big board's postings run to hundreds, and existence is all we ask.
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}`,
    hasPostings: (d) => Boolean(d.name),
  },
  lever: {
    url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    hasPostings: (d) => Array.isArray(d) && d.length > 0,
  },
};

const PROBE_TIMEOUT_MS = 8000;

// Slugs already probed, kept so a name that resolved to nothing is never asked
// about twice. Without this every sweep would re-probe the same few hundred
// dead slugs forever, which is both slow and rude to the ATS.
const MAX_CHECKED = 8000;

/** Company name → the slug an ATS would most likely use for it. */
export function slugFor(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|b\.?v|s\.?a|ag|corp|corporation|co|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

let registry = load();

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { ...emptyRegistry(), ...parsed };
  } catch {
    return emptyRegistry();
  }
}

function emptyRegistry() {
  return {
    greenhouse: [],
    lever: [],
    ashby: [],
    workable: [],
    recruitee: [],
    checked: [],
    updatedAt: null,
  };
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  registry.updatedAt = Date.now();
  fs.writeFileSync(FILE, JSON.stringify(registry, null, 2));
}

/**
 * Scan a batch of raw postings for ATS links and remember any new company.
 * Returns a per-ATS count of tokens newly discovered in this batch.
 */
export function harvestTokens(jobs = []) {
  const found = {};

  for (const job of jobs) {
    const haystack = `${job.url || ""} ${job.description || ""}`;
    if (!haystack.includes(".")) continue;

    for (const [ats, rx] of Object.entries(PATTERNS)) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(haystack)) !== null) {
        // Some patterns capture in group 1, others in group 2.
        const token = (m[1] || m[2] || "").toLowerCase();
        if (!token || NOT_A_TOKEN.has(token) || token.length < 2) continue;
        if (registry[ats].includes(token)) continue;
        if (registry[ats].length >= CAPS[ats]) continue;

        registry[ats].push(token);
        found[ats] = (found[ats] || 0) + 1;
      }
    }
  }

  if (Object.keys(found).length) persist();
  return found;
}

async function probeOne(ats, token) {
  const { url, hasPostings } = PROBES[ats];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url(token), {
      headers: { "User-Agent": "JobRadar/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) return false;
    return hasPostings(await res.json());
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the ATSs directly whether these companies have boards, and remember the
 * ones that do. Only names never probed before are considered, so the cost of a
 * sweep falls to near zero once the backlog is worked through.
 *
 * A slug that resolves to a different company than the one it came from is not
 * a problem: it is still a real board with real postings, and the jobs are
 * attributed to whoever owns it, not to the name we started from.
 *
 * @param names   company names seen anywhere this sweep
 * @param budget  how many new slugs to probe, keeping sweep time bounded
 * @param mapper  concurrency-limited runner, injected to avoid a circular import
 */
export async function probeCompanies(names = [], budget = 150, mapper) {
  const checked = new Set(registry.checked || []);
  const known = new Set(
    Object.keys(PROBES).flatMap((ats) => registry[ats] || [])
  );

  const candidates = [];
  const seen = new Set();
  for (const name of names) {
    const slug = slugFor(name);
    if (slug.length < 3 || slug.length > 30) continue;
    if (checked.has(slug) || known.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    candidates.push(slug);
    if (candidates.length >= budget) break;
  }
  if (!candidates.length) return {};

  const found = {};
  const results = await mapper(
    candidates,
    async (slug) => {
      const hits = [];
      for (const ats of Object.keys(PROBES)) {
        if ((registry[ats] || []).length >= CAPS[ats]) continue;
        if (await probeOne(ats, slug)) hits.push(ats);
      }
      return { slug, hits };
    },
    6,
    0 // a slug that times out is simply left for a later sweep
  );

  for (const r of results) {
    if (!r.ok) continue;
    const { slug, hits } = r.value;
    checked.add(slug);
    for (const ats of hits) {
      if (registry[ats].includes(slug) || registry[ats].length >= CAPS[ats]) continue;
      registry[ats].push(slug);
      found[ats] = (found[ats] || 0) + 1;
    }
  }

  // Oldest entries fall off first: if a slug ages out and gets re-probed years
  // later that is a trivial cost, and it lets a company that has since adopted
  // an ATS be picked up rather than being written off permanently.
  registry.checked = [...checked].slice(-MAX_CHECKED);
  persist();
  return found;
}

/** Seed list plus everything discovered so far, deduped and capped. */
export function tokensFor(ats, seed = []) {
  const merged = [...new Set([...seed, ...(registry[ats] || [])])];
  return merged.slice(0, CAPS[ats] || 100);
}

/**
 * Find a discovered board whose token matches a company name, so a paywalled
 * posting can be redirected to that employer's own free application form.
 * Compares on alphanumerics only: "Lemon.io" and "lemonio" are the same board.
 */
export function findBoardFor(companyName = "") {
  return findBoardIn(registry, companyName);
}

/**
 * Same match against a registry supplied by the caller.
 *
 * The serverless functions have no local data directory, so they load the
 * registry over the network and pass it in. Without this the file-backed
 * lookup silently returns nothing there and every employer-board route
 * disappears in production.
 */
export function findBoardIn(reg, companyName = "") {
  const key = String(companyName).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key.length < 3 || !reg) return null;

  for (const ats of ["greenhouse", "lever", "ashby", "recruitee", "workable"]) {
    for (const token of reg[ats] || []) {
      if (String(token).toLowerCase().replace(/[^a-z0-9]/g, "") === key) {
        return { ats, token };
      }
    }
  }
  return null;
}

/** Registry sizes, surfaced in /api/meta so growth is visible. */
export function discoveryStats() {
  return {
    greenhouse: registry.greenhouse.length,
    lever: registry.lever.length,
    ashby: registry.ashby.length,
    workable: registry.workable.length,
    recruitee: registry.recruitee.length,
    probed: (registry.checked || []).length,
    updatedAt: registry.updatedAt,
  };
}

/** Drop a token that has stopped responding, so dead boards do not accumulate. */
export function forgetToken(ats, token) {
  const i = (registry[ats] || []).indexOf(token);
  if (i >= 0) {
    registry[ats].splice(i, 1);
    persist();
  }
}
