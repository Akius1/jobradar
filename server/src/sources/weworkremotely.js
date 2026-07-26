// We Work Remotely: public RSS feeds (free, no key)
import { XMLParser } from "fast-xml-parser";

const FEEDS = [
  "remote-programming-jobs",
  "remote-front-end-programming-jobs",
  "remote-full-stack-programming-jobs",
  "remote-back-end-programming-jobs",
  "remote-devops-sysadmin-jobs",
].map((c) => `https://weworkremotely.com/categories/${c}.rss`);

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { "User-Agent": "JobRadar/1.0" } });
  if (!res.ok) throw new Error(`WWR HTTP ${res.status}`);
  const xml = await res.text();
  // processEntities:false, these feeds trip the parser's entity-expansion limit.
  const parsed = new XMLParser({ processEntities: false }).parse(xml);
  const items = parsed?.rss?.channel?.item || [];
  return (Array.isArray(items) ? items : [items]).map((item) => {
    // Titles arrive as "Company: Job Title"
    const [company, ...rest] = String(item.title).split(":");
    // guid is a full URL: keep just the slug so ids stay URL-safe.
    const guid = String(item.guid?.["#text"] || item.guid || item.link || "");
    return {
      id: `wwr-${guid.split("/").filter(Boolean).pop() || guid}`,
      source: "WeWorkRemotely",
      title: rest.length ? rest.join(":").trim() : String(item.title),
      company: rest.length ? company.trim() : "Unknown",
      url: item.link,
      locationText: item.region || "Remote",
      salary: null,
      tags: [],
      postedAt: Date.parse(item.pubDate),
      description: String(item.description || "").slice(0, 2000).replace(/<[^>]+>/g, " "),
    };
  });
}

export async function fetchWWR() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const jobs = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!jobs.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
  return jobs;
}
