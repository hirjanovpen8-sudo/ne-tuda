import { describe, expect, it, vi } from 'vitest';
import { distanceMeters, internalSegmentRepeat, isInsideOmsk, planLoop, PlannerError, segmentRepeatFraction, type Coordinate } from '../../src/planner';

const start: Coordinate = [73.37, 54.99];
const route = async (points: readonly Coordinate[]) => ({ geometry: points, distance: points.slice(1).reduce((sum, p, i) => sum + distanceMeters(points[i], p), 0) });

describe('pedestrian loop planner', () => {
  it('uses the supplied router, closes the loop, and is deterministic for a seed', async () => {
    const router = vi.fn(route);
    const opts = { start, distance: 5000, seed: 'abc', route: router, attempts: 4, tolerance: 0.5 };
    const a = await planLoop(opts), b = await planLoop(opts);
    expect(a).toEqual(b);
    expect(router).toHaveBeenCalledTimes(8);
    expect(a.geometry[0]).toEqual(start);
    expect(a.geometry.at(-1)).toEqual(start);
    expect(a.geometry.every(isInsideOmsk)).toBe(true);
    expect(a.distance).toBeGreaterThan(2500);
  });
  it('produces different candidates for different seeds', async () => {
    const a = await planLoop({ start, distance: 5000, seed: 1, route, tolerance: 0.5, attempts: 1 });
    const b = await planLoop({ start, distance: 5000, seed: 2, route, tolerance: 0.5, attempts: 1 });
    expect(a.waypoints).not.toEqual(b.waypoints);
  });
  it('compares actual undirected segments instead of POIs', () => {
    const a: Coordinate[] = [start, [73.38, 54.99]];
    expect(segmentRepeatFraction(a, [[...a].reverse()])).toBeGreaterThan(0.8);
    expect(segmentRepeatFraction(a, [[[73.4, 55], [73.41, 55]]])).toBe(0);
  });
  it('measures undirected internal repetitions including differently subdivided returns', () => {
    const end: Coordinate = [73.38, 54.99];
    const mid: Coordinate = [73.375, 54.99];
    const result = internalSegmentRepeat([start, end, mid, start]);
    expect(result.fraction).toBeGreaterThan(0.45);
    expect(result.fraction).toBeLessThan(0.55);
    expect(result.repeatedMeters).toBeGreaterThan(500);
  });
  it('rejects a long actual out-and-back with an explanatory conflict', async () => {
    const router = async (p: readonly Coordinate[]) => {
      const geometry = [p[0], p[1], p[0], p[1], ...p.slice(2)];
      return { geometry, distance: geometry.slice(1).reduce((sum, point, i) => sum + distanceMeters(geometry[i], point), 0) };
    };
    await expect(planLoop({ start, distance: 5000, seed: 1, attempts: 1, tolerance: 0.5, route: router })).rejects.toMatchObject({ code: 'no-route', message: expect.stringContaining('excessive repeated') });
  });
  it('allows a short shared start approach while reporting it', async () => {
    const router = async (p: readonly Coordinate[]) => {
      const approach: Coordinate = [p[0][0] + 0.0004, p[0][1]];
      const geometry = [p[0], approach, ...p.slice(1, -1), approach, p[0]];
      return { geometry, distance: geometry.slice(1).reduce((sum, point, i) => sum + distanceMeters(geometry[i], point), 0) };
    };
    const result = await planLoop({ start, distance: 5000, seed: 1, attempts: 1, tolerance: 0.5, maxInternalRepeat: 0.02, route: router });
    expect(result.internalRepeatFraction).toBeGreaterThan(0);
  });
  it('ranks a clean candidate above one with a shared approach', async () => {
    let count = 0;
    const router = async (p: readonly Coordinate[]) => {
      const approach: Coordinate = [p[0][0] + 0.0004, p[0][1]];
      const geometry = count++ === 0 ? [p[0], approach, ...p.slice(1, -1), approach, p[0]] : [...p];
      return { geometry, distance: geometry.slice(1).reduce((sum, point, i) => sum + distanceMeters(geometry[i], point), 0) };
    };
    const result = await planLoop({ start, distance: 5000, seed: 1, attempts: 2, tolerance: 0.5, route: router });
    expect(result.internalRepeatFraction).toBeLessThan(0.01);
  });
  it('rejects routing failures and does not return straight-line fallback', async () => {
    const router = vi.fn(async () => { throw new Error('offline'); });
    await expect(planLoop({ start, distance: 5000, seed: 1, route: router, attempts: 2 })).rejects.toThrow('offline');
    expect(router).toHaveBeenCalledTimes(1);
  });
  it('rejects out-of-bounds, wrong distance, open and malformed responses', async () => {
    const responses = [
      (p: readonly Coordinate[]) => ({ geometry: [...p.slice(0, -1), [73.7, 55] as Coordinate, start], distance: 5000 }),
      (p: readonly Coordinate[]) => ({ geometry: p, distance: 9000 }),
      (p: readonly Coordinate[]) => ({ geometry: p, distance: 5000 }),
      (p: readonly Coordinate[]) => ({ geometry: p.slice(0, -1), distance: 5000 }),
      () => ({ geometry: [start, start, start, start], distance: 5000 }),
    ];
    for (const response of responses) await expect(planLoop({ start, distance: 5000, seed: 1, attempts: 1, route: async p => response(p) })).rejects.toMatchObject({ code: 'no-route' });
  });
  it('honours repeat threshold', async () => {
    const first = await planLoop({ start, distance: 5000, seed: 1, route, tolerance: 0.5, attempts: 1 });
    await expect(planLoop({ start, distance: 5000, seed: 1, route, tolerance: 0.5, attempts: 1, previousRoutes: [first.geometry], maxRepeat: 0 })).rejects.toMatchObject({ code: 'no-route' });
  });
  it('validates inputs and conservative bounds', async () => {
    await expect(planLoop({ start: [0, 0], distance: 5000, seed: 1, route })).rejects.toMatchObject({ code: 'outside-omsk' });
    await expect(planLoop({ start, distance: -1, seed: 1, route })).rejects.toBeInstanceOf(PlannerError);
    expect(distanceMeters(start, start)).toBe(0);
  });
});
