/** Pure domain logic. No place catalogue, prices or factual claims are supplied here. */
export type Known<T> = T | null;
export type AttributeValue = string | number | boolean;
export interface Place {
  id: string;
  name: string;
  /** Cost per visitor in the caller's currency; null means not known. */
  cost: Known<number>;
  attributes: Record<string, Known<AttributeValue> | undefined>;
}
export interface Criterion {
  attribute: string;
  value: AttributeValue;
}
export type Match = 'match' | 'mismatch' | 'unknown';
export interface FilterResult {
  place: Place;
  hard: Match[];
  wishes: Match[];
  eligible: boolean;
  wishMatches: number;
  unknownWishes: number;
}
export interface Budget {
  knownTotal: number;
  unknownCount: number;
  /** null means the exact total cannot be determined. */
  total: number | null;
}
export type ConflictCode = 'invalid-input' | 'duplicate-place-id' | 'hard-filter' | 'unknown-hard-filter' | 'budget' | 'unknown-cost' | 'repeat' | 'insufficient-places';
export interface Conflict { code: ConflictCode; placeId?: string; detail?: string }
export interface GenerateOptions {
  places: readonly Place[];
  hard?: readonly Criterion[];
  wishes?: readonly Criterion[];
  /** Maximum sum of per-visitor costs; omitted means unrestricted. */
  budget?: number;
  count: number;
  seed: string | number;
  /** IDs from prior walks. By default these are excluded. */
  previousPlaceIds?: readonly string[];
  allowRepeats?: boolean;
}
export interface Walk {
  places: Place[];
  title: string;
  budget: Budget;
  fingerprint: string;
  conflicts: Conflict[];
}

export function matchCriterion(place: Place, criterion: Criterion): Match {
  const actual = place.attributes[criterion.attribute];
  return actual === null || actual === undefined ? 'unknown' : actual === criterion.value ? 'match' : 'mismatch';
}
export function filterPlaces(places: readonly Place[], hard: readonly Criterion[] = [], wishes: readonly Criterion[] = []): FilterResult[] {
  return places.map(place => {
    const hardMatches = hard.map(c => matchCriterion(place, c));
    const wishResults = wishes.map(c => matchCriterion(place, c));
    return { place, hard: hardMatches, wishes: wishResults, eligible: hardMatches.every(m => m === 'match'), wishMatches: wishResults.filter(m => m === 'match').length, unknownWishes: wishResults.filter(m => m === 'unknown').length };
  });
}
export function calculateBudget(places: readonly Place[]): Budget {
  let knownTotal = 0, unknownCount = 0;
  for (const place of places) {
    if (place.cost === null || !Number.isFinite(place.cost) || place.cost < 0) unknownCount++;
    else knownTotal += place.cost;
  }
  return { knownTotal, unknownCount, total: unknownCount ? null : knownTotal };
}
/** Stable, order-independent identity for a set of place IDs, not a security hash. */
export function fingerprint(placeIds: readonly string[]): string {
  return JSON.stringify([...new Set(placeIds)].sort());
}
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Human-readable title uses supplied names only. */
export function generateTitle(places: readonly Place[]): string {
  return places.length ? places.map(p => p.name).join(' — ') : 'Прогулка';
}
/** Greedy selection: wish matches first, seeded deterministic tie-break, then ID. */
export function generateWalk(options: GenerateOptions): Walk {
  const { places, count, seed, budget, hard = [], wishes = [], previousPlaceIds = [], allowRepeats = false } = options;
  const conflicts: Conflict[] = [];
  const result = (selected: Place[]): Walk => ({ places: selected, title: generateTitle(selected), budget: calculateBudget(selected), fingerprint: fingerprint(selected.map(p => p.id)), conflicts });
  if (!Number.isInteger(count) || count < 0 || (budget !== undefined && (!Number.isFinite(budget) || budget < 0))) {
    conflicts.push({ code: 'invalid-input' });
    return result([]);
  }
  const seen = new Set<string>(), previous = new Set(previousPlaceIds);
  const candidates: FilterResult[] = [];
  for (const entry of filterPlaces(places, hard, wishes)) {
    const { place } = entry;
    if (seen.has(place.id)) { conflicts.push({ code: 'duplicate-place-id', placeId: place.id }); continue; }
    seen.add(place.id);
    if (!entry.eligible) {
      if (entry.hard.includes('mismatch')) conflicts.push({ code: 'hard-filter', placeId: place.id });
      if (entry.hard.includes('unknown')) conflicts.push({ code: 'unknown-hard-filter', placeId: place.id });
      continue;
    }
    if (!allowRepeats && previous.has(place.id)) { conflicts.push({ code: 'repeat', placeId: place.id }); continue; }
    if (budget !== undefined && (place.cost === null || !Number.isFinite(place.cost) || place.cost < 0)) { conflicts.push({ code: 'unknown-cost', placeId: place.id }); continue; }
    candidates.push(entry);
  }
  candidates.sort((a, b) => b.wishMatches - a.wishMatches || hash(JSON.stringify([String(seed), a.place.id])) - hash(JSON.stringify([String(seed), b.place.id])) || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0));
  const selected: Place[] = [];
  let spent = 0;
  for (const { place } of candidates) {
    if (selected.length >= count) break;
    if (budget !== undefined && spent + (place.cost as number) > budget) { conflicts.push({ code: 'budget', placeId: place.id }); continue; }
    selected.push(place);
    if (place.cost !== null && Number.isFinite(place.cost) && place.cost >= 0) spent += place.cost;
  }
  if (selected.length < count) conflicts.push({ code: 'insufficient-places', detail: `${selected.length}/${count}` });
  return result(selected);
}
