// Greenhouse public board API. This is the "hidden" job market: roles appear
// on a company's own board days before they reach any aggregator, and many
// never get syndicated at all.
//
// Two-phase fetch to keep bandwidth sane: the list endpoint is cheap and
// carries first_published + title, so we filter to recent software roles first
// and only pull full descriptions for the survivors.

import { tokensFor, forgetToken } from "../discovery.js";
import { pooledMap } from "../pool.js";

// Verified against the live board API before being added; discovery grows the
// rest. See the note in ashby.js on why a seed is still needed at all.
const SEED = [
  "stripe", "airbnb", "figma", "reddit", "coinbase", "robinhood", "discord",
  "flexport", "asana", "dropbox", "gitlab", "databricks", "affirm", "instacart",
  "grafanalabs", "mixpanel", "vercel", "brex", "postman", "amplitude", "scaleai",
  "mozilla", "twilio", "samsara", "duolingo", "trustpilot", "monzo", "n26",
  "cloudflare", "elastic", "canonical", "mongodb",
  "datadog", "anthropic", "okta", "pinterest", "adyen", "fivetran", "block",
  "remotecom", "lyft", "clickhouse", "gusto", "chime", "newrelic", "mercury",
  "fastly", "neo4j", "snorkelai", "airtable", "algolia", "launchdarkly",
  "betterment", "contentful", "gocardless", "turing", "cockroachlabs",
  "honeycomb", "galileo", "truelayer", "planetscale", "watershed", "labelbox",
  "circleci", "comet", "netlify",
];

const MAX_DETAIL_FETCHES = 140; // cap per sweep across all companies
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function listJobs(token) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`, {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (res.status === 404) {
    forgetToken("greenhouse", token);
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();
  return (data.jobs || []).map((j) => ({ ...j, _token: token }));
}

async function fetchDetail(token, id) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}`, {
    headers: { "User-Agent": "JobRadar/1.0" },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchGreenhouse() {
  const companies = tokensFor("greenhouse", SEED);
  const lists = await pooledMap(companies, listJobs, 8);
  const all = lists.flatMap((r) => (r.ok ? r.value : []));
  if (!all.length) throw new Error("no Greenhouse boards responded");

  const cutoff = Date.now() - WINDOW_MS;
  const recent = all
    .filter((j) => {
      const posted = Date.parse(j.first_published || j.updated_at);
      return Number.isFinite(posted) && posted >= cutoff;
    })
    .sort((a, b) => Date.parse(b.first_published) - Date.parse(a.first_published))
    .slice(0, MAX_DETAIL_FETCHES);

  const details = await pooledMap(recent, (j) => fetchDetail(j._token, j.id), 8);

  return recent.map((j, i) => {
    const d = details[i].ok ? details[i].value : null;
    return {
      id: `greenhouse-${j._token}-${j.id}`,
      source: "Greenhouse",
      title: j.title,
      company: j.company_name || j._token,
      url: j.absolute_url,
      locationText: j.location?.name || "Not stated",
      salary: null,
      tags: (d?.departments || []).map((x) => x.name).slice(0, 4),
      postedAt: Date.parse(j.first_published || j.updated_at),
      description: d?.content || "",
    };
  });
}
