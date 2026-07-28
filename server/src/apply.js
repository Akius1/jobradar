// Routing around aggregator paywalls.
//
// We Work Remotely puts its apply button behind a $14.95/month subscription.
// That is their business and we do not try to defeat it. We do not need to:
// the employer paid WWR to advertise the role, and the same role is almost
// always sitting on the company's own careers page with a free public form.
// Applying direct is better anyway, since it skips the middleman entirely.
//
// So instead of scraping paid content, we rank every route by how much friction
// stands between Andrew and a human, and surface the cheapest one.

/**
 * Lower is better. Used both to pick a winner when the same role arrives from
 * several sources, and to warn in the UI when the only route is a paid one.
 */
export const SOURCE_FRICTION = {
  // Straight to the employer's own board. No account, no middleman.
  Greenhouse: 0,
  Lever: 0,
  Ashby: 0,
  Recruitee: 0,
  // Free aggregators that link out to the employer.
  HackerNews: 1,
  Remotive: 1,
  RemoteOK: 1,
  Himalayas: 1,
  Jobicy: 1,
  Arbeitnow: 1,
  WorkingNomads: 1,
  "Landing.jobs": 1,
  EURemoteJobs: 1,
  Jobspresso: 1,
  NoDesk: 1,
  Programathor: 1,
  JSearch: 1,
  // Requires a paid subscription to apply.
  WeWorkRemotely: 2,
};

export const friction = (source) => SOURCE_FRICTION[source] ?? 1;
export const isPaywalled = (source) => friction(source) >= 2;

/** Normalise a company name so "Lemon.io" and "lemon io" compare equal. */
export const companyKey = (name = "") =>
  String(name).toLowerCase().replace(/[^a-z0-9]/g, "");

// Seniority and formatting noise that should not count towards a title match.
const TITLE_NOISE =
  /\b(senior|snr|sr|junior|jr|staff|principal|lead|mid|remote|contract|fulltime|full|time|part|the|and|of|for|a|an)\b/g;

/**
 * Rough token overlap between two job titles, 0 to 1.
 *
 * Needed because a company-level match is not a role-level match: Lemon.io
 * posting a "Senior DevOps Engineer" on Remotive tells you nothing about their
 * "Senior Vue Developer" on WWR. Claiming otherwise sends you to the wrong ad.
 */
export function titleSimilarity(a = "", b = "") {
  const tokens = (s) =>
    new Set(
      String(s)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        // Collapse the compounds first. Without this, stripping "full" as noise
        // makes "Full Stack Engineer" and "Fullstack Engineer" score exactly the
        // same as "Frontend" against "Backend", which is plainly wrong.
        .replace(/\bfull[\s-]?stack\b/g, "fullstack")
        .replace(/\bfront[\s-]?end\b/g, "frontend")
        .replace(/\bback[\s-]?end\b/g, "backend")
        .replace(/\bfull[\s-]?time\b/g, " ")
        .replace(/\bpart[\s-]?time\b/g, " ")
        .replace(TITLE_NOISE, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;

  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

const ATS_URL = {
  greenhouse: (t) => `https://boards.greenhouse.io/${t}`,
  lever: (t) => `https://jobs.lever.co/${t}`,
  ashby: (t) => `https://jobs.ashbyhq.com/${t}`,
  recruitee: (t) => `https://${t}.recruitee.com`,
  workable: (t) => `https://apply.workable.com/${t}`,
};

// Company homepages that appear in postings but are not the employer.
const NOT_EMPLOYER =
  /weworkremotely|linkedin|twitter|x\.com|facebook|youtube|calendly|notion\.so|google\.com|bit\.ly/i;

/**
 * Build an ordered list of ways to apply without paying, best first.
 *
 * @param job          the posting being viewed
 * @param boardMatch   {ats, token} if the company matches a known ATS board
 * @param freeAlt      the same role seen on a cheaper source, if any
 */
export function resolveApplyRoutes(job, boardMatch, freeAlt) {
  const routes = [];

  if (boardMatch && ATS_URL[boardMatch.ats]) {
    routes.push({
      kind: "employer-board",
      label: `${job.company} on ${boardMatch.ats}`,
      hint: "The company's own board. Free, and your application goes straight to their pipeline.",
      url: ATS_URL[boardMatch.ats](boardMatch.token),
    });
  }

  if (freeAlt) {
    // Only call it the same role when the titles actually agree. Otherwise say
    // plainly that it is a different opening at the same employer, which is
    // still a free way in but should never be mistaken for this posting.
    const sameRole = titleSimilarity(job.title, freeAlt.title) >= 0.6;
    routes.push({
      kind: sameRole ? "free-source" : "same-employer",
      label: sameRole
        ? `Same role via ${freeAlt.source}`
        : `${job.company} also posts on ${freeAlt.source}`,
      hint: sameRole
        ? "The identical posting on a source that does not charge to apply."
        : `A different opening (${freeAlt.title}). Useful as a free route into the same employer, but it is not this role.`,
      url: freeAlt.url,
    });
  }

  // The employer's own site, pulled from whatever the posting included.
  const site = (job.description || "")
    .match(/https?:\/\/[^\s"<>)\]]+/gi)
    ?.map((u) => u.replace(/[.,)]+$/, ""))
    .find((u) => !NOT_EMPLOYER.test(u));

  if (site) {
    const origin = (() => {
      try {
        return new URL(site).origin;
      } catch {
        return null;
      }
    })();
    if (origin) {
      routes.push({
        kind: "careers-page",
        label: "Company careers page",
        hint: "Most employers list the same role here, usually at /careers or /jobs.",
        url: `${origin}/careers`,
      });
    }
  }

  // Always available, costs nothing, and usually lands the role in one click.
  routes.push({
    kind: "search",
    label: "Find this role elsewhere",
    hint: "Searches for the same title outside the paywalled board.",
    url: `https://www.google.com/search?q=${encodeURIComponent(
      `"${job.company}" "${job.title}" careers apply`
    )}`,
  });

  return routes;
}
