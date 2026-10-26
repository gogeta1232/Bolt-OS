/** Start work lazily, with a fixed number of workers and stable result order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer');
  }
  const results: R[] = [];
  const iterator = items.entries();
  const worker = async (): Promise<void> => {
    for (let entry = iterator.next(); !entry.done; entry = iterator.next()) {
      const [index, item] = entry.value;
      results[index] = await operation(item, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
