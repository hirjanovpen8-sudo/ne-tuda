import { describe, it, expect } from 'vitest';
import { acceptFix, distanceToNextStep, geoDistance, nearestProgress, updateDeviation } from '../../src/navigation';

const a = { lat: 0, lon: 0 }, b = { lat: 0, lon: 0.001 }, c = { lat: 0.001, lon: 0.001 };
describe('navigation', () => {
  it('calculates great-circle distances including antimeridian', () => {
    expect(geoDistance(a, b)).toBeCloseTo(111.195, 2);
    expect(geoDistance({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 })).toBeCloseTo(222.39, 1);
    expect(() => geoDistance(a, { lat: NaN, lon: 0 })).toThrow();
  });
  it('projects onto geometry, accounts for preceding segments and handles degenerate geometry', () => {
    const p = nearestProgress([a, b, c], { lat: 0.0005, lon: 0.0011 })!;
    expect(p.segmentIndex).toBe(1); expect(p.fraction).toBeCloseTo(0.5); expect(p.along).toBeCloseTo(166.79, 1);
    expect(p.distance).toBeCloseTo(11.12, 1);
    expect(nearestProgress([], a)).toBeNull();
    expect(nearestProgress([a, a], b)!.along).toBe(0);
    expect(nearestProgress([{ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 }], { lat: 0, lon: 180 })!.fraction).toBeCloseTo(0.5);
  });
  it('finds next maneuver along the route', () => {
    const p = nearestProgress([a, b, c], { lat: 0, lon: 0.0005 })!;
    expect(distanceToNextStep([a, b, c], p, [{ coordinateIndex: 0 }, { coordinateIndex: 1 }, { coordinateIndex: 2 }])!.distance).toBeCloseTo(55.6, 1);
    expect(distanceToNextStep([a, b, c], p, [{ coordinateIndex: 0 }])).toBeNull();
    expect(() => distanceToNextStep([a, b, c], p, [{ coordinateIndex: 3 }])).toThrow();
  });
  it('rejects stale, inaccurate and jumping GPS fixes', () => {
    const fix = { coordinate: a, timestamp: 1000 };
    expect(acceptFix(null, fix)).toBe(true);
    expect(acceptFix(fix, { coordinate: b, timestamp: 1000 })).toBe(false);
    expect(acceptFix(fix, { coordinate: b, timestamp: 2000 })).toBe(false);
    expect(acceptFix(fix, { coordinate: b, timestamp: 11000 })).toBe(true);
    expect(acceptFix(fix, { coordinate: a, timestamp: 2000, accuracy: 101 })).toBe(false);
  });
  it('applies independent thresholds and consecutive-count hysteresis', () => {
    const opts = { enterDistance: 50, exitDistance: 20, enterCount: 2, exitCount: 2 };
    let state = { offRoute: false, count: 0 };
    state = updateDeviation(state, 55, opts); expect(state).toEqual({ offRoute: false, count: 1 });
    state = updateDeviation(state, 30, opts); expect(state.count).toBe(0);
    state = updateDeviation(updateDeviation(state, 55, opts), 55, opts); expect(state.offRoute).toBe(true);
    state = updateDeviation(state, 30, opts); expect(state.offRoute).toBe(true);
    state = updateDeviation(updateDeviation(state, 10, opts), 10, opts); expect(state.offRoute).toBe(false);
  });
});
