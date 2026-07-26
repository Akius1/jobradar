/**
 * Run an async mapper over items with bounded concurrency.
 *
 * The discovery registry pushes the ATS adapters from a handful of companies
 * into the hundreds, and firing that many requests at once gets us rate limited
 * (Lever starts refusing connections outright). Keeping a modest number in
 * flight is both politer to the host and more reliable for us.
 *
 * Never rejects: each result is {ok, value} or {ok:false, error}, so one bad
 * token cannot take down a whole source.
 */
export async function pooledMap(items, fn, concurrency = 6, retries = 1) {
  const results = new Array(items.length);
  let cursor = 0;

  async function attempt(item, i) {
    let lastError;
    for (let a = 0; a <= retries; a++) {
      try {
        return { ok: true, value: await fn(item, i) };
      } catch (error) {
        lastError = error;
        // Socket resets and pool exhaustion are transient under load, so back
        // off briefly rather than writing the whole board off.
        if (a < retries) await new Promise((r) => setTimeout(r, 400 * (a + 1)));
      }
    }
    return { ok: false, error: lastError };
  }

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await attempt(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return results;
}
