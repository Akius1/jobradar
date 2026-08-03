import { loadList, setCacheHeaders } from "./_data.js";
import { applyFacets, buildMeta, windowCutoff } from "../server/src/query.js";

export default async function handler(req, res) {
  try {
    const data = await loadList();
    const all = data.jobs || [];

    const within = req.query.within;
    const inWindow = all.filter((j) => j.postedAt >= windowCutoff(within));
    const jobs = applyFacets(inWindow, req.query).sort((a, b) => b.postedAt - a.postedAt);

    setCacheHeaders(res);
    res.status(200).json({
      jobs,
      meta: buildMeta(all, within, {
        lastRefresh: data.lastRefresh,
        sourceStatus: data.sourceStatus,
        generatedAt: data.generatedAt,
        jsearchEnabled: Boolean(process.env.RAPIDAPI_KEY),
      }),
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
