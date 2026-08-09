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
 * Sources that hand back their complete current set on every sweep, so a role
 * that stops appearing has been filled or withdrawn rather than merely paged
 * out of view. For these, and only these, absence is evidence and the record
 * is dropped.
 *
 * The archive otherwise keeps a job for a month on the strength of its posting
 * date alone, which meant a filled role stayed on the board for weeks. That is
 * the worst kind of inaccuracy here: it costs someone an application.
 *
 * Everything else is a rolling feed of the newest N postings, where falling out
 * of the response means nothing at all. Greenhouse belongs in that group
 * despite being an employer board, because we cap detail fetches per sweep and
 * so never see its full set either.
 */
const AUTHORITATIVE = new Set(["Ashby", "Lever"]);

/**
 * Bump whenever the shape or scoring of a stored job changes. Records written
 * by an older build keep their old verdicts forever otherwise, since a job is
 * only re-scored when it is re-fetched. Mismatched files are discarded and the
 * next sweep rebuilds them.
 */
// 3: rewrote eligibility scoring and the role taxonomy. Without the bump the
// archive would keep serving verdicts from the old rules alongside the new
// ones, so the same location could read "worth a shot" or "region-locked"
// depending only on when it happened to be fetched.
// 4: titles are entity-decoded, junk company names rejected, and records carry
// expiresAt. Stored rows predate all three, so they would keep showing
// "Checkout &amp; Link" and never retire on their closing date.
// 5: taxonomy widened from software-only to every profession, so stored rows
// carry role keys that no longer mean the same thing.
const SCHEMA_VERSION = 5;

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

/** A posting the source has told us is over, whatever its posting date says. */
const isExpired = (j, now = Date.now()) => Boolean(j.expiresAt) && j.expiresAt < now;

export function getJobs() {
  const cutoff = Date.now() - MAX_AGE_MS;
  return state.jobs.filter((j) => j.postedAt >= cutoff && !isExpired(j));
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
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;
  const byKey = new Map();
  const keyOf = (j) => `${j.company}::${j.title}`.toLowerCase();

  // Which authoritative sources reported a complete set this sweep, and every
  // id they returned. A source that failed is skipped: an outage would
  // otherwise read as "every one of its roles closed at once" and wipe it from
  // the board.
  const liveIds = new Map();
  for (const source of AUTHORITATIVE) {
    if (sourceStatus?.[source]?.ok) liveIds.set(source, new Set());
  }
  for (const j of incoming) liveIds.get(j.source)?.add(j.id);

  let closed = 0;
  for (const j of state.jobs) {
    if (j.postedAt < cutoff) continue;
    if (isExpired(j, now)) {
      closed++;
      continue;
    }
    const live = liveIds.get(j.source);
    if (live && !live.has(j.id)) {
      closed++; // gone from a board we just read in full
      continue;
    }
    byKey.set(keyOf(j), j);
  }
  let added = 0;
  let upgraded = 0;
  for (const j of incoming) {
    if (j.postedAt < cutoff || isExpired(j, now)) continue;
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

  // The key above is company+title, which does not imply a unique id: boards
  // publish the same posting under slightly different company strings, so two
  // records can survive the merge carrying the same id. The client keys the list
  // on id, and React silently drops or doubles rows when keys collide. Collapse
  // on id as well, keeping whichever copy is cheapest to apply through.
  const byId = new Map();
  for (const j of byKey.values()) {
    const clash = byId.get(j.id);
    if (!clash) {
      byId.set(j.id, j);
      continue;
    }
    const postedAt = Math.min(clash.postedAt, j.postedAt);
    const better = friction(j.source) < friction(clash.source);
    byId.set(j.id, better ? { ...j, postedAt } : { ...clash, postedAt });
  }

  state.jobs = [...byId.values()];
  state.lastRefresh = now;
  state.sourceStatus = sourceStatus;
  persist();
  return { added, upgraded, closed, total: state.jobs.length };
}
