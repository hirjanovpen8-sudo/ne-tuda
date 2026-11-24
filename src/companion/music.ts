/** Search suggestions, not a catalogue or a claim that any particular track exists. */
export interface MusicSearchOptions {
  genres?: readonly string[];
  atmosphere?: string;
}

export interface MusicSearchQuery {
  query: string;
  url: string;
}

/** Create one search per distinct genre, optionally qualified by the atmosphere. */
export function createMusicSearchQueries({ genres = [], atmosphere = '' }: MusicSearchOptions): MusicSearchQuery[] {
  const mood = atmosphere.trim().replace(/\s+/gu, ' ');
  const uniqueGenres = new Map<string, string>();
  for (const genre of genres) {
    const normalized = genre.trim().replace(/\s+/gu, ' ');
    if (normalized) uniqueGenres.set(normalized.toLocaleLowerCase('ru-RU'), normalized);
  }
  const queries = uniqueGenres.size
    ? Array.from(uniqueGenres.values(), genre => [genre, mood].filter(Boolean).join(' '))
    : mood ? [mood] : [];
  return queries.map(query => ({
    query,
    url: `https://music.yandex.ru/search?text=${encodeURIComponent(query)}`,
  }));
}

/** Export search phrases as plain text, one per line; no network access or download. */
export function exportMusicSearchQueries(queries: readonly MusicSearchQuery[]): string {
  return queries.map(({ query }) => query.replace(/[\r\n]+/gu, ' ')).join('\n');
}
