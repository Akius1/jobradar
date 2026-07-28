// Tiny JSON-file persistence: good enough for a personal tool, zero native deps.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { friction } from "./apply.js";

// Configurable so a deployment can point it at a mounted volume. Without a
// persistent path the 30-day archive resets on every restart.
const DATA_DIR =
  process.env.DATA_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const DATA_FILE = path.join(DATA_DIR, "jobs.json");

// Retain a month; the UI narrows to 2h/6h/12h/24h/2d/1w/1m at query time.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Bump whenever the shape or scoring of a stored job changes. Records written
 * by an older build keep their old verdicts forever otherwise, since a job is
 * only re-scored when it is re-fetched. Mismatched files are discarded and the
 * next sweep rebuilds them.
 */
const SCHEMA_VERSION = 2;

const empty = () => ({ version: SCHEMA_VERSION, jobs: [], lastRefresh: null, sourceStatus: {} });
let state = empty();

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (parsed.version !== SCHEMA_VERSION) {
      console.log(
        `Store schema ${parsed.version ?? "none"} != ${SCHEMA_VERSION}, discarding cache.`
      );
      return;
    }
    state = parsed;
  } catch {
    /* first run, keep defaults */
  }
}
load();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  state.version = SCHEMA_VERSION;
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

export function getState() {
  return state;
}

export function getJobs() {
  const cutoff = Date.now() - MAX_AGE_MS;
  return state.jobs.filter((j) => j.postedAt >= cutoff);
}

/**
 * Merge a fresh batch: dedupe by (company+title), drop stale jobs.
 *
 * When the same role arrives from several sources we keep the one that is
 * cheapest to apply through. Roughly half of the WeWorkRemotely postings are
 * from companies that also list on a free source, and WWR charges a
 * subscription to reach its apply button, so preferring the low-friction copy
 * silently removes most of the paywall problem.
 */
export function mergeJobs(incoming, sourceStatus) {
  const cutoff = Date.now() - MAX_AGE_MS;
  const byKey = new Map();
  const keyOf = (j) => `${j.company}::${j.title}`.toLowerCase();

  for (const j of state.jobs) {
    if (j.postedAt >= cutoff) byKey.set(keyOf(j), j);
  }
  let added = 0;
  let upgraded = 0;
  for (const j of incoming) {
    if (j.postedAt < cutoff) continue;
    const key = keyOf(j);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, j);
      added++;
      continue;
    }

    // Always retain the earliest sighting so "posted x ago" stays honest,
    // regardless of which copy wins on friction.
    const postedAt = Math.min(existing.postedAt, j.postedAt);
    const better = friction(j.source) < friction(existing.source);
    if (better) upgraded++;

    byKey.set(key, better ? { ...j, postedAt } : { ...existing, postedAt });
  }
  state.jobs = [...byKey.values()];
  state.lastRefresh = Date.now();
  state.sourceStatus = sourceStatus;
  persist();
  return { added, upgraded, total: state.jobs.length };
}
