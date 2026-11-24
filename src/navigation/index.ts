/** Coordinates are latitude/longitude in degrees; distances are metres, timestamps milliseconds. */
export interface Coordinate { lat: number; lon: number }
export interface Progress { segmentIndex: number; fraction: number; along: number; distance: number; point: Coordinate; total: number }
export interface Maneuver { coordinateIndex: number; [key: string]: unknown }
export interface StepDistance { index: number; maneuver: Maneuver; distance: number }
export interface Fix { coordinate: Coordinate; timestamp: number; accuracy?: number }
export interface FixOptions { maxSpeed?: number; jumpTolerance?: number; maxAccuracy?: number }
export interface DeviationOptions { enterDistance: number; exitDistance: number; enterCount?: number; exitCount?: number }
export interface DeviationState { offRoute: boolean; count: number }

const R = 6371008.8;
const rad = Math.PI / 180;
function longitudeDelta(a: number, b: number): number { return ((b - a + 540) % 360) - 180; }
function validatePoint(p: Coordinate): void {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) throw new RangeError('Invalid coordinate');
}
function nonnegative(n: number, name: string): void { if (!Number.isFinite(n) || n < 0) throw new RangeError(`Invalid ${name}`); }

/** Great-circle distance (haversine). */
export function geoDistance(a: Coordinate, b: Coordinate): number {
  validatePoint(a); validatePoint(b);
  const dLat = (b.lat - a.lat) * rad, dLon = longitudeDelta(a.lon, b.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Nearest projection on a polyline. Ties prefer earlier progress. Empty geometry returns null.
 * Projection is local planar; segment lengths and reported distances use great-circle distances. */
export function nearestProgress(geometry: readonly Coordinate[], location: Coordinate): Progress | null {
  validatePoint(location); geometry.forEach(validatePoint);
  if (!geometry.length) return null;
  if (geometry.length === 1) return { segmentIndex: 0, fraction: 0, along: 0, distance: geoDistance(location, geometry[0]), point: geometry[0], total: 0 };
  const lengths = geometry.slice(1).map((p, i) => geoDistance(geometry[i], p));
  const total = lengths.reduce((a, b) => a + b, 0);
  let best: Progress | null = null, along = 0;
  for (let i = 0; i < lengths.length; i++) {
    const a = geometry[i], b = geometry[i + 1];
    const scale = Math.cos((a.lat + b.lat + location.lat) / 3 * rad);
    const x = longitudeDelta(a.lon, b.lon) * scale, y = b.lat - a.lat;
    const px = longitudeDelta(a.lon, location.lon) * scale, py = location.lat - a.lat;
    const denominator = x * x + y * y;
    const fraction = denominator ? Math.max(0, Math.min(1, (px * x + py * y) / denominator)) : 0;
    const lon = ((a.lon + longitudeDelta(a.lon, b.lon) * fraction + 540) % 360) - 180;
    const point = { lat: a.lat + (b.lat - a.lat) * fraction, lon };
    const candidate = { segmentIndex: i, fraction, along: along + lengths[i] * fraction, distance: geoDistance(location, point), point, total };
    if (!best || candidate.distance < best.distance - 1e-7) best = candidate;
    along += lengths[i];
  }
  return best;
}

/** Distance along geometry to the first maneuver not yet passed; null when none remain. */
export function distanceToNextStep(geometry: readonly Coordinate[], progress: Progress, maneuvers: readonly Maneuver[]): StepDistance | null {
  geometry.forEach(validatePoint);
  nonnegative(progress.along, 'progress');
  const offsets = [0];
  for (let i = 1; i < geometry.length; i++) offsets.push(offsets[i - 1] + geoDistance(geometry[i - 1], geometry[i]));
  let previous = -1;
  for (const step of maneuvers) {
    if (!Number.isInteger(step.coordinateIndex) || step.coordinateIndex < 0 || step.coordinateIndex >= geometry.length || step.coordinateIndex < previous) throw new RangeError('Invalid maneuver index/order');
    previous = step.coordinateIndex;
  }
  if (!geometry.length || progress.along > offsets[offsets.length - 1] + 1e-6) throw new RangeError('Progress outside geometry');
  const index = maneuvers.findIndex(step => offsets[step.coordinateIndex] >= progress.along - 1e-6);
  return index < 0 ? null : { index, maneuver: maneuvers[index], distance: Math.max(0, offsets[maneuvers[index].coordinateIndex] - progress.along) };
}

/** Reject stale, inaccurate or implausibly fast fixes. Rejected fixes must not replace previous. */
export function acceptFix(previous: Fix | null, next: Fix, options: FixOptions = {}): boolean {
  validatePoint(next.coordinate);
  if (!Number.isFinite(next.timestamp)) throw new RangeError('Invalid timestamp');
  const { maxSpeed = 50, jumpTolerance = 30, maxAccuracy = 100 } = options;
  nonnegative(maxSpeed, 'maxSpeed'); nonnegative(jumpTolerance, 'jumpTolerance'); nonnegative(maxAccuracy, 'maxAccuracy');
  if (next.accuracy !== undefined) { nonnegative(next.accuracy, 'accuracy'); if (next.accuracy > maxAccuracy) return false; }
  if (!previous) return true;
  validatePoint(previous.coordinate);
  if (!Number.isFinite(previous.timestamp)) throw new RangeError('Invalid previous timestamp');
  if (next.timestamp <= previous.timestamp) return false;
  return geoDistance(previous.coordinate, next.coordinate) <= jumpTolerance + maxSpeed * (next.timestamp - previous.timestamp) / 1000;
}

/** Hysteresis with consecutive readings; intermediate readings reset the pending transition. */
export function updateDeviation(state: DeviationState, distance: number, options: DeviationOptions): DeviationState {
  nonnegative(distance, 'distance'); nonnegative(options.enterDistance, 'enterDistance'); nonnegative(options.exitDistance, 'exitDistance');
  const enterCount = options.enterCount ?? 1, exitCount = options.exitCount ?? 1;
  if (options.exitDistance > options.enterDistance || !Number.isInteger(enterCount) || enterCount < 1 || !Number.isInteger(exitCount) || exitCount < 1 || !Number.isInteger(state.count) || state.count < 0) throw new RangeError('Invalid hysteresis options or state');
  const crossing = state.offRoute ? distance <= options.exitDistance : distance >= options.enterDistance;
  if (!crossing) return { offRoute: state.offRoute, count: 0 };
  const count = state.count + 1;
  return count >= (state.offRoute ? exitCount : enterCount) ? { offRoute: !state.offRoute, count: 0 } : { offRoute: state.offRoute, count };
}
