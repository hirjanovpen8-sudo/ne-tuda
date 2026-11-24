/** Facts supplied by the caller; place tags must come from a known data source. */
export interface RouteTitleFacts {
  /** Actual route length in metres. */
  distanceMeters: number;
  /** Planned time of day, if known; never inferred from the current clock. */
  timeOfDay?: 'morning' | 'day' | 'evening' | 'night';
  /** Whether the route returns to its starting point, if known. */
  returnsToStart?: boolean;
  /** Source-confirmed place categories encountered on the route. */
  placeTags?: readonly ('park' | 'square' | 'water' | 'architecture' | 'historic')[];
  seed: string | number;
}

export interface RouteTitle { title: string; description: string }

/** Pure, deterministic Russian copy. Unknown facts are omitted rather than guessed. */
export function createRouteTitle(facts: RouteTitleFacts): RouteTitle {
  if (!Number.isFinite(facts.distanceMeters) || facts.distanceMeters <= 0 ||
      (typeof facts.seed !== 'string' && (typeof facts.seed !== 'number' || !Number.isFinite(facts.seed)))) {
    throw new Error('Invalid route title facts');
  }
  let hash = 2166136261;
  for (const char of String(facts.seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const variant = (hash >>> 0) % 4;
  const distance = facts.distanceMeters < 1000
    ? `${Math.max(1, Math.round(facts.distanceMeters))} м`
    : `${(Math.round(facts.distanceMeters / 100) / 10).toFixed(1).replace('.', ',')} км`;
  const times = { morning: 'утром', day: 'днём', evening: 'вечером', night: 'ночью' } as const;
  const time = facts.timeOfDay && times[facts.timeOfDay];
  const titles = [`Маршрут на ${distance}`, `Прогулка на ${distance}`, `${distance} пешком`, `Путь на ${distance}`];
  const details = [distance];
  if (time) details.push(time);
  if (facts.returnsToStart === true) details.push('с возвращением к началу');
  // Only these exact categories are recognized, and each requires an explicit tag.
  const labels = { park: 'парк', square: 'площадь', water: 'вода', architecture: 'архитектура', historic: 'историческое место' } as const;
  const places = (Object.keys(labels) as (keyof typeof labels)[]).filter(tag => facts.placeTags?.includes(tag)).map(tag => labels[tag]);
  if (places.length) details.push(`места по данным источника: ${places.join(', ')}`);
  return { title: titles[variant], description: `${details.join(' · ')}.` };
}
