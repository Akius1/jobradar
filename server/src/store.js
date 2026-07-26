// Tiny JSON-file persistence: good enough for a personal tool, zero native deps.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
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

/** Merge a fresh batch: dedupe by id and by (company+title), drop stale jobs. */
export function mergeJobs(incoming, sourceStatus) {
  const cutoff = Date.now() - MAX_AGE_MS;
  const byKey = new Map();
  const keyOf = (j) => `${j.company}::${j.title}`.toLowerCase();

  for (const j of state.jobs) {
    if (j.postedAt >= cutoff) byKey.set(keyOf(j), j);
  }
  let added = 0;
  for (const j of incoming) {
    if (j.postedAt < cutoff) continue;
    const key = keyOf(j);
    const existing = byKey.get(key);
    // Keep the earliest sighting so "posted x ago" stays honest.
    if (!existing || j.postedAt < existing.postedAt) {
      if (!existing) added++;
      byKey.set(key, existing ? { ...j, postedAt: existing.postedAt } : j);
    }
  }
  state.jobs = [...byKey.values()];
  state.lastRefresh = Date.now();
  state.sourceStatus = sourceStatus;
  persist();
  return { added, total: state.jobs.length };
}
