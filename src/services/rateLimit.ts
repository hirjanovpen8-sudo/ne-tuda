/**
 * Serializes operations and spaces their starts by at least 1100 ms.
 * Use one instance for all requests sharing a provider quota. This cannot
 * enforce a quota across browser tabs, users, or other processes.
 */
export function createRateLimiter() {
  let tail: Promise<void> = Promise.resolve();
  let lastStart: number | undefined;

  return function schedule<T>(operation: (signal?: AbortSignal) => T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
    const abortReason = () => signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
    if (signal?.aborted) return Promise.reject(abortReason());

    let abort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(abortReason());
      signal?.addEventListener('abort', abort, { once: true });
    });

    const job = tail.then(async () => {
      if (signal?.aborted) throw abortReason();
      while (lastStart !== undefined) {
        const remaining = 1100 - (performance.now() - lastStart);
        if (remaining <= 0) break;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, remaining);
          const cancel = () => { clearTimeout(timer); reject(abortReason()); };
          signal?.addEventListener('abort', cancel, { once: true });
          if (signal?.aborted) cancel();
        });
      }
      if (signal?.aborted) throw abortReason();
      lastStart = performance.now();
      return operation(signal);
    });
    // A running operation retains the lock until it actually settles, even if
    // the caller has already been notified of cancellation.
    tail = job.then(() => undefined, () => undefined);
    return Promise.race([job, aborted]).finally(() => signal?.removeEventListener('abort', abort));
  };
}
