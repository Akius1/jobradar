// BambooHR public careers API.
//
// Every tenant serves its board at <token>.bamboohr.com/careers/list as plain
// JSON, with no key and no scraping. BambooHR sells to small and mid-size
// companies rather than the funded startups that pick Ashby, so it reaches a
// different slice of the market than the other employer boards here — including
// African employers, which is the slice that matters most for this board.
//
// Two-phase, like Greenhouse and for the same reason: the list is cheap but
// carries no posting date, so freshness can only be judged after the detail
// call. Unlike Greenhouse we cannot pre-filter on date, which is what the cap
// below is for.

import { tokensFor, forgetToken } from "../discovery.js";
import { pooledMap } from "../pool.js";

const SEED = ["a5labs", "yellowcard"];

// Detail calls per sweep across all boards. Boards here are small (single
// figures is typical), so this clears many companies rather than truncating one.
const MAX_DETAILS = 160;

const UA = { "User-Agent": "JobRadar/1.0" };

/**
 * A tenant that does not exist answers 200 with BambooHR's own marketing HTML
 * rather than a 404, so the content type is the only reliable signal that a
 * board is real. Anything non-JSON is treated as "no such board".
 */
async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  if (!/json/i.test(res.headers.get("content-type") || "")) return null;
  return res.json();
}

async function listBoard(token) {
  const data = await getJson(`https://${token}.bamboohr.com/careers/list`);
  if (!data) {
    forgetToken("bamboohr", token);
    return [];
  }
  return (data.result || []).map((j) => ({ ...j, _token: token }));
}

/** The board never names the company, so the tenant slug is all we have. */
function companyFrom(token) {
  return token
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function locationOf(jo) {
  const a = jo.atsLocation || {};
  const l = jo.location || {};
  // City-states repeat themselves across the fields ("Kyiv, Kyiv, Ukraine"),
  // so collapse duplicates rather than printing the same place twice.
  const seen = new Set();
  return [a.city || l.city, a.state || l.state, a.country]
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter((p) => {
      const key = p.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

export async function fetchBambooHR() {
  const boards = await pooledMap(tokensFor("bamboohr", SEED), listBoard, 6);
  const openings = boards.flatMap((r) => (r.ok ? r.value : []));

  if (!openings.length) {
    if (boards.every((r) => !r.ok)) throw boards[0]?.error || new Error("BambooHR: all boards failed");
    return [];
  }

  const details = await pooledMap(
    openings.slice(0, MAX_DETAILS),
    (j) => getJson(`https://${j._token}.bamboohr.com/careers/${j.id}/detail`),
    6
  );

  return details
    .map((d, i) => {
      const jo = d.ok && d.value?.result?.jobOpening;
      if (!jo) return null;
      const token = openings[i]._token;
      const posted = Date.parse(jo.datePosted);

      return {
        id: `bamboohr-${token}-${openings[i].id}`,
        source: "BambooHR",
        title: jo.jobOpeningName,
        company: companyFrom(token),
        url: jo.jobOpeningShareUrl || `https://${token}.bamboohr.com/careers/${openings[i].id}`,
        // Many tenants leave every location field null and put "(Remote)" in the
        // title instead. Saying "Remote" there would assert a policy the
        // employer never stated, so leave it blank and let the description
        // decide: an unstated location is exactly what "worth a shot" is for.
        locationText: locationOf(jo),
        salary: jo.compensation || null,
        tags: [jo.departmentLabel, jo.employmentStatusLabel].filter(Boolean),
        postedAt: Number.isFinite(posted) ? posted : Date.now(),
        description: jo.description || "",
      };
    })
    .filter(Boolean);
}
