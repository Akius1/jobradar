// One-shot sweep for CI. Runs every source once, writes the data files, exits.
//
// This is what replaces the always-on server: the work JobRadar actually does is
// a scheduled job, not a web service, so it runs in GitHub Actions instead of on
// a host that has to stay awake (and be paid for) between sweeps.
//
// Emits two files because they have very different read patterns:
//   list.json  slim, no descriptions, read on every list request
//   jobs.json  full records, only needed when someone opens a single role

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshAll } from "./fetcher.js";
import { getJobs, getState } from "./store.js";
import { isPaywalled } from "./apply.js";

const DATA_DIR =
  process.env.DATA_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

async function main() {
  const started = Date.now();
  const result = await refreshAll();

  const jobs = getJobs();
  const state = getState();

  // Slim list: strip descriptions, which are ~95% of the payload and are only
  // ever read on the detail screen.
  const list = jobs
    .map(({ description, ...rest }) => ({ ...rest, paywalled: isPaywalled(rest.source) }))
    .sort((a, b) => b.postedAt - a.postedAt);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "list.json"),
    JSON.stringify({
      generatedAt: Date.now(),
      lastRefresh: state.lastRefresh,
      sourceStatus: state.sourceStatus,
      jobs: list,
    })
  );

  const sizeOf = (f) => {
    try {
      return Math.round(fs.statSync(path.join(DATA_DIR, f)).size / 1024) + "KB";
    } catch {
      return "missing";
    }
  };

  console.log(
    `Sweep finished in ${Math.round((Date.now() - started) / 1000)}s: ` +
      `${result.added} new, ${result.total} live`
  );
  console.log(`  list.json ${sizeOf("list.json")} | jobs.json ${sizeOf("jobs.json")}`);

  const failed = Object.entries(state.sourceStatus || {}).filter(([, s]) => !s.ok);
  if (failed.length) {
    console.log(`  ${failed.length} source(s) failed: ${failed.map(([n]) => n).join(", ")}`);
  }

  // A sweep that produced nothing means every source failed. Fail the run so it
  // shows up as a red build rather than silently publishing an empty board.
  if (!jobs.length) {
    console.error("No jobs after sweep, refusing to publish empty data.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Sweep failed:", err);
  process.exit(1);
});
