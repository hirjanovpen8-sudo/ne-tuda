/** Editing a route does not infer progress: callers provide the confirmed travelled
 * polyline, ending at the current position. Coordinates are [longitude, latitude].
 * Routing is delegated to the supplied pedestrian router; no straight-line fallback
 * or claim about accessibility, safety, opening hours, etc. is made here. */
import { distanceMeters, type Coordinate, type PedestrianRouter } from '../planner';
import { calculateBudget, type Budget } from '../domain';

export interface Stop { id: string; coordinate: Coordinate; cost: number | null }
export type EditAction =
  | { type: 'finish'; destination: Coordinate }
  | { type: 'home'; home: Coordinate }
  | { type: 'add-stop'; stop: Stop; remainingStops: readonly Stop[]; destination: Coordinate };
export interface EditOptions {
  /** Already travelled and confirmed by the caller, in order; last point is current position. */
  travelled: readonly Coordinate[];
  action: EditAction;
  route: PedestrianRouter;
  /** Costs already incurred/confirmed, not inferred from geometry. */
  visitedCosts?: readonly (number | null)[];
  /** Any hard constraints are unsupported and cause a fail-closed error. */
  hardConstraints?: readonly unknown[];
}
export interface EditedRoute {
  travelled: Coordinate[];
  remaining: Coordinate[];
  geometry: Coordinate[];
  stops: Stop[];
  travelledKm: number;
  remainingKm: number;
  totalKm: number;
  budget: Budget;
}
export type RouteEditErrorCode = 'invalid-input' | 'unsupported-hard-constraints' | 'invalid-route';
export class RouteEditError extends Error {
  constructor(public readonly code: RouteEditErrorCode, message: string) { super(message); this.name = 'RouteEditError'; }
}
function validPoint(p: unknown): p is Coordinate {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}
function validCost(c: unknown): c is number | null { return c === null || (typeof c === 'number' && Number.isFinite(c) && c >= 0); }
function validStop(s: Stop): boolean { return !!s && typeof s.id === 'string' && !!s.id.trim() && validPoint(s.coordinate) && validCost(s.cost); }
function copyPoint(p: Coordinate): Coordinate { return [p[0], p[1]]; }
function length(points: readonly Coordinate[]): number { return points.slice(1).reduce((sum, point, i) => sum + distanceMeters(points[i], point), 0); }

/** Returns a new route, or rejects without changing inputs. Router errors propagate. */
export async function editRoute(options: EditOptions): Promise<EditedRoute> {
  if (!options || !Array.isArray(options.travelled) || !options.travelled.length || !options.travelled.every(validPoint) || typeof options.route !== 'function' || !Array.isArray(options.visitedCosts ?? []) || !(options.visitedCosts ?? []).every(validCost) || !Array.isArray(options.hardConstraints ?? [])) throw new RouteEditError('invalid-input', 'Invalid route edit options');
  if (options.hardConstraints?.length) throw new RouteEditError('unsupported-hard-constraints', 'Hard constraints cannot be verified by route editing');
  const action = options.action;
  if (!action || !['finish', 'home', 'add-stop'].includes(action.type)) throw new RouteEditError('invalid-input', 'Invalid edit action');
  let destination: Coordinate;
  let stops: Stop[] = [];
  if (action.type === 'add-stop') {
    if (!validStop(action.stop) || !Array.isArray(action.remainingStops) || !action.remainingStops.every(validStop) || !validPoint(action.destination)) throw new RouteEditError('invalid-input', 'Invalid stop or destination');
    stops = [action.stop, ...action.remainingStops];
    if (new Set(stops.map(s => s.id)).size !== stops.length) throw new RouteEditError('invalid-input', 'Duplicate stop ID');
    destination = action.destination;
  } else {
    destination = action.type === 'home' ? action.home : action.destination;
    if (!validPoint(destination)) throw new RouteEditError('invalid-input', 'Invalid destination');
  }
  const travelled = options.travelled.map(copyPoint);
  const waypoints = [travelled[travelled.length - 1], ...stops.map(s => s.coordinate), destination].map(copyPoint);
  // Protect confirmed geometry and result bookkeeping from a mutating callback.
  const candidate = await options.route(waypoints.map(copyPoint));
  if (!candidate || !Array.isArray(candidate.geometry) || candidate.geometry.length < 2 || !candidate.geometry.every(validPoint) || !Number.isFinite(candidate.distance) || candidate.distance < 0) throw new RouteEditError('invalid-route', 'Router returned invalid geometry or distance');
  const remaining = candidate.geometry.map(copyPoint);
  const measured = length(remaining);
  // The geometry must join the confirmed position exactly; otherwise concatenation
  // would invent an unwalked segment. Subsequent waypoints allow provider snapping.
  if (distanceMeters(remaining[0], travelled[travelled.length - 1]) > 0.01 || distanceMeters(remaining[remaining.length - 1], destination) > 50 || measured > candidate.distance * 1.02 + 1 || measured < candidate.distance * 0.90 - 1) throw new RouteEditError('invalid-route', 'Router geometry does not connect or match its distance');
  let index = 0;
  for (const point of remaining) if (index < waypoints.length && distanceMeters(point, waypoints[index]) <= 50) index++;
  if (index !== waypoints.length) throw new RouteEditError('invalid-route', 'Router geometry does not visit waypoints in order');
  const travelledKm = length(travelled) / 1000, remainingKm = candidate.distance / 1000;
  return {
    travelled, remaining, geometry: [...travelled, ...remaining.slice(1)],
    stops: stops.map(s => ({ ...s, coordinate: copyPoint(s.coordinate) })),
    travelledKm, remainingKm, totalKm: travelledKm + remainingKm,
    budget: calculateBudget([...(options.visitedCosts ?? []), ...stops.map(s => s.cost)].map((cost, i) => ({ id: String(i), name: '', cost, attributes: {} }))),
  };
}
