import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_COMPANION_SETTINGS,
  getCompanionPhrase,
  speakCompanionPhrase,
  type Boldness,
  type CompanionSettings,
} from '../companion/assistant';
import { createMusicSearchQueries, exportMusicSearchQueries } from '../companion/music';
import './companion.css';

const STORAGE_KEY = 'ne-tuda:companion-settings';

function loadSettings(): CompanionSettings {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_COMPANION_SETTINGS };
    const value = saved as Partial<CompanionSettings>;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_COMPANION_SETTINGS.enabled,
      boldness: value.boldness === 'soft' || value.boldness === 'witty' || value.boldness === 'bold' ? value.boldness : DEFAULT_COMPANION_SETTINGS.boldness,
      allowProfanity: typeof value.allowProfanity === 'boolean' ? value.allowProfanity : DEFAULT_COMPANION_SETTINGS.allowProfanity,
      voiceEnabled: typeof value.voiceEnabled === 'boolean' ? value.voiceEnabled : DEFAULT_COMPANION_SETTINGS.voiceEnabled,
    };
  } catch {
    return { ...DEFAULT_COMPANION_SETTINGS };
  }
}

export interface CompanionPanelProps {
  /** Called on mount and whenever the settings change, for the host's route events. */
  onSettingsChange?: (settings: CompanionSettings) => void;
}

/** Standalone panel; render inside .walk-app to inherit its theme. */
export function CompanionPanel({ onSettingsChange }: CompanionPanelProps) {
  const [settings, setSettings] = useState<CompanionSettings>(loadSettings);
  const [genres, setGenres] = useState('');
  const [atmosphere, setAtmosphere] = useState('');
  const [speechError, setSpeechError] = useState(false);
  const queries = useMemo(() => createMusicSearchQueries({ genres: genres.split(','), atmosphere }), [genres, atmosphere]);
  const greeting = getCompanionPhrase({ type: 'greeting' }, settings);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Storage can be unavailable. */ }
    onSettingsChange?.(settings);
  }, [settings, onSettingsChange]);

  function update<K extends keyof CompanionSettings>(key: K, value: CompanionSettings[K]) {
    setSettings(current => ({ ...current, [key]: value }));
  }

  function exportQueries() {
    const text = exportMusicSearchQueries(queries);
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'music-search.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="companion-panel" aria-label="Умнай и музыка">
      <header className="companion-header">
        <div><p className="companion-eyebrow">ПОПУТЧИК</p><h2>Умнай</h2></div>
        <span aria-hidden="true" className="companion-mark">✳</span>
      </header>
      <p className="companion-greeting" aria-live="polite">{greeting ?? 'Комментарии Умная выключены.'}</p>
      <div className="companion-settings">
        <label className="companion-toggle"><span>Комментарии Умная</span><input type="checkbox" checked={settings.enabled} onChange={event => update('enabled', event.target.checked)} /></label>
        <label className="companion-field"><span>Уровень дерзости</span>
          <select value={settings.boldness} onChange={event => update('boldness', event.target.value as Boldness)}>
            <option value="soft">Мягкий</option><option value="witty">Остроумный</option><option value="bold">Дерзкий</option>
          </select>
        </label>
        <label className="companion-toggle"><span>Разрешить мат</span><input type="checkbox" checked={settings.allowProfanity} onChange={event => update('allowProfanity', event.target.checked)} /></label>
        <p className="companion-hint">Мат используется только на дерзком уровне. Навигационные инструкции не меняются.</p>
        <label className="companion-toggle"><span>Голос Умная</span><input type="checkbox" checked={settings.voiceEnabled} onChange={event => { update('voiceEnabled', event.target.checked); setSpeechError(false); }} /></label>
        <p className="companion-hint">Голос Умная и голос навигации — отдельные настройки. Этот переключатель не управляет голосом навигации.</p>
        {settings.voiceEnabled && greeting && <button type="button" className="companion-button" onClick={() => setSpeechError(!speakCompanionPhrase(greeting, settings))}>Послушать приветствие</button>}
        {speechError && <p className="companion-hint" role="status">Озвучивание недоступно в этом браузере.</p>}
      </div>
      <div className="companion-music">
        <p className="companion-eyebrow">САУНДТРЕК ПРОГУЛКИ</p><h3>Поиск в Яндекс Музыке</h3>
        <p className="companion-hint">Подготовим поисковые запросы, а не рекомендации конкретных треков. Ссылки откроются только по вашему нажатию.</p>
        <label className="companion-field"><span>Жанры через запятую</span><input type="text" value={genres} onChange={event => setGenres(event.target.value)} placeholder="Например, джаз, электроника" /></label>
        <label className="companion-field"><span>Атмосфера (необязательно)</span><input type="text" value={atmosphere} onChange={event => setAtmosphere(event.target.value)} placeholder="Например, вечерняя прогулка" /></label>
        {queries.length > 0 && <ul className="companion-links">{queries.map(({ query, url }) => <li key={query}><a href={url} target="_blank" rel="noopener noreferrer">{query} ↗</a></li>)}</ul>}
        <button type="button" className="companion-button" disabled={!queries.length} onClick={exportQueries}>Скачать запросы текстом</button>
      </div>
    </section>
  );
}

export default CompanionPanel;
