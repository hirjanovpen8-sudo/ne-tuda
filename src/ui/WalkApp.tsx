import React, { useId, useState } from 'react';
import type { ReactNode } from 'react';
import './walk.css';
import { CompanionPanel } from './CompanionPanel';
import { CatalogPanel } from './CatalogPanel';
import type { Coordinate } from '../services/providers';

export type ConnectionStatus = 'online' | 'offline' | 'unknown';
export type GpsStatus = 'available' | 'requesting' | 'denied' | 'unavailable' | 'unknown';
export type RouteStatus = 'empty' | 'loading' | 'ready' | 'error';
export type NavigationStatus = 'idle' | 'active' | 'paused' | 'finished';
export interface WalkOption { value: string; label: string }
export interface WalkSettings {
  ring: boolean;
  lengthMeters: number;
  participants: number;
  /** Total budget in rubles; zero means free. */
  budgetRub: number;
  stops: number;
  pace: string;
  atmosphere: string[];
  restrictions: string[];
}
export interface WalkSettingsOptions {
  pace: WalkOption[];
  atmosphere: WalkOption[];
  restrictions: WalkOption[];
}
export interface WalkRoute {
  title: string;
  distanceKm: number;
  durationMinutes: number;
  description?: string;
  /** Actual stops supplied by the route provider. */
  stops?: string[];
}
export interface WalkAppProps {
  settings: WalkSettings;
  /** Only choices supported by the host route provider should be supplied. */
  settingsOptions: WalkSettingsOptions;
  onSettingsChange: (settings: WalkSettings) => void;
  routeStatus: RouteStatus;
  route?: WalkRoute | null;
  routeError?: string;
  onBuildRoute: () => void;
  navigationStatus: NavigationStatus;
  onStartNavigation: () => void;
  onPauseNavigation: () => void;
  onResumeNavigation: () => void;
  onFinishNavigation: () => void;
  navigationInstruction?: string;
  onAcknowledgeStep?: () => void;
  /** Route completion as a percentage from 0 to 100. */
  navigationProgress?: number;
  voiceEnabled?: boolean;
  onVoiceChange?: (enabled: boolean) => void;
  connection: ConnectionStatus;
  gps: GpsStatus;
  onRequestGps?: () => void;
  /** Host-provided map; the UI does not load maps or access location itself. */
  map?: ReactNode;
  warning?: string;
  start: Coordinate | null;
  routingConsent: boolean;
  onRoutingConsentChange: (consent: boolean) => void;
}

const gpsText: Record<GpsStatus, string> = {
  available: 'Геолокация включена', requesting: 'Определяем геопозицию', denied: 'Доступ к геопозиции запрещён',
  unavailable: 'Геопозиция недоступна', unknown: 'Геопозиция не определена',
};
const connectionText: Record<ConnectionStatus, string> = {
  online: 'В сети', offline: 'Нет сети', unknown: 'Сеть не проверена',
};
const navigationText: Record<NavigationStatus, string> = {
  idle: 'Ещё не начата', active: 'Прогулка идёт', paused: 'Прогулка на паузе', finished: 'Прогулка завершена',
};

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true" className="walk-arrow">{diagonal ? '↗' : '→'}</span>;
}

export function WalkApp(props: WalkAppProps) {
  const { settings, settingsOptions, onSettingsChange, routeStatus, route, routeError, navigationStatus, connection, gps, map, warning } = props;
  const id = useId();
  const [light, setLight] = useState(() => {
    try { return localStorage.getItem('walk-theme') === 'light'; } catch { return false; }
  });
  const toggleTheme = () => setLight(current => {
    const next = !current;
    try { localStorage.setItem('walk-theme', next ? 'light' : 'dark'); } catch { /* Storage may be unavailable. */ }
    return next;
  });
  const update = (patch: Partial<WalkSettings>) => onSettingsChange({ ...settings, ...patch });
  const hasRoute = routeStatus === 'ready' && !!route;
  const navigationInProgress = navigationStatus === 'active' || navigationStatus === 'paused';
  const validSettings = Number.isFinite(settings.lengthMeters) && settings.lengthMeters >= 1000 && settings.lengthMeters <= 30000 && Number.isInteger(settings.participants) && settings.participants >= 1 && Number.isFinite(settings.budgetRub) && settings.budgetRub >= 0 && Number.isInteger(settings.stops) && settings.stops >= 0;
  const canBuild = routeStatus !== 'loading' && !navigationInProgress && validSettings;
  const toggleOption = (key: 'atmosphere' | 'restrictions', value: string) => update({ [key]: settings[key].includes(value) ? settings[key].filter(item => item !== value) : [...settings[key], value] });
  const km = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);

  return <div className={`walk-app${light ? ' walk-light' : ''}`}>
    <div className="walk-shell">
      <header className="walk-header">
        <a className="walk-brand" href="#walk-main" aria-label="Не туда — к содержимому"><span className="walk-brand-mark" aria-hidden="true">↗</span><span>не туда<span className="walk-brand-dot">.</span></span></a>
        <span className="walk-header-place">ОМСК <span aria-hidden="true">/</span> ПРОГУЛКИ</span>
        <div className="walk-header-status"><span className={`walk-status-dot ${connection === 'online' ? 'is-online' : ''}`} />{connectionText[connection]}</div>
        <button className="walk-theme-toggle" type="button" onClick={toggleTheme} aria-label={light ? 'Включить тёмную тему' : 'Включить светлую тему'} aria-pressed={light}>{light ? '☾' : '☀'} <span>{light ? 'Тёмная' : 'Светлая'}</span></button>
      </header>

      <main id="walk-main">
        <section className="walk-intro" aria-labelledby={`${id}-title`}>
          <div><p className="walk-eyebrow"><span className="walk-small-dot" /> ГОРОД БЛИЖЕ, ЧЕМ КАЖЕТСЯ</p>
            <h1 id={`${id}-title`}>Пойдём<br /><em>не туда.</em></h1>
            <p className="walk-lead">Знакомые улицы, незнакомые повороты. Соберите прогулку под своё настроение.</p>
          </div>
          <div className="walk-art" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}art-reference.png`} alt="" />
            <div className="walk-art-overlay" />
            <span className="walk-art-coordinate">55° С. Ш. / 73° В. Д.</span>
            <span className="walk-art-stamp">✳</span>
            <span className="walk-art-caption">ОМСК<br />ВАША ТОЧКА НА КАРТЕ</span>
          </div>
        </section>

        <div className="walk-grid">
          <section className="walk-panel walk-settings" aria-labelledby={`${id}-settings`}>
            <div className="walk-section-head"><div><p className="walk-index">01 / НАСТРОЙКИ</p><h2 id={`${id}-settings`}>Какая прогулка?</h2></div><span className="walk-head-icon" aria-hidden="true">↗</span></div>
            <p className="walk-panel-copy">Пара деталей — и можно отправляться.</p>
            <div className="walk-form">
              <div className="walk-field walk-ring"><div><label htmlFor={`${id}-ring`}>Кольцевой маршрут</label><p>Вернуться к точке старта</p></div><input id={`${id}-ring`} type="checkbox" checked={settings.ring} onChange={e => update({ ring: e.target.checked })} /><label className="walk-switch" htmlFor={`${id}-ring`}><span className="walk-sr-only">Кольцевой маршрут</span></label></div>
              <div className="walk-field"><div className="walk-label-row"><label htmlFor={`${id}-length-number`}>Длина прогулки, м</label><input className="walk-number" id={`${id}-length-number`} type="number" min="1000" max="30000" step="100" value={Number.isFinite(settings.lengthMeters) ? settings.lengthMeters : ''} onChange={e => update({ lengthMeters: e.target.value === '' ? NaN : e.target.valueAsNumber })} /></div><input className="walk-range" aria-label="Длина прогулки, ползунок в метрах" type="range" min="1000" max="30000" step="100" value={Number.isFinite(settings.lengthMeters) ? Math.max(1000, Math.min(30000, settings.lengthMeters)) : 1000} onChange={e => update({ lengthMeters: e.target.valueAsNumber })} /><div className="walk-range-labels"><span>1 000 М</span><span>30 000 М</span></div></div>
              <div className="walk-field walk-label-row"><label htmlFor={`${id}-people`}>Участники, чел.</label><input className="walk-number" id={`${id}-people`} type="number" min="1" step="1" value={Number.isFinite(settings.participants) ? settings.participants : ''} onChange={e => update({ participants: e.target.value === '' ? NaN : e.target.valueAsNumber })} /></div>
              <div className="walk-field walk-label-row"><label htmlFor={`${id}-budget`}>Общий бюджет, ₽<span className="walk-field-hint">0 — бесплатно</span></label><input className="walk-number" id={`${id}-budget`} type="number" min="0" step="1" value={Number.isFinite(settings.budgetRub) ? settings.budgetRub : ''} onChange={e => update({ budgetRub: e.target.value === '' ? NaN : e.target.valueAsNumber })} /></div>
              <div className="walk-field walk-label-row"><label htmlFor={`${id}-stops`}>Количество остановок</label><input className="walk-number" id={`${id}-stops`} type="number" min="0" step="1" value={Number.isFinite(settings.stops) ? settings.stops : ''} onChange={e => update({ stops: e.target.value === '' ? NaN : e.target.valueAsNumber })} /></div>
              {settingsOptions.pace.length > 0 && <div className="walk-field"><label htmlFor={`${id}-pace`}>Темп</label><div className="walk-select-wrap"><select id={`${id}-pace`} value={settings.pace} onChange={e => update({ pace: e.target.value })}><option value="">Не важно</option>{settingsOptions.pace.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span aria-hidden="true">⌄</span></div></div>}
              {(['atmosphere', 'restrictions'] as const).map(key => settingsOptions[key].length > 0 && <fieldset className="walk-field" key={key}><legend>{key === 'atmosphere' ? 'Атмосфера' : 'Ограничения'}</legend><div className="walk-options">{settingsOptions[key].map(option => <label className={`walk-option ${settings[key].includes(option.value) ? 'is-selected' : ''}`} key={option.value}><input type="checkbox" checked={settings[key].includes(option.value)} onChange={() => toggleOption(key, option.value)} />{option.label}</label>)}</div></fieldset>)}
              {!validSettings && <p className="walk-hint" role="status">Укажите длину от 1 000 до 30 000 м, хотя бы одного участника, неотрицательный бюджет и целое число остановок.</p>}
              <label className="walk-consent"><input type="checkbox" checked={props.routingConsent} onChange={e => props.onRoutingConsentChange(e.target.checked)} /> Разрешаю отправить координаты старта и промежуточных точек внешнему сервису маршрутизации FOSSGIS. <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">Как используются данные</a></label>
              <button className="walk-primary" type="button" onClick={props.onBuildRoute} disabled={!canBuild || !props.routingConsent}>{routeStatus === 'loading' ? 'Ищем маршрут…' : 'Собрать маршрут'} <Arrow /></button>
              {navigationInProgress && <p className="walk-hint">Завершите текущую прогулку, чтобы собрать новую.</p>}
            </div>
          </section>

          <section className="walk-panel walk-route-panel" aria-labelledby={`${id}-route`}>
            <div className="walk-section-head"><div><p className="walk-index">02 / ВАШ МАРШРУТ</p><h2 id={`${id}-route`}>Время гулять</h2></div><span className="walk-head-icon" aria-hidden="true">⌁</span></div>
            <p className="walk-panel-copy">{hasRoute ? 'Пешеходный путь найден по данным маршрутизатора.' : 'Маршрут появится здесь после поиска.'}</p>
            <div className="walk-map" aria-label="Область карты">{map ?? <div className="walk-map-empty"><span className="walk-map-pin" aria-hidden="true">✳</span><strong>Здесь будет карта</strong><span>Подключите карту, чтобы увидеть маршрут.</span></div>}<span className="walk-map-tag">ОМСК · РОССИЯ</span></div>
            <div className="walk-system-status" aria-label="Состояние подключения и геолокации"><span><i className={`walk-status-dot ${connection === 'online' ? 'is-online' : ''}`} />{connectionText[connection]}</span><span><i className={`walk-status-dot ${gps === 'available' ? 'is-online' : ''}`} />{gpsText[gps]}</span>{props.onRequestGps && gps !== 'available' && gps !== 'requesting' && <button type="button" className="walk-text-button" onClick={props.onRequestGps}>Включить GPS ↗</button>}</div>
            {connection === 'offline' && <p className="walk-notice">Нет подключения к сети. Поиск и карта могут быть недоступны; проверьте соединение.</p>}
            {gps === 'denied' && <p className="walk-notice">Разрешите доступ к геопозиции в настройках браузера или устройства, чтобы определять ваше положение.</p>}
            {warning && <p className="walk-notice"><strong>Важно. </strong>{warning}</p>}
            <div className="walk-result" aria-live="polite" aria-busy={routeStatus === 'loading'}>
              {routeStatus === 'loading' ? <div className="walk-empty"><span className="walk-empty-icon" aria-hidden="true">⌁</span><h3>Ищем путь</h3><p>Подбираем прогулку по вашим настройкам.</p></div> :
              routeStatus === 'error' ? <div className="walk-empty"><span className="walk-empty-icon" aria-hidden="true">!</span><h3>Не получилось построить маршрут</h3><p>{routeError || 'Попробуйте изменить настройки или повторить поиск.'}</p></div> :
              hasRoute && route ? <div className="walk-route-details"><div className="walk-route-top"><div><p className="walk-index">МАРШРУТ ГОТОВ</p><h3>{route.title}</h3></div><span className="walk-route-symbol" aria-hidden="true">↗</span></div><div className="walk-metrics"><div><strong>{km(route.distanceKm)} <small>км</small></strong><span>РАССТОЯНИЕ</span></div><div><strong>{route.durationMinutes} <small>мин</small></strong><span>ПРИМЕРНО В ПУТИ</span></div></div>{route.description && <p>{route.description}</p>}{route.stops && route.stops.length > 0 && <ol className="walk-stops">{route.stops.map((stop, index) => <li key={`${index}-${stop}`}>{stop}</li>)}</ol>}</div> : <div className="walk-empty"><span className="walk-empty-icon" aria-hidden="true">↗</span><h3>Пока здесь тихо</h3><p>{routeStatus === 'ready' ? 'Данные маршрута недоступны. Попробуйте построить его снова.' : 'Выберите настройки и соберите маршрут — он появится здесь.'}</p></div>}
            </div>
            {navigationInProgress && (props.navigationInstruction || (props.navigationProgress != null && Number.isFinite(props.navigationProgress))) && <div className="walk-guidance" aria-live="polite">{props.navigationInstruction && <p>{props.navigationInstruction}</p>}{props.onAcknowledgeStep && <button type="button" className="walk-secondary" onClick={props.onAcknowledgeStep}>Манёвр выполнен — следующее указание</button>}{props.navigationProgress != null && Number.isFinite(props.navigationProgress) && <><label htmlFor={`${id}-progress`}>Пройдено: {Math.round(Math.max(0, Math.min(100, props.navigationProgress)))}%</label><progress id={`${id}-progress`} max="100" value={Math.max(0, Math.min(100, props.navigationProgress))} /></>}</div>}
            {props.onVoiceChange && <div className="walk-voice"><label htmlFor={`${id}-voice`}>Голосовые подсказки</label><input id={`${id}-voice`} type="checkbox" checked={!!props.voiceEnabled} onChange={e => props.onVoiceChange?.(e.target.checked)} /></div>}
            <div className="walk-navigation"><div><p className="walk-index">НАВИГАЦИЯ</p><strong>{navigationText[navigationStatus]}</strong></div><div className="walk-nav-actions">{navigationStatus === 'active' ? <><button type="button" className="walk-secondary" onClick={props.onPauseNavigation}>Пауза</button><button type="button" className="walk-text-button" onClick={props.onFinishNavigation}>Завершить</button></> : navigationStatus === 'paused' ? <><button type="button" className="walk-secondary" onClick={props.onResumeNavigation}>Продолжить <Arrow /></button><button type="button" className="walk-text-button" onClick={props.onFinishNavigation}>Завершить</button></> : <button type="button" className="walk-secondary" onClick={props.onStartNavigation} disabled={!hasRoute}>Начать <Arrow /></button>}</div></div>
          </section>
        </div>
        <CatalogPanel start={props.start} />
        <CompanionPanel />
        <div className="walk-bottom-note"><span>ИДИТЕ В СВОЁМ ТЕМПЕ</span><span>ГОРОД ПОДОЖДЁТ <Arrow diagonal /></span></div>
      </main>
      <footer className="walk-footer"><span>НЕ ТУДА<span className="walk-brand-dot">.</span> / ОМСК</span><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Исправить карту ↗</a></footer>
    </div>
  </div>;
}

export default WalkApp;
