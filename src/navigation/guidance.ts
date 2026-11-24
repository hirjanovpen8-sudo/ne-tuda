import { acceptFix, geoDistance, nearestProgress, type Coordinate, type Fix, type Progress } from './index';

/** Navigation is deliberately stateful: reset it for each route. Distances are metres. */
export interface GuidanceStep { coordinate: Coordinate; instruction: string }
export interface LocatedStep extends GuidanceStep { along: number }
export interface GuidanceState { fix: Fix | null; progress: Progress | null; nextStep: number }
export interface GuidanceOptions { maxSpeed?: number; maxAccuracy?: number; jumpTolerance?: number; maxRouteDistance?: number; ambiguityDistance?: number; backwardAllowance?: number; initialWindow?: number }
export interface GuidanceUpdate { state: GuidanceState; status: 'accepted' | 'invalid-fix' | 'off-route' | 'ambiguous'; next: LocatedStep | null; distance: number | null }

function offsetsFor(points: readonly Coordinate[]): number[] {
  const offsets = [0];
  for (let i = 1; i < points.length; i++) offsets.push(offsets[i - 1] + geoDistance(points[i - 1], points[i]));
  return offsets;
}
function interpolate(a: Coordinate, b: Coordinate, f: number): Coordinate {
  const delta = ((b.lon - a.lon + 540) % 360) - 180;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: ((a.lon + delta * f + 540) % 360) - 180 };
}
/** Project only inside the exact along-route interval, including clipped long segments. */
function candidates(points: readonly Coordinate[], offsets: number[], position: Coordinate, low: number, high: number): Progress[] {
  const result: Progress[] = [], total = offsets[offsets.length - 1];
  for (let i = 0; i + 1 < points.length; i++) {
    const length = offsets[i + 1] - offsets[i];
    if (offsets[i + 1] < low || offsets[i] > high) continue;
    const start = length ? Math.max(0, (low - offsets[i]) / length) : 0;
    const end = length ? Math.min(1, (high - offsets[i]) / length) : 0;
    const projection = nearestProgress([interpolate(points[i], points[i + 1], start), interpolate(points[i], points[i + 1], end)], position)!;
    const fraction = start + (end - start) * projection.fraction;
    result.push({ ...projection, segmentIndex: i, fraction, along: offsets[i] + length * fraction, total });
  }
  return result;
}
/** Map every supplied maneuver to the ordered route, including points between vertices.
 * Throws instead of silently dropping unmatched maneuvers. Ambiguous loops require provider
 * offsets or pre-split geometry; callers must not treat an exception as a complete route. */
export function locateSteps(points: readonly Coordinate[], steps: readonly GuidanceStep[], maxDistance = 30): LocatedStep[] {
  if (points.length < 2 || !Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('Invalid route or distance');
  const offsets = offsetsFor(points); let previous = 0;
  return steps.map(step => {
    const matches = candidates(points, offsets, step.coordinate, previous, offsets[offsets.length - 1]).sort((a, b) => a.distance - b.distance || a.along - b.along);
    const best = matches[0];
    if (!best || best.distance > maxDistance) throw new RangeError('Maneuver does not match route');
    previous = best.along;
    return { ...step, along: best.along };
  });
}
export function initialGuidanceState(): GuidanceState { return { fix: null, progress: null, nextStep: 0 }; }
/** Explicit acknowledgement prevents noisy GPS or a sparse fix from silently skipping instructions.
 * A caller may acknowledge only after conveying the current instruction to the user. */
export function acknowledgeStep(state: GuidanceState, steps: readonly LocatedStep[]): GuidanceState {
  return { ...state, nextStep: Math.min(steps.length, state.nextStep + 1) };
}
/** Fixes rejected as inaccurate, off-route, implausible or ambiguous never advance progress.
 * `fix` remains the last accepted fix, so outliers cannot poison subsequent comparisons. */
export function updateGuidance(points: readonly Coordinate[], steps: readonly LocatedStep[], state: GuidanceState, fix: Fix, options: GuidanceOptions = {}): GuidanceUpdate {
  if (points.length < 2) throw new RangeError('Route must contain at least two points');
  const offsets = offsetsFor(points), total = offsets[offsets.length - 1];
  if (!Number.isInteger(state.nextStep) || state.nextStep < 0 || state.nextStep > steps.length) throw new RangeError('Invalid step cursor');
  let prior = -1;
  for (const step of steps) { if (!Number.isFinite(step.along) || step.along < prior || step.along > total) throw new RangeError('Invalid maneuver offsets'); prior = step.along; }
  const maxRouteDistance = options.maxRouteDistance ?? 40, ambiguityDistance = options.ambiguityDistance ?? 8, backward = options.backwardAllowance ?? 15, initialWindow = options.initialWindow ?? 30;
  for (const value of [maxRouteDistance, ambiguityDistance, backward, initialWindow]) if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid guidance option');
  const next = steps[state.nextStep] ?? null;
  const output = (status: GuidanceUpdate['status'], s = state): GuidanceUpdate => ({ state: s, status, next, distance: next && s.progress ? Math.max(0, next.along - s.progress.along) : null });
  if (!acceptFix(state.fix, fix, { maxSpeed: options.maxSpeed ?? 4, jumpTolerance: options.jumpTolerance ?? 15, maxAccuracy: options.maxAccuracy ?? 75 })) return output('invalid-fix');
  const previous = state.progress?.along ?? 0;
  const elapsed = state.fix ? (fix.timestamp - state.fix.timestamp) / 1000 : 0;
  const allowance = state.fix ? (options.maxSpeed ?? 4) * elapsed + (options.jumpTolerance ?? 15) : initialWindow;
  const low = Math.max(0, previous - backward), high = Math.min(total, previous + allowance);
  const found = candidates(points, offsets, fix.coordinate, low, high).sort((a, b) => a.distance - b.distance || a.along - b.along);
  const best = found[0];
  if (!best || best.distance > maxRouteDistance) return output('off-route');
  // Nearby projections on adjacent segments describe the same location, not a branch.
  if (found.some(p => Math.abs(p.along - best.along) > Math.max(20, backward * 2) && p.distance <= best.distance + ambiguityDistance)) return output('ambiguous');
  return output('accepted', { ...state, fix, progress: best });
}
