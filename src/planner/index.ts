/** Independent loop planning. Coordinates are [longitude, latitude], distances in metres.
 * The caller must connect `route` to a real pedestrian routing service; this module
 * never substitutes straight lines and makes no safety or accessibility claims.
 */
export type Coordinate = readonly [number, number];
export interface PedestrianRoute { geometry: readonly Coordinate[]; distance: number }
export type PedestrianRouter = (waypoints: readonly Coordinate[]) => Promise<PedestrianRoute>;
export interface PlanOptions {
  start: Coordinate;
  distance: number;
  seed: string | number;
  route: PedestrianRouter;
  /** Relative distance tolerance, default 0.15, at most 0.5. */
  tolerance?: number;
  /** Prior geometries used to reduce repeated street segments. */
  previousRoutes?: readonly (readonly Coordinate[])[];
  /** Maximum acceptable fraction of repeated segments, default 1 (ranking only). */
  maxRepeat?: number;
  /** Maximum excess internal traversal fraction; default 0.15. A 100 m allowance applies for short shared approaches. */
  maxInternalRepeat?: number;
  /** Number of independent candidates, default 12, maximum 50. */
  attempts?: number;
}
export interface PlannedLoop extends PedestrianRoute { waypoints: readonly Coordinate[]; repeatFraction: number; internalRepeatFraction: number }
export type PlannerErrorCode = 'invalid-input' | 'outside-omsk' | 'no-route';
export class PlannerError extends Error {
  constructor(public readonly code: PlannerErrorCode, message: string) { super(message); this.name = 'PlannerError'; }
}
// Deliberately conservative inner rectangle, NOT an official city boundary. A route
// outside it is rejected even if it may in fact still be in Omsk. Its convexity
// also keeps straight geometry segments between accepted vertices inside it.
export function isInsideOmsk(point: Coordinate): boolean {
  return validPoint(point) && point[0] >= 73.25 && point[0] <= 73.50 && point[1] >= 54.90 && point[1] <= 55.08;
}
function validPoint(p: Coordinate): boolean {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}
const R = 6371000;
const rad = Math.PI / 180;
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}
function destination(start: Coordinate, metres: number, bearing: number): Coordinate {
  const lat = start[1] * rad, lon = start[0] * rad, d = metres / R;
  const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(bearing));
  const lon2 = lon + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
  return [lon2 / rad, lat2 / rad];
}
function random(seed: string | number): () => number {
  let state = 2166136261;
  for (const c of String(seed)) { state ^= c.charCodeAt(0); state = Math.imul(state, 16777619); }
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Sample each segment at roughly 10 m and count undirected grid edges. This
// approximates repeated physical segments even when polylines have different vertices.
function edges(points: readonly Coordinate[]): Set<string> {
  const result = new Set<string>();
  const cell = (p: Coordinate) => `${Math.round(p[0] * 6400)},${Math.round(p[1] * 9000)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const count = Math.max(1, Math.ceil(distanceMeters(a, b) / 10));
    let prev = cell(a);
    for (let j = 1; j <= count; j++) {
      const next = cell([a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count]);
      if (prev !== next) result.add(prev < next ? `${prev}|${next}` : `${next}|${prev}`);
      prev = next;
    }
  }
  return result;
}
export function segmentRepeatFraction(route: readonly Coordinate[], previous: readonly (readonly Coordinate[])[]): number {
  if (![route, ...previous].every(p => Array.isArray(p) && p.every(validPoint))) throw new PlannerError('invalid-input', 'Invalid route geometry');
  const current = edges(route), old = new Set<string>();
  for (const geometry of previous) for (const edge of edges(geometry)) old.add(edge);
  if (!current.size) return 0;
  let repeated = 0;
  for (const edge of current) if (old.has(edge)) repeated++;
  return repeated / current.size;
}
/** Fraction of geometry length traversed after its first traversal, regardless of direction.
 * Grid approximation (~10 m); repeated traversal is counted every time, not just once. */
export function internalSegmentRepeat(route: readonly Coordinate[]): { fraction: number; repeatedMeters: number; nearStartMeters: number; totalMeters: number } {
  if (!Array.isArray(route) || !route.every(validPoint)) throw new PlannerError('invalid-input', 'Invalid route geometry');
  const seen = new Set<string>();
  let repeatedMeters = 0, nearStartMeters = 0, totalMeters = 0;
  const cell = (p: Coordinate) => `${Math.round(p[0] * 6400)},${Math.round(p[1] * 9000)}`;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const count = Math.max(1, Math.ceil(distanceMeters(a, b) / 2));
    let prev = cell(a), anchor = a;
    for (let j = 1; j <= count; j++) {
      const point: Coordinate = [a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count];
      const next = cell(point);
      if (prev !== next) {
        const key = prev < next ? `${prev}|${next}` : `${next}|${prev}`;
        // Use grid-edge length, not vertex spacing, so a return with different
        // intermediate points has the same undirected representation.
        const [x1, y1] = prev.split(',').map(Number), [x2, y2] = next.split(',').map(Number);
        const metres = distanceMeters([x1 / 6400, y1 / 9000], [x2 / 6400, y2 / 9000]);
        totalMeters += metres;
        if (seen.has(key)) {
          repeatedMeters += metres;
          if (route.length && distanceMeters(route[0], anchor) <= 100 && distanceMeters(route[0], point) <= 100) nearStartMeters += metres;
        }
        seen.add(key);
        prev = next;
        anchor = point;
      }
    }
  }
  return { fraction: totalMeters ? repeatedMeters / totalMeters : 0, repeatedMeters, nearStartMeters, totalMeters };
}

/** Returns the best valid candidate, or throws PlannerError; routing failures are never fabricated. */
export async function planLoop(options: PlanOptions): Promise<PlannedLoop> {
  const { start, distance, seed, route, tolerance = 0.15, previousRoutes = [], maxRepeat = 1, maxInternalRepeat = 0.15, attempts = 12 } = options;
  if (!validPoint(start) || !Number.isFinite(distance) || distance <= 0 || distance > 30000 || (typeof seed !== 'string' && (typeof seed !== 'number' || !Number.isFinite(seed))) || typeof route !== 'function' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5 || !Number.isFinite(maxRepeat) || maxRepeat < 0 || maxRepeat > 1 || !Number.isFinite(maxInternalRepeat) || maxInternalRepeat < 0 || maxInternalRepeat > 1 || !Number.isInteger(attempts) || attempts < 1 || attempts > 50 || !Array.isArray(previousRoutes) || !previousRoutes.every(p => Array.isArray(p) && p.every(validPoint))) throw new PlannerError('invalid-input', 'Invalid planning options');
  if (!isInsideOmsk(start)) throw new PlannerError('outside-omsk', 'Start is outside the conservative Omsk area');
  const rng = random(seed);
  let best: PlannedLoop | undefined;
  let rejectedInternalRepeat = false;
  for (let i = 0; i < attempts; i++) {
    const bearing = rng() * Math.PI * 2;
    const radius = distance / (3 * Math.sqrt(3)) * (0.65 + rng() * 0.35);
    const waypoints = [start, ...[0, 1, 2].map(j => destination(start, radius, bearing + j * Math.PI * 2 / 3)), start];
    if (!waypoints.every(isInsideOmsk)) continue;
    let candidate: PedestrianRoute;
    // Transport, cancellation and provider failures must reach the caller; retrying
    // every candidate during an outage only increases load and hides the cause.
    candidate = await route(waypoints);
    if (!candidate || !Array.isArray(candidate.geometry) || candidate.geometry.length < 4 || !candidate.geometry.every(isInsideOmsk) || !Number.isFinite(candidate.distance) || candidate.distance <= 0) continue;
    const geometry = candidate.geometry;
    // Require the router to visit each waypoint in order, with modest snap allowance.
    let index = 0;
    for (const point of geometry) if (index < waypoints.length && distanceMeters(point, waypoints[index]) <= 100) index++;
    if (index !== waypoints.length || distanceMeters(geometry[0], start) > 100 || distanceMeters(geometry[geometry.length - 1], start) > 100 || distanceMeters(geometry[0], geometry[geometry.length - 1]) > 30) continue;
    let measured = 0;
    for (let j = 1; j < geometry.length; j++) measured += distanceMeters(geometry[j - 1], geometry[j]);
    if (measured > candidate.distance * 1.02 || measured < candidate.distance * 0.90 || candidate.distance < distance * (1 - tolerance) || candidate.distance > distance * (1 + tolerance)) continue;
    const repeatFraction = segmentRepeatFraction(geometry, previousRoutes);
    if (repeatFraction > maxRepeat) continue;
    const internal = internalSegmentRepeat(geometry);
    // Exempt only up to 100 m of repeated traversal close to the start; the
    // reported fraction always includes that allowance.
    const excessFraction = internal.totalMeters ? (internal.repeatedMeters - Math.min(100, internal.nearStartMeters)) / internal.totalMeters : 0;
    if (excessFraction > maxInternalRepeat) { rejectedInternalRepeat = true; continue; }
    const current = { geometry: geometry.map(p => [p[0], p[1]] as Coordinate), distance: candidate.distance, waypoints, repeatFraction, internalRepeatFraction: internal.fraction };
    if (!best || current.internalRepeatFraction < best.internalRepeatFraction || (current.internalRepeatFraction === best.internalRepeatFraction && (repeatFraction < best.repeatFraction || (repeatFraction === best.repeatFraction && Math.abs(candidate.distance - distance) < Math.abs(best.distance - distance))))) best = current;
  }
  if (!best) throw new PlannerError('no-route', rejectedInternalRepeat ? 'No acceptable pedestrian loop: candidates have excessive repeated sections or fail other constraints' : 'No valid pedestrian loop found within the requested constraints');
  return best;
}
