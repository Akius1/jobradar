// Which shard of the archive a job lives in.
//
// The archive is a rolling month of full postings, description bodies included,
// and it was one jobs.json. That file reached 99.9MB against GitHub's hard
// 100MB-per-file limit, so a sweep published or failed depending on how many
// roles happened to be live that half hour, and /api/job downloaded the entire
// month to answer for a single role.
//
// Splitting it means no single file grows without bound and the detail view
// fetches roughly a four-hundredth of what it used to. Both the sweep that
// writes the shards and the function that reads them import this, so the two
// can never disagree about where a record went.

export const SHARD_COUNT = 256;

/** FNV-1a. Ids are opaque strings from a dozen boards; nothing in them spreads evenly on its own. */
export function bucketOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % SHARD_COUNT;
}

/** Shard file name for a bucket index, e.g. 0 -> "00", 255 -> "ff". */
export const shardName = (i) => i.toString(16).padStart(2, "0");

/** Shard file name holding the record with this id. */
export const shardOf = (id) => shardName(bucketOf(id));
