/** Standalone OSM provider adapters. Coordinates are [longitude, latitude]. */
export type Coordinate = readonly [number, number];
export type Fetch = typeof fetch;
export interface ProviderOptions { fetch?: Fetch; signal?: AbortSignal }
export class ProviderError extends Error {
  constructor(public readonly provider: string, message: string, public readonly status?: number) { super(`${provider}: ${message}`); this.name = 'ProviderError'; }
}
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OPENFREEMAP_ATTRIBUTION = 'OpenFreeMap | © OpenMapTiles | Data © OpenStreetMap contributors';
export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function point(p: Coordinate): string {
  if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new RangeError('Invalid longitude/latitude');
  return `${p[0]},${p[1]}`;
}
async function json(provider: string, url: string, init: RequestInit, options: ProviderOptions): Promise<any> {
  const response = await (options.fetch ?? fetch)(url, { ...init, signal: options.signal });
  if (!response.ok) throw new ProviderError(provider, `HTTP ${response.status}`, response.status);
  try { return await response.json(); } catch { throw new ProviderError(provider, 'Invalid JSON'); }
}
export interface WalkingRoute { distanceMeters: number; durationSeconds: number; geometry: { type: 'LineString'; coordinates: number[][] } }
/** No fallback to a car profile or straight line. Endpoint is independently configurable. */
export async function routeWalking(from: Coordinate, to: Coordinate, options: ProviderOptions & { baseUrl?: string } = {}): Promise<WalkingRoute> {
  const base = (options.baseUrl ?? 'https://routing.openstreetmap.de/routed-foot').replace(/\/$/, '');
  // OSRM URL profile is "driving"; the separate routed-foot server determines the pedestrian profile.
  const url = `${base}/route/v1/driving/${point(from)};${point(to)}?overview=full&geometries=geojson`;
  const data = await json('routing', url, {}, options);
  if (data?.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes[0]) throw new ProviderError('routing', `No route (${String(data?.code ?? 'invalid response')})`);
  const r = data.routes[0];
  if (!Number.isFinite(r.distance) || r.distance <= 0 || !Number.isFinite(r.duration) || r.duration < 0 || r.geometry?.type !== 'LineString' || !Array.isArray(r.geometry.coordinates) || r.geometry.coordinates.length < 2 || !r.geometry.coordinates.every((p: unknown) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180 && typeof p[1] === 'number' && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90)) throw new ProviderError('routing', 'Invalid route');
  return { distanceMeters: r.distance, durationSeconds: r.duration, geometry: r.geometry };
}
export interface GeocodingResult { id: string; name: string; coordinate: Coordinate }
/** Explicit submitted search only; caller must enforce the public instance's aggregate usage policy. */
export async function searchNominatim(query: string, options: ProviderOptions & { baseUrl?: string; limit?: number } = {}): Promise<GeocodingResult[]> {
  if (!query.trim()) throw new RangeError('Empty query');
  const limit = options.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError('Limit must be 1–10');
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(limit) });
  const data = await json('nominatim', `${(options.baseUrl ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '')}/search?${params}`, {}, options);
  if (!Array.isArray(data)) throw new ProviderError('nominatim', 'Invalid response');
  return data.map((item: any) => {
    const lon = Number(item.lon), lat = Number(item.lat);
    if (typeof item.display_name !== 'string' || !Number.isFinite(lon) || !Number.isFinite(lat) || item.osm_id == null || typeof item.osm_type !== 'string') throw new ProviderError('nominatim', 'Invalid result');
    point([lon, lat]);
    return { id: `${item.osm_type}/${item.osm_id}`, name: item.display_name, coordinate: [lon, lat] as Coordinate };
  });
}
export interface OsmPlace { id: string; coordinate: Coordinate; tags: Record<string, string>; openingHours: string | null }
/** Small bounded query; tags are raw OSM data, not evidence that a place is open now. */
export async function nearbyAmenities(center: Coordinate, radiusMeters: number, options: ProviderOptions & { endpoint?: string } = {}): Promise<OsmPlace[]> {
  point(center);
  if (!Number.isInteger(radiusMeters) || radiusMeters < 1 || radiusMeters > 1500) throw new RangeError('Radius must be 1–1500 m');
  const [lon, lat] = center;
  const query = `[out:json][timeout:20];nwr[amenity](around:${radiusMeters},${lat},${lon});out center 100;`;
  const body = new URLSearchParams({ data: query });
  const data = await json('overpass', options.endpoint ?? 'https://overpass-api.de/api/interpreter', { method: 'POST', body }, options);
  if (!Array.isArray(data?.elements) || data.remark) throw new ProviderError('overpass', `Invalid or incomplete response${data?.remark ? `: ${data.remark}` : ''}`);
  return data.elements.flatMap((e: any) => {
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (!['node', 'way', 'relation'].includes(e.type) || !Number.isSafeInteger(e.id) || !Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    const tags: Record<string, string> = {};
    if (e.tags && typeof e.tags === 'object') for (const [key, value] of Object.entries(e.tags)) if (typeof value === 'string') tags[key] = value;
    return [{ id: `${e.type}/${e.id}`, coordinate: [lon, lat] as Coordinate, tags, openingHours: tags.opening_hours ?? null }];
  });
}
