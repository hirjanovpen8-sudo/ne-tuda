import { describe, expect, it } from 'vitest';
import { createMusicSearchQueries, exportMusicSearchQueries } from '../../src/companion/music';

describe('music search', () => {
  it('forms encoded search links from genres and atmosphere, without fabricated tracks', () => {
    const searches = createMusicSearchQueries({ genres: ['джаз', 'рок & ролл', 'ДЖАЗ'], atmosphere: 'ночной город' });
    expect(searches.map(x => x.query)).toEqual(['ДЖАЗ ночной город', 'рок & ролл ночной город']);
    for (const item of searches) {
      const url = new URL(item.url);
      expect(url.origin).toBe('https://music.yandex.ru');
      expect(url.searchParams.get('text')).toBe(item.query);
    }
    expect(exportMusicSearchQueries(searches)).toBe('ДЖАЗ ночной город\nрок & ролл ночной город');
  });
  it('handles mood alone and empty input', () => {
    expect(createMusicSearchQueries({ atmosphere: ' дождь  дома ' })[0].query).toBe('дождь дома');
    expect(createMusicSearchQueries({ genres: [' ', ''] })).toEqual([]);
    expect(exportMusicSearchQueries([])).toBe('');
  });
});
