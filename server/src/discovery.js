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
const CAPS = { greenhouse: 220, lever: 160, ashby: 140, workable: 120, recruitee: 120 };

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
  return { greenhouse: [], lever: [], ashby: [], workable: [], recruitee: [], updatedAt: null };
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
