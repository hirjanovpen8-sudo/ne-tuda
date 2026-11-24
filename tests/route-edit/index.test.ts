import { describe, expect, it, vi } from 'vitest';
import { editRoute, RouteEditError } from '../../src/route-edit';
import { distanceMeters, type Coordinate } from '../../src/planner';

const a: Coordinate = [73.3, 55], b: Coordinate = [73.301, 55], c: Coordinate = [73.302, 55], d: Coordinate = [73.303, 55];
const router = vi.fn(async (points: readonly Coordinate[]) => ({ geometry: [...points], distance: points.slice(1).reduce((n, p, i) => n + distanceMeters(points[i], p), 0) }));

describe('route editing', () => {
  it('keeps confirmed history, routes only the remainder and accounts for unknown costs', async () => {
    router.mockClear();
    const travelled = [a, b];
    const result = await editRoute({ travelled, route: router, visitedCosts: [10, null], action: { type: 'add-stop', stop: { id: 'new', coordinate: c, cost: 5 }, remainingStops: [], destination: d } });
    expect(router).toHaveBeenCalledWith([b, c, d]);
    expect(result.geometry).toEqual([a, b, c, d]);
    expect(result.travelled).toEqual(travelled);
    expect(result.travelledKm).toBeCloseTo(distanceMeters(a, b) / 1000);
    expect(result.totalKm).toBeCloseTo(result.travelledKm + result.remainingKm);
    expect(result.budget).toEqual({ knownTotal: 15, unknownCount: 1, total: null });
    expect(travelled).toEqual([a, b]);
  });
  it.each(['finish', 'home'] as const)('routes directly to %s', async type => {
    const action = type === 'home' ? { type, home: d } as const : { type, destination: d } as const;
    const result = await editRoute({ travelled: [a, b], route: router, action });
    expect(result.geometry).toEqual([a, b, d]);
    expect(result.budget.total).toBe(0);
  });
  it('fails closed for hard constraints before calling router', async () => {
    const route = vi.fn();
    await expect(editRoute({ travelled: [a], route, action: { type: 'home', home: b }, hardConstraints: ['accessible'] })).rejects.toMatchObject({ code: 'unsupported-hard-constraints' });
    expect(route).not.toHaveBeenCalled();
  });
  it('rejects invalid input and duplicate stops', async () => {
    const stop = { id: 'x', coordinate: c, cost: null };
    await expect(editRoute({ travelled: [], route: router, action: { type: 'home', home: b } })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(editRoute({ travelled: [a], route: router, action: { type: 'add-stop', stop, remainingStops: [stop], destination: d } })).rejects.toMatchObject({ code: 'invalid-input' });
  });
  it('rejects disconnected, malformed, dishonest or waypoint-skipping router results', async () => {
    const action = { type: 'add-stop', stop: { id: 'x', coordinate: c, cost: null }, remainingStops: [], destination: d } as const;
    for (const result of [
      { geometry: [a, c, d], distance: 100 },
      { geometry: [b, [999, 0], d], distance: 100 },
      { geometry: [b, c, d], distance: 999999 },
      { geometry: [b, d], distance: distanceMeters(b, d) },
    ]) await expect(editRoute({ travelled: [a, b], action, route: async () => result as never })).rejects.toBeInstanceOf(RouteEditError);
  });
  it('propagates router failures rather than fabricating a route', async () => {
    const failure = new Error('offline');
    await expect(editRoute({ travelled: [a], action: { type: 'home', home: b }, route: async () => { throw failure; } })).rejects.toBe(failure);
  });
});
