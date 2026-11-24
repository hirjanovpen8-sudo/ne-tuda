import { describe, expect, it, vi } from 'vitest';
import { searchCatalog } from '../../src/catalog';

describe('OSM catalog', () => {
  it('builds bounded query and maps verified fields without inventing values', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const query = String(new URLSearchParams(init?.body as string).get('data'));
      expect(query).toContain('[timeout:20]'); expect(query).toContain('around:500,55,37'); expect(query).toContain('out center 100');
      return new Response(JSON.stringify({ osm3s: { timestamp_osm_base: '2026-11-25T00:00:00Z' }, elements: [{ type: 'node', id: 7, lon: 37, lat: 55, tags: { name: 'View', tourism: 'viewpoint', lit: 'yes', surface: 'unpaved', access: 'yes' } }] }), { status: 200 });
    });
    const [place] = await searchCatalog([37, 55], 500, { fetch: fetcher as typeof fetch });
    expect(place).toMatchObject({ id: 'node/7', name: 'View', coordinate: [37, 55], access: 'yes', lighting: 'yes', surface: 'unpaved', openingHours: null, price: null, checkedAt: '2026-11-25T00:00:00Z' });
    expect(place.source.name).toBe('OpenStreetMap');
  });
  it('excludes explicit closed/private/dangerous entries and keeps unknown price', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { type: 'node', id: 1, lon: 37, lat: 55, tags: { tourism: 'attraction', access: 'private' } },
      { type: 'node', id: 2, lon: 37.1, lat: 55.1, tags: { tourism: 'attraction', hazard: 'dangerous' } },
      { type: 'way', id: 3, center: { lon: 37.2, lat: 55.2 }, tags: { tourism: 'attraction', name: 'Unknown fee' } },
    ] }), { status: 200 }));
    const places = await searchCatalog([37, 55], 1, { fetch: fetcher as typeof fetch });
    expect(places).toHaveLength(1); expect(places[0].id).toBe('way/3'); expect(places[0].price).toBeNull();
  });
  it('propagates provider errors without fallback', async () => {
    const fetcher = vi.fn(async () => new Response('oops', { status: 503 }));
    await expect(searchCatalog([0, 0], 100, { fetch: fetcher as typeof fetch })).rejects.toThrow('overpass: HTTP 503');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
