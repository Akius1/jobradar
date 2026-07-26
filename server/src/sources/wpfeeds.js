// Several regional boards run WP Job Manager, which exposes an identical
// ?feed=job_feed RSS shape. One adapter covers all of them, and each new region
// is a single line.
//
// Programathor is Brazilian and posts in Portuguese, which is why the role
// classifier carries Portuguese and Spanish keywords.

import { XMLParser } from "fast-xml-parser";

const FEEDS = [
  ["EURemoteJobs", "https://euremotejobs.com/?feed=job_feed", "Europe"],
  ["Jobspresso", "https://jobspresso.co/?feed=job_feed", "Remote"],
  ["NoDesk", "https://nodesk.co/remote-jobs/index.xml", "Remote"],
  ["Programathor", "https://programathor.com.br/jobs.rss", "Brazil"],
];

function textOf(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return String(v["#text"] ?? "");
}

async function fetchFeed([label, url, defaultLocation]) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 JobRadar/1.0", Accept: "application/rss+xml,*/*" },
  });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const xml = await res.text();
  const parsed = new XMLParser({ processEntities: false, ignoreAttributes: false }).parse(xml);
  const raw = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
  const items = Array.isArray(raw) ? raw : [raw];

  return items.filter(Boolean).map((item, i) => {
    const link = textOf(item.link) || textOf(item.guid) || "";
    const title = textOf(item.title);
    // WP Job Manager puts the employer in job_listing_company when present.
    const company =
      textOf(item["job_listing:company"]) ||
      textOf(item["dc:creator"]) ||
      label;

    return {
      id: `wp-${label.toLowerCase()}-${(link || title || i).split("/").filter(Boolean).pop()}`,
      source: label,
      title,
      company,
      url: link,
      locationText: textOf(item["job_listing:location"]) || defaultLocation,
      salary: null,
      tags: [],
      postedAt: Date.parse(textOf(item.pubDate) || textOf(item.updated)) || Date.now(),
      description: textOf(item.description) || textOf(item.content) || "",
    };
  });
}

export async function fetchWpFeeds() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const jobs = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!jobs.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
  return jobs;
}
