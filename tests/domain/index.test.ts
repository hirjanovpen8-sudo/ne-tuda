import { describe, expect, it } from 'vitest';
import { calculateBudget, filterPlaces, fingerprint, generateTitle, generateWalk, matchCriterion, type Place } from '../../src/domain';

const a: Place = { id: 'a', name: 'А', cost: 100, attributes: { indoor: true, accessible: null } };
const b: Place = { id: 'b', name: 'Б', cost: 0, attributes: { indoor: false, accessible: true } };
const c: Place = { id: 'c', name: 'В', cost: null, attributes: {} };

describe('domain', () => {
  it('distinguishes mismatch and unknown; hard unknown never passes', () => {
    expect(matchCriterion(a, { attribute: 'accessible', value: true })).toBe('unknown');
    const results = filterPlaces([a, b, c], [{ attribute: 'indoor', value: true }], [{ attribute: 'accessible', value: true }]);
    expect(results.map(x => x.eligible)).toEqual([true, false, false]);
    expect(results[0].unknownWishes).toBe(1);
    expect(results[1].wishMatches).toBe(1);
  });
  it('does not count unknown costs as zero', () => {
    expect(calculateBudget([a, b, c])).toEqual({ knownTotal: 100, unknownCount: 1, total: null });
    expect(calculateBudget([a, b]).total).toBe(100);
  });
  it('uses stable order-independent fingerprints without delimiter collisions', () => {
    expect(fingerprint(['b', 'a'])).toBe(fingerprint(['a', 'b', 'a']));
    expect(fingerprint(['a,b'])).not.toBe(fingerprint(['a', 'b']));
  });
  it('is deterministic for a seed and independent of input order', () => {
    const options = { places: [a, b, c], count: 2, seed: 42 };
    expect(generateWalk(options)).toEqual(generateWalk(options));
    expect(generateWalk(options).fingerprint).toBe(generateWalk({ ...options, places: [c, b, a] }).fingerprint);
  });
  it('honours hard filters, budget, repeats, and explains exclusions', () => {
    const walk = generateWalk({ places: [a, b, c], count: 2, seed: 'x', budget: 50, previousPlaceIds: ['b'] });
    expect(walk.places).toEqual([]);
    expect(walk.conflicts.map(x => x.code)).toEqual(expect.arrayContaining(['budget', 'repeat', 'unknown-cost', 'insufficient-places']));
    expect(generateWalk({ places: [a, b, c], count: 3, seed: 1, hard: [{ attribute: 'indoor', value: true }] }).places).toEqual([a]);
  });
  it('prioritizes wishes without excluding mismatches and allows explicit repeats', () => {
    const walk = generateWalk({ places: [a, b], count: 2, seed: 1, wishes: [{ attribute: 'indoor', value: false }], previousPlaceIds: ['b'], allowRepeats: true });
    expect(walk.places).toEqual([b, a]);
    expect(generateTitle(walk.places)).toBe('Б — А');
    expect(generateTitle([])).toBe('Прогулка');
  });
  it('reports duplicates and invalid input', () => {
    expect(generateWalk({ places: [a, a], count: 2, seed: 1 }).conflicts.map(x => x.code)).toContain('duplicate-place-id');
    expect(generateWalk({ places: [a], count: -1, seed: 1 }).conflicts[0].code).toBe('invalid-input');
  });
});
