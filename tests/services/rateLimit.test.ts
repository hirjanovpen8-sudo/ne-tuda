import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../../src/services/rateLimit';

describe('createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs in order with at least 1100 ms between starts', async () => {
    const schedule = createRateLimiter();
    const starts: number[] = [];
    const run = () => { starts.push(performance.now()); return starts.length; };
    const results = [schedule(run), schedule(run), schedule(run)];
    await vi.advanceTimersByTimeAsync(2199);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.all(results)).toEqual([1, 2, 3]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1100);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1100);
  });

  it('waits for a running operation and recovers from failures', async () => {
    const schedule = createRateLimiter();
    let release!: () => void;
    const first = schedule(() => new Promise<void>(resolve => { release = resolve; }));
    const second = schedule(() => { throw new Error('failed'); });
    const secondResult = expect(second).rejects.toThrow('failed');
    const third = schedule(() => 'ok');
    await vi.advanceTimersByTimeAsync(2000);
    release();
    await first;
    await secondResult;
    await vi.advanceTimersByTimeAsync(1100);
    await expect(third).resolves.toBe('ok');
  });

  it('rejects already aborted and queued requests without starting them', async () => {
    const schedule = createRateLimiter();
    const controller = new AbortController();
    const run = vi.fn();
    await schedule(() => undefined);
    const queued = schedule(run, controller.signal);
    const rejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    await expect(schedule(run, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const next = schedule(() => 'next');
    await vi.advanceTimersByTimeAsync(1100);
    await expect(next).resolves.toBe('next');
    expect(run).not.toHaveBeenCalled();
  });

  it('notifies cancellation during execution but holds the lock until settlement', async () => {
    const schedule = createRateLimiter();
    const controller = new AbortController();
    let release!: () => void;
    const running = schedule(signal => {
      expect(signal).toBe(controller.signal);
      return new Promise<void>(resolve => { release = resolve; });
    }, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    const rejection = expect(running).rejects.toBe('cancelled');
    controller.abort('cancelled');
    await rejection;
    const next = vi.fn();
    const result = schedule(next);
    await vi.advanceTimersByTimeAsync(2000);
    expect(next).not.toHaveBeenCalled();
    release();
    await result;
    expect(next).toHaveBeenCalledOnce();
  });
});
