import { loadList, setCacheHeaders } from "./_data.js";
import { buildMeta } from "../server/src/query.js";

export default async function handler(req, res) {
  try {
    const data = await loadList();
    setCacheHeaders(res);
    res.status(200).json(
      buildMeta(data.jobs || [], req.query.within, {
        lastRefresh: data.lastRefresh,
        sourceStatus: data.sourceStatus,
        generatedAt: data.generatedAt,
        jsearchEnabled: Boolean(process.env.RAPIDAPI_KEY),
      })
    );
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
