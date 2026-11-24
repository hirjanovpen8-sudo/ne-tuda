import { describe, expect, it } from 'vitest';
import { calculateBudget, type CatalogItem } from '../../src/budget';

const catalog: CatalogItem[] = [
  { id: 'coffee', category: 'coffee', price: 5, basis: 'per-person' },
  { id: 'food', category: 'food', price: 12, basis: 'group' },
  { id: 'tickets', category: 'tickets', price: 0, basis: 'per-person' },
  { id: 'transit', category: 'transit', price: null, basis: 'per-person' },
];

describe('calculateBudget', () => {
  it('calculates category, group and per-person totals from catalog prices', () => {
    const result = calculateBudget({ catalog, participants: 3, selections: [
      { itemId: 'coffee', quantity: 2 }, { itemId: 'food', quantity: 1 }, { itemId: 'tickets', quantity: 1 },
    ], budget: 42 });
    expect(result.knownTotal).toBe(42);
    expect(result.total).toBe(42);
    expect(result.perPerson).toBe(14);
    expect(result.categories.coffee.total).toBe(30);
    expect(result.categories.food.total).toBe(12);
    expect(result.categories.tickets.total).toBe(0);
    expect(result.withinBudget).toBe(true);
    expect(result.conflicts).toEqual([]);
  });
  it('does not treat unknown price as free, even under a hard limit', () => {
    const result = calculateBudget({ catalog, participants: 2, selections: [{ itemId: 'transit', quantity: 1 }], budget: 100 });
    expect(result.total).toBeNull();
    expect(result.perPerson).toBeNull();
    expect(result.categories.transit.total).toBeNull();
    expect(result.withinBudget).toBeNull();
    expect(result.conflicts).toEqual([{ code: 'unknown-price', itemId: 'transit' }]);
  });
  it('reports an exceeded hard limit even if other prices are unknown', () => {
    const result = calculateBudget({ catalog, participants: 2, selections: [{ itemId: 'food', quantity: 1 }, { itemId: 'transit', quantity: 1 }], budget: 10 });
    expect(result.withinBudget).toBe(false);
    expect(result.conflicts).toContainEqual({ code: 'budget', limit: 10, knownTotal: 12 });
  });
  it('reports missing catalog entries and leaves category totals uncertified', () => {
    const result = calculateBudget({ catalog, participants: 1, selections: [{ itemId: 'missing', quantity: 1 }] });
    expect(result.conflicts).toEqual([{ code: 'unknown-item', itemId: 'missing' }]);
    expect(result.categories.food.total).toBeNull();
    expect(result.total).toBeNull();
  });
  it('validates input rather than inventing values', () => {
    expect(() => calculateBudget({ catalog, participants: 0, selections: [] })).toThrow();
    expect(() => calculateBudget({ catalog, participants: 1, selections: [], budget: -1 })).toThrow();
    expect(() => calculateBudget({ catalog, participants: 1, selections: [{ itemId: 'food', quantity: 0 }] })).toThrow();
    expect(() => calculateBudget({ catalog: [...catalog, catalog[0]], participants: 1, selections: [] })).toThrow();
    expect(() => calculateBudget({ catalog: [{ ...catalog[0], price: NaN }], participants: 1, selections: [] })).toThrow();
  });
});
