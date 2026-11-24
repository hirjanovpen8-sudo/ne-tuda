import { describe, expect, it, vi } from 'vitest';
import { createRouteTitle } from '../../src/planner/title';

describe('createRouteTitle', () => {
  it('is deterministic and varies wording by seed', () => {
    const facts = { distanceMeters: 2300, seed: 'one' };
    expect(createRouteTitle(facts)).toEqual(createRouteTitle(facts));
    const titles = new Set(Array.from({ length: 20 }, (_, seed) => createRouteTitle({ ...facts, seed }).title));
    expect(titles.size).toBeGreaterThan(1);
  });

  it('uses only provided facts, independently of the current time', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2025-01-01T22:00:00Z'));
      const result = createRouteTitle({ distanceMeters: 750, seed: 1 });
      expect(result.description).toBe('750 м.');
      expect(`${result.title} ${result.description}`).not.toMatch(/вечер|ноч|вода|архитектур|истор|возвращ/);
    } finally { vi.useRealTimers(); }
  });

  it('includes explicit time, return and source tags', () => {
    const result = createRouteTitle({ distanceMeters: 2400, seed: 'a', timeOfDay: 'evening', returnsToStart: true, placeTags: ['park', 'water'] });
    expect(result.description).toBe('2,4 км · вечером · с возвращением к началу · места по данным источника: парк, вода.');
    expect(result.description).not.toMatch(/архитектур|истор/);
  });

  it('does not turn an unknown or false return into a claim', () => {
    expect(createRouteTitle({ distanceMeters: 1000, seed: 0, returnsToStart: false }).description).toBe('1,0 км.');
  });

  it('rejects invalid lengths and seeds', () => {
    for (const distanceMeters of [0, -1, NaN, Infinity]) expect(() => createRouteTitle({ distanceMeters, seed: 1 })).toThrow();
    expect(() => createRouteTitle({ distanceMeters: 1, seed: NaN })).toThrow();
  });
});
