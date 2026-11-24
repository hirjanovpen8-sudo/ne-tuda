import { describe, expect, it, vi } from 'vitest';
import { ProviderError, routeWalking } from '../../src/services/providers';

const from = [73.37, 54.99] as const, to = [73.38, 54.99] as const;
const response = (route: unknown) => vi.fn(async () => new Response(JSON.stringify({ code: 'Ok', routes: [route] }), { status: 200 })) as unknown as typeof fetch;
const valid = { distance: 500, duration: 300, geometry: { type: 'LineString', coordinates: [from, to] } };

describe('walking provider', () => {
  it('returns a valid foot route', async () => {
    const fetch = response(valid);
    expect((await routeWalking(from, to, { fetch })).distanceMeters).toBe(500);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/routed-foot/');
  });
  it('rejects invalid distances, durations and coordinates', async () => {
    for (const route of [{ ...valid, distance: -1 }, { ...valid, duration: -1 }, { ...valid, geometry: { type: 'LineString', coordinates: [from, [181, 0]] } }]) {
      await expect(routeWalking(from, to, { fetch: response(route) })).rejects.toBeInstanceOf(ProviderError);
    }
  });
  it('reports HTTP errors', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof globalThis.fetch;
    await expect(routeWalking(from, to, { fetch })).rejects.toMatchObject({ status: 429 });
  });
});
