import { loadFull, loadCompanies, setCacheHeaders } from "./_data.js";
import { buildPrep } from "../server/src/prep.js";
import { findBoardIn } from "../server/src/discovery.js";
import {
  isPaywalled,
  friction,
  companyKey,
  resolveApplyRoutes,
  employerOrigin,
} from "../server/src/apply.js";
import { discoverApplyUrl, guessOrigin } from "../server/src/careers.js";

// Serverless invocations are killed at the platform limit, so live discovery
// gets its own budget. If the employer's site is slow we return the routes we
// already have rather than letting the whole request die: a missing "apply
// direct" link is a smaller loss than a broken detail page.
const DISCOVERY_BUDGET_MS = 7000;

const withDeadline = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export default async function handler(req, res) {
  try {
    const data = await loadFull();
    const jobs = data.jobs || [];
    const job = jobs.find((j) => j.id === req.query.id);

    if (!job) {
      return res.status(404).json({ error: "This role has aged out of the archive." });
    }

    const related = jobs
      .filter((j) => j.id !== job.id && j.role === job.role && j.eligibility === job.eligibility)
      .sort((a, b) => b.postedAt - a.postedAt)
      .slice(0, 4);

    const paywalled = isPaywalled(job.source);
    let applyRoutes = null;

    if (paywalled) {
      const freeAlt = jobs
        .filter(
          (j) =>
            j.id !== job.id &&
            companyKey(j.company) === companyKey(job.company) &&
            friction(j.source) < friction(job.source)
        )
        .sort((a, b) => friction(a.source) - friction(b.source))[0];

      const discovered = await withDeadline(
        (async () => {
          const origin = employerOrigin(job) || (await guessOrigin(job.company));
          return origin ? discoverApplyUrl(origin, job.title) : null;
        })(),
        DISCOVERY_BUDGET_MS
      );

      const registry = await loadCompanies();
      applyRoutes = resolveApplyRoutes(
        job,
        findBoardIn(registry, job.company),
        freeAlt,
        discovered
      );
    }

    // Short cache: the discovered link is stable, but a role can drop out of the
    // archive, and we do not want a stale 404 pinned in the CDN.
    setCacheHeaders(res, 120);
    res.status(200).json({ job, prep: buildPrep(job), related, paywalled, applyRoutes });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
