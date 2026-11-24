import { OSM_ATTRIBUTION, ProviderError, type Coordinate, type ProviderOptions } from '../services/providers';

/** Raw values are OSM claims, not verified current conditions. null means unknown. */
export interface CatalogPlace {
  id: string;
  name: string | null;
  coordinate: Coordinate;
  tags: Record<string, string>;
  source: { name: 'OpenStreetMap'; url: string; attribution: string };
  /** Timestamp of the OSM database snapshot used for this response, if supplied. */
  checkedAt: string | null;
  access: string | null;
  lighting: string | null;
  openingHours: string | null;
  surface: string | null;
  /** Raw fee/charge tags; neither implies a numeric price or currency. */
  price: { fee: string | null; charge: string | null } | null;
}
export interface CatalogOptions extends ProviderOptions { endpoint?: string }

const selectors = ['[tourism~"^(attraction|viewpoint|artwork|museum|gallery)$"]', '[historic]', '[leisure~"^(park|garden|nature_reserve)$"]', '[natural~"^(peak|waterfall|cave_entrance)$"]'];
function validCoordinate(lon: unknown, lat: unknown): lon is number {
  return typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180 && typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90;
}
function excluded(tags: Record<string, string>): boolean {
  const value = (key: string) => (tags[key] ?? '').trim().toLowerCase();
  if (['no', 'private'].includes(value('access')) || ['no', 'private'].includes(value('foot')) || value('opening_hours') === 'permanently closed') return true;
  if (['hazard', 'danger'].some(key => value(key) !== '' && value(key) !== 'no')) return true;
  if (['closed', 'disused', 'abandoned', 'demolished', 'destroyed', 'razed', 'construction'].some(key => value(key) !== '' && value(key) !== 'no')) return true;
  return Object.keys(tags).some(key => /^(closed|disused|abandoned|demolished|destroyed|razed|construction):/.test(key));
}
function tag(tags: Record<string, string>, key: string): string | null { return tags[key]?.trim() || null; }

/** Explicit, bounded user-initiated search. No automatic retries or synthetic fallback. */
export async function searchCatalog(center: Coordinate, radiusMeters: number, options: CatalogOptions = {}): Promise<CatalogPlace[]> {
  if (!Array.isArray(center) || center.length !== 2 || !validCoordinate(center[0], center[1])) throw new RangeError('Invalid longitude/latitude');
  if (!Number.isInteger(radiusMeters) || radiusMeters < 1 || radiusMeters > 1500) throw new RangeError('Radius must be 1–1500 m');
  const [lon, lat] = center;
  const query = `[out:json][timeout:20];(${selectors.map(s => `nwr${s}(around:${radiusMeters},${lat},${lon});`).join('')});out center 100;`;
  const response = await (options.fetch ?? fetch)(options.endpoint ?? 'https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }), signal: options.signal });
  if (!response.ok) throw new ProviderError('overpass', `HTTP ${response.status}`, response.status);
  let data: any;
  try { data = await response.json(); } catch { throw new ProviderError('overpass', 'Invalid JSON'); }
  if (!data || !Array.isArray(data.elements) || data.remark) throw new ProviderError('overpass', `Invalid or incomplete response${data?.remark ? `: ${String(data.remark)}` : ''}`);
  const timestamp = typeof data.osm3s?.timestamp_osm_base === 'string' && Number.isFinite(Date.parse(data.osm3s.timestamp_osm_base)) ? data.osm3s.timestamp_osm_base : null;
  return data.elements.flatMap((element: any): CatalogPlace[] => {
    if (!element || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0) return [];
    const x = element.type === 'node' ? element.lon : element.center?.lon;
    const y = element.type === 'node' ? element.lat : element.center?.lat;
    if (!validCoordinate(x, y)) return [];
    const tags: Record<string, string> = Object.create(null);
    if (element.tags && typeof element.tags === 'object' && !Array.isArray(element.tags)) for (const [k, v] of Object.entries(element.tags)) if (typeof v === 'string') tags[k] = v;
    if (excluded(tags)) return [];
    const fee = tag(tags, 'fee'), charge = tag(tags, 'charge');
    return [{ id: `${element.type}/${element.id}`, name: tag(tags, 'name'), coordinate: [x, y as number], tags, source: { name: 'OpenStreetMap', url: `https://www.openstreetmap.org/${element.type}/${element.id}`, attribution: OSM_ATTRIBUTION }, checkedAt: timestamp, access: tag(tags, 'access'), lighting: tag(tags, 'lit'), openingHours: tag(tags, 'opening_hours'), surface: tag(tags, 'surface'), price: fee || charge ? { fee, charge } : null }];
  });
}
