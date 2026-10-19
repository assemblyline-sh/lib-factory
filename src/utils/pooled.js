// @ts-check

/**
 * Run an async task across `items` with at most `concurrency` running at once.
 * Preserves input order in the returned `results` array — `results[i]` is the
 * resolved value of `fn(items[i], i)`.
 *
 * @template T, R
 * @param {T[]} items - Items to process
 * @param {number} concurrency - Max number of `fn` invocations in flight at once
 * @param {(item: T, index: number) => Promise<R>} fn - Async function, called once per item
 * @returns {Promise<R[]>}
 */
export async function pooled(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  async function drain() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => drain()),
  );
  return results;
}
