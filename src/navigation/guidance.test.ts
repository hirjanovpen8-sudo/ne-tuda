import { describe, expect, it } from 'vitest';
import { acknowledgeStep, initialGuidanceState, locateSteps, updateGuidance } from './guidance';
import { geoDistance } from './index';

const p = (lon: number, lat = 0) => ({ lon, lat });
const fix = (lon: number, timestamp: number, lat = 0, accuracy = 5) => ({ coordinate: p(lon, lat), timestamp, accuracy });
describe('guidance', () => {
  it('locates between vertices and preserves all same-position maneuvers', () => {
    const route = [p(0), p(0.01)];
    const steps = locateSteps(route, [{ coordinate: p(0.005), instruction: 'left' }, { coordinate: p(0.005), instruction: 'right' }]);
    expect(steps).toHaveLength(2);
    expect(steps[0].along).toBeCloseTo(geoDistance(p(0), p(0.005)), 1);
    let state = initialGuidanceState();
    state = updateGuidance(route, steps, state, fix(0, 1000)).state;
    expect(updateGuidance(route, steps, state, fix(0.0001, 11000)).next?.instruction).toBe('left');
    expect(updateGuidance(route, steps, acknowledgeStep(state, steps), fix(0.0001, 11000)).next?.instruction).toBe('right');
  });
  it('fails visibly for unmatched maneuvers', () => {
    expect(() => locateSteps([p(0), p(0.01)], [{ coordinate: p(0, 1), instruction: 'turn' }])).toThrow();
  });
  it('clips long segments to the progress window and rejects distant fixes', () => {
    const route = [p(0), p(0.01)];
    const result = updateGuidance(route, [], initialGuidanceState(), fix(0.005, 1000));
    expect(result.status).toBe('off-route');
    expect(result.state.progress).toBeNull();
  });
  it('rejects noisy and stale fixes without poisoning state', () => {
    const route = [p(0), p(0.01)];
    const state = updateGuidance(route, [], initialGuidanceState(), fix(0, 1000)).state;
    expect(updateGuidance(route, [], state, fix(0.0001, 2000, 0, 100)).status).toBe('invalid-fix');
    expect(updateGuidance(route, [], state, fix(0, 1000)).status).toBe('invalid-fix');
    expect(updateGuidance(route, [], state, fix(0.0001, 11000)).status).toBe('accepted');
  });
  it('does not jump to the end of a loop at its start', () => {
    const route = [p(0), p(0.001), p(0.001, 0.001), p(0, 0.001), p(0)];
    const result = updateGuidance(route, [], initialGuidanceState(), fix(0, 1000));
    expect(result.state.progress?.along).toBe(0);
  });
  it('freezes on ambiguous parallel route branches', () => {
    const route = [p(0), p(0.0005), p(0.0005, 0.00003), p(0, 0.00003)];
    const result = updateGuidance(route, [], initialGuidanceState(), fix(0.0003, 1000, 0.000015), { initialWindow: 120 });
    expect(result.status).toBe('ambiguous');
    expect(result.state.progress).toBeNull();
  });
});
