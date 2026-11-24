/** Budget calculations use only prices supplied by the caller, in one currency. */
export type BudgetCategory = 'coffee' | 'food' | 'tickets' | 'transit';
export type PriceBasis = 'per-person' | 'group';
export interface CatalogItem {
  id: string;
  category: BudgetCategory;
  /** null means the price is unknown, not free. */
  price: number | null;
  basis: PriceBasis;
}
export interface BudgetSelection { itemId: string; quantity: number }
export interface BudgetOptions {
  catalog: readonly CatalogItem[];
  selections: readonly BudgetSelection[];
  participants: number;
  /** Hard limit for the entire group, in the same currency as the catalog. */
  budget?: number;
}
export type BudgetConflict =
  | { code: 'unknown-item'; itemId: string }
  | { code: 'unknown-price'; itemId: string }
  | { code: 'budget'; limit: number; knownTotal: number };
export interface CategoryBudget { knownTotal: number; total: number | null; unknownCount: number }
export interface BudgetResult {
  participants: number;
  categories: Record<BudgetCategory, CategoryBudget>;
  knownTotal: number;
  total: number | null;
  knownPerPerson: number;
  perPerson: number | null;
  unknownCount: number;
  /** With a hard limit, unknown prices cannot be certified as within budget. */
  withinBudget: boolean | null;
  conflicts: BudgetConflict[];
}

/** Calculates the selected expenses; never assumes a missing price is zero. */
export function calculateBudget({ catalog, selections, participants, budget }: BudgetOptions): BudgetResult {
  if (!Number.isSafeInteger(participants) || participants < 1) throw new RangeError('participants must be a positive safe integer');
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new RangeError('budget must be finite and non-negative');
  const categories: Record<BudgetCategory, CategoryBudget> = {
    coffee: { knownTotal: 0, total: 0, unknownCount: 0 },
    food: { knownTotal: 0, total: 0, unknownCount: 0 },
    tickets: { knownTotal: 0, total: 0, unknownCount: 0 },
    transit: { knownTotal: 0, total: 0, unknownCount: 0 },
  };
  const items = new Map<string, CatalogItem>();
  for (const item of catalog) {
    if (!item.id || items.has(item.id)) throw new RangeError('catalog IDs must be non-empty and unique');
    if (!Object.hasOwn(categories, item.category) || (item.basis !== 'group' && item.basis !== 'per-person')) throw new RangeError('invalid catalog item');
    if (item.price !== null && (!Number.isFinite(item.price) || item.price < 0)) throw new RangeError('price must be null or finite and non-negative');
    items.set(item.id, item);
  }
  const conflicts: BudgetConflict[] = [];
  let knownTotal = 0, unknownCount = 0;
  for (const selection of selections) {
    if (!Number.isSafeInteger(selection.quantity) || selection.quantity < 1) throw new RangeError('quantity must be a positive safe integer');
    const item = items.get(selection.itemId);
    if (!item) {
      unknownCount++;
      // Its category is unknown too, so no category total can be certified exact.
      for (const category of Object.values(categories)) category.total = null;
      conflicts.push({ code: 'unknown-item', itemId: selection.itemId });
      continue;
    }
    const category = categories[item.category];
    if (item.price === null) {
      unknownCount++; category.unknownCount++; category.total = null;
      conflicts.push({ code: 'unknown-price', itemId: item.id });
      continue;
    }
    const amount = item.price * selection.quantity * (item.basis === 'per-person' ? participants : 1);
    if (!Number.isFinite(amount) || !Number.isFinite(knownTotal + amount)) throw new RangeError('budget total exceeds numeric range');
    category.knownTotal += amount;
    if (category.total !== null) category.total += amount;
    knownTotal += amount;
  }
  if (budget !== undefined && knownTotal > budget) conflicts.push({ code: 'budget', limit: budget, knownTotal });
  return {
    participants, categories, knownTotal, total: unknownCount ? null : knownTotal,
    knownPerPerson: knownTotal / participants, perPerson: unknownCount ? null : knownTotal / participants,
    unknownCount, withinBudget: budget === undefined ? null : knownTotal > budget ? false : unknownCount ? null : true,
    conflicts,
  };
}
