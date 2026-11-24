import { useEffect, useRef, useState } from 'react';
import WalkApp from './ui/WalkApp';
import type { WalkSettings, GpsStatus, NavigationStatus, RouteStatus, WalkRoute } from './ui/WalkApp';
import { isInsideOmsk, planLoop, type Coordinate } from './planner';
import { ProviderError } from './services/providers';
import { createRateLimiter } from './services/rateLimit';
const scheduleRouting = createRateLimiter();
import MapView from './MapView';
import { type Fix } from './navigation';
import { locateSteps, initialGuidanceState, updateGuidance, acknowledgeStep, type GuidanceStep, type LocatedStep, type GuidanceState } from './navigation/guidance';
import './app.css';

const defaults: WalkSettings = { ring: true, lengthMeters: 3000, participants: 1, budgetRub: 0, stops: 0, pace: '', atmosphere: [], restrictions: [] };
const options = { pace: [], atmosphere: [], restrictions: [] };
const settingsKey = 'ne-tuda-settings-v1', historyKey = 'ne-tuda-history-v1';
type Result = { geometry: Coordinate[]; distance: number; duration: number; steps: GuidanceStep[] | null; incomplete: boolean };
const navPoint = (p: Coordinate) => ({ lon: p[0], lat: p[1] });
function command(type: string, modifier: string): string | null {
  const directions: Record<string, string> = { left: 'налево', right: 'направо', 'slight left': 'плавно налево', 'slight right': 'плавно направо', 'sharp left': 'резко налево', 'sharp right': 'резко направо', straight: 'прямо', uturn: 'развернитесь' };
  const d = directions[modifier];
  if (type === 'arrive') return 'Вы приближаетесь к концу маршрута';
  if (type === 'depart') return 'Начните движение по маршруту';
  if (type === 'roundabout' || type === 'rotary') return 'Двигайтесь по круговому перекрёстку';
  if (type === 'exit roundabout' || type === 'exit rotary') return 'Съезжайте с кругового перекрёстка';
  if (type === 'turn' || type === 'continue' || type === 'new name' || type === 'fork' || type === 'end of road' || type === 'merge' || type === 'on ramp' || type === 'off ramp') return d === 'развернитесь' ? 'Развернитесь' : d ? `Двигайтесь ${d}` : null;
  return null;
}
function load<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function validPoint(value: unknown): value is Coordinate { return Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90; }
function loadSettings(): WalkSettings { const s = load<Partial<WalkSettings> | null>(settingsKey, null); if (!s || typeof s !== 'object') return defaults; return { ...defaults, ring: typeof s.ring === 'boolean' ? s.ring : true, lengthMeters: typeof s.lengthMeters === 'number' && Number.isFinite(s.lengthMeters) && s.lengthMeters >= 1000 && s.lengthMeters <= 30000 ? s.lengthMeters : defaults.lengthMeters, participants: Number.isInteger(s.participants) && s.participants! >= 1 ? s.participants! : 1, budgetRub: typeof s.budgetRub === 'number' && Number.isFinite(s.budgetRub) && s.budgetRub >= 0 ? s.budgetRub : 0, stops: Number.isInteger(s.stops) && s.stops! >= 0 ? s.stops! : 0, restrictions: Array.isArray(s.restrictions) && s.restrictions.every(x => typeof x === 'string') ? s.restrictions : [] }; }
function loadHistory(): Coordinate[][] { const h = load<unknown>(historyKey, []); return Array.isArray(h) ? h.filter((g): g is Coordinate[] => Array.isArray(g) && g.length >= 2 && g.length < 100000 && g.every(validPoint)).slice(-10) : []; }
async function routedFoot(waypoints: readonly Coordinate[], signal: AbortSignal): Promise<Result> {
  const coordinates = waypoints.map(p => `${p[0]},${p[1]}`).join(';');
  const response = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`, { signal });
  if (!response.ok) throw new ProviderError('routing', `HTTP ${response.status}`, response.status);
  const data = await response.json(); const route = data?.routes?.[0];
  if (data?.code !== 'Ok' || !route || !Number.isFinite(route.distance) || route.distance <= 0 || !Number.isFinite(route.duration) || route.duration < 0 || route.geometry?.type !== 'LineString' || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2 || !route.geometry.coordinates.every(validPoint)) throw new ProviderError('routing', 'Некорректный ответ или маршрут не найден');
  const steps: GuidanceStep[] = [];
  let incomplete = false, valid = Array.isArray(route.legs) && route.legs.length > 0;
  if (valid) for (const leg of route.legs) {
    if (!Array.isArray(leg?.steps) || !leg.steps.length) { valid = false; continue; }
    for (const step of leg.steps) {
      const location = step?.maneuver?.location, type = step?.maneuver?.type, modifier = step?.maneuver?.modifier;
      const instruction = typeof type === 'string' ? command(type, typeof modifier === 'string' ? modifier : '') : null;
      if (!validPoint(location)) { valid = false; continue; }
      if (!instruction) incomplete = true;
      steps.push({ coordinate: navPoint(location), instruction: instruction ?? 'Неизвестный манёвр: остановитесь и проверьте маршрут по карте и дорожным знакам' });
    }
  }
  return { geometry: route.geometry.coordinates, distance: route.distance, duration: route.duration, steps: valid && steps.length ? steps : null, incomplete: incomplete || !valid || !steps.length };
}
export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [history, setHistory] = useState(loadHistory);
  const [start, setStart] = useState<Coordinate | null>(null);
  const [geometry, setGeometry] = useState<Coordinate[] | null>(null);
  const [route, setRoute] = useState<WalkRoute | null>(null);
  const [status, setStatus] = useState<RouteStatus>('empty');
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState('');
  const [gps, setGps] = useState<GpsStatus>('unknown');
  const [navigation, setNavigation] = useState<NavigationStatus>('idle');
  const [steps, setSteps] = useState<LocatedStep[] | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [guidance, setGuidance] = useState<GuidanceState>(initialGuidanceState);
  const [fixStatus, setFixStatus] = useState<'waiting' | 'accepted' | 'invalid-fix' | 'off-route' | 'ambiguous'>('waiting');
  const [position, setPosition] = useState<Coordinate | null>(null);
  const [navWarning, setNavWarning] = useState('');
  const [voice, setVoice] = useState(false);
  // Consent is intentionally session-only, never inferred from geolocation permission.
  const [routingConsent, setRoutingConsent] = useState(false);
  const guidanceRef = useRef<GuidanceState>(initialGuidanceState());
  const spoken = useRef('');
  const [online, setOnline] = useState(navigator.onLine);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const gpsGeneration = useRef(0);
  const [storageError, setStorageError] = useState('');
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); generation.current++; gpsGeneration.current++; request.current?.abort(); }; }, []);
  useEffect(() => { try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { setStorageError('Локальное хранилище недоступно: настройки или история могут не сохраниться.'); } }, [settings]);
  useEffect(() => { try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch { setStorageError('Локальное хранилище недоступно: настройки или история могут не сохраниться.'); } }, [history]);
  function invalidate() { generation.current++; gpsGeneration.current++; setGps(current => current === 'requesting' ? 'unknown' : current); request.current?.abort(); setGeometry(null); setRoute(null); setSteps(null); setIncomplete(false); setPosition(null); guidanceRef.current = initialGuidanceState(); setGuidance(guidanceRef.current); setFixStatus('waiting'); setNavWarning(''); spoken.current = '';  setStatus('empty'); setError(''); setNavigation('idle'); }
  function selectStart(point: Coordinate) { invalidate(); setStart(point); }
  function requestGps() {
    if (navigation === 'active' || navigation === 'paused') return;
    if (!navigator.geolocation) { setGps('unavailable'); return; }
    const id = ++gpsGeneration.current;
    setGps('requesting'); navigator.geolocation.getCurrentPosition(p => { if (id !== gpsGeneration.current) return; setGps('available'); selectStart([p.coords.longitude, p.coords.latitude]); }, e => { if (id !== gpsGeneration.current) return; setGps(e.code === 1 ? 'denied' : 'unavailable'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  async function build() {
    invalidate();
    if (!routingConsent) { setError('Для построения необходимо разрешить передачу координат маршрутному сервису.'); setStatus('error'); return; }
    if (!start) { setError('Выберите старт нажатием на карту или с помощью GPS.'); setStatus('error'); return; }
    if (!isInsideOmsk(start)) { setError('Старт вне ограниченной области планировщика в Омске. Это не официальная граница города.'); setStatus('error'); return; }
    if (!settings.ring) { setError('Сейчас поддерживается только кольцевой маршрут. Включите кольцо.'); setStatus('error'); return; }
    if (settings.restrictions.length || settings.stops > 0) { setError('Проверка ограничений и подбор остановок пока не поддерживаются. Снимите ограничения и укажите 0 остановок.'); setStatus('error'); return; }
    const controller = new AbortController(); request.current = controller; const id = generation.current;
    setStatus('loading'); setError('');
    const results = new Map<string, Result>();
    try {
      const planned = await planLoop({ start, distance: settings.lengthMeters, seed: `${Date.now()}-${Math.random()}`, previousRoutes: history, attempts: 6, tolerance: 0.3, route: async points => { const r = await scheduleRouting(() => routedFoot(points, controller.signal), controller.signal); results.set(JSON.stringify(points), r); return r; } });
      if (id !== generation.current) return;
      const r = results.get(JSON.stringify(planned.waypoints)); if (!r) throw new Error('Нет данных выбранного маршрута');
      const g = planned.geometry.map(p => [p[0], p[1]] as Coordinate);
      let located: LocatedStep[] | null = null;
      try { if (r.steps) located = locateSteps(g.map(navPoint), r.steps); } catch { /* Never present a partially located set as complete. */ }
      const partial = r.incomplete || !located;
      setGeometry(g); setSteps(located); setIncomplete(partial); setRoute({ title: 'Прогулка по кругу', distanceKm: planned.distance / 1000, durationMinutes: Math.max(1, Math.round(r.duration / 60)), description: `Пешеходный маршрут; длина может отличаться от заданной до 30%. ${partial ? 'Пошаговые указания неполны или ненадёжны; сверяйтесь с картой и знаками.' : `Получено указаний от сервиса: ${located?.length}.`}` });
      setStatus('ready');
    } catch (e) { if (id !== generation.current) return; setError(e instanceof ProviderError ? `Ошибка маршрутного сервиса: ${e.message}` : e instanceof Error ? `Не удалось построить маршрут: ${e.message}` : 'Маршрут не найден.'); setStatus('error'); }
  }
  useEffect(() => {
    if (navigation !== 'active' || !geometry) return;
    if (!navigator.geolocation) { setGps('unavailable'); setNavWarning('Геолокация недоступна.'); return; }
    let live = true;
    const points = geometry.map(navPoint);
    setFixStatus('waiting');
    setNavWarning('Ожидаем точное местоположение.');
    const watch = navigator.geolocation.watchPosition(p => {
      if (!live) return;
      const fix: Fix = { coordinate: { lat: p.coords.latitude, lon: p.coords.longitude }, timestamp: p.timestamp, accuracy: p.coords.accuracy };
      try {
        const result = updateGuidance(points, steps ?? [], guidanceRef.current, fix);
        setFixStatus(result.status);
        if (result.status !== 'accepted') {
          setNavWarning(result.status === 'off-route' ? 'Не удалось привязать положение к маршруту: возможно, вы отклонились. Автоматического перестроения нет.' : result.status === 'ambiguous' ? 'Положение на маршруте неоднозначно. Сверьтесь с картой и знаками.' : 'Неточное или недостоверное GPS-измерение отброшено.');
          return;
        }
        guidanceRef.current = result.state; setGuidance(result.state);
        setPosition([fix.coordinate.lon, fix.coordinate.lat]); setGps('available'); setNavWarning('');
      } catch { setFixStatus('invalid-fix'); setNavWarning('Не удалось надёжно определить положение.'); }
    }, e => { if (!live) return; setFixStatus('invalid-fix'); setGps(e.code === 1 ? 'denied' : 'unavailable'); setNavWarning(e.code === 1 ? 'Доступ к геолокации запрещён.' : 'Не удалось получить местоположение.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    return () => { live = false; navigator.geolocation.clearWatch(watch); };
  }, [navigation, geometry, steps]);
  const progress = guidance.progress;
  const nextStep = steps?.[guidance.nextStep] ?? null;
  const passed = fixStatus === 'accepted' && !!progress && !!nextStep && progress.along > nextStep.along + 10;
  const distance = fixStatus === 'accepted' && progress && nextStep && !passed ? Math.max(0, nextStep.along - progress.along) : null;
  const instruction = !steps ? 'Пошаговые указания недоступны: сверяйтесь с картой и знаками.' : nextStep ? `${nextStep.instruction}${passed ? ' · возможно, вы уже прошли этот манёвр; проверьте маршрут' : distance !== null ? ` · примерно ${Math.round(distance)} м` : ' · расстояние неизвестно'}. Подтвердите только после выполнения.` : incomplete ? 'Других известных указаний нет; набор неполный. Сверяйтесь с картой и знаками.' : 'Указания подтверждены; это не подтверждение прибытия.';
  useEffect(() => {
    if (navigation !== 'active' || !voice || !nextStep || distance === null || !('speechSynthesis' in window)) return;
    const key = `${guidance.nextStep}:${distance <= 30 ? 'near' : distance <= 100 ? 'soon' : ''}`;
    if (key.endsWith(':') || spoken.current === key) return;
    spoken.current = key;
    const utterance = new SpeechSynthesisUtterance(`${nextStep.instruction}, примерно через ${Math.round(distance)} метров`);
    utterance.lang = 'ru-RU'; window.speechSynthesis.speak(utterance);
  }, [navigation, voice, guidance.nextStep, nextStep, distance]);
  useEffect(() => { if (!voice || navigation !== 'active') window.speechSynthesis?.cancel(); }, [voice, navigation]);
  const warning = ['Нажмите на карту для выбора старта или включите GPS. Доступны только кольцевые маршруты в ограниченной области Омска. Участники, бюджет и остановки пока не влияют на построение; места и ограничения не проверяются. GPS, привязка манёвров и прогресс приблизительны, особенно на пересечениях и около начала и конца кольца; указания подтверждаются вручную. Следите за дорогой и знаками. Автоматического перестроения нет. На iOS работа GPS и голоса в фоне не гарантируется.', mapError, storageError, navWarning, incomplete ? 'Набор манёвров неполный или содержит неизвестные указания.' : '', voice && !('speechSynthesis' in window) ? 'Голосовые подсказки не поддерживаются браузером.' : ''].filter(Boolean).join(' ');
  return <WalkApp start={start} routingConsent={routingConsent} onRoutingConsentChange={setRoutingConsent} settings={settings} settingsOptions={options} onSettingsChange={s => { if (navigation === 'active' || navigation === 'paused') return; invalidate(); setSettings(s); }} routeStatus={status} route={route} routeError={error} onBuildRoute={build} navigationStatus={navigation} onStartNavigation={() => { guidanceRef.current = initialGuidanceState(); setGuidance(guidanceRef.current); setFixStatus('waiting'); setPosition(null); spoken.current = ''; setNavigation('active'); }} onPauseNavigation={() => setNavigation('paused')} onResumeNavigation={() => setNavigation('active')} onFinishNavigation={() => { if (geometry && (navigation === 'active' || navigation === 'paused')) setHistory(old => [...old, geometry].slice(-10)); setNavigation('finished'); }} navigationInstruction={instruction} onAcknowledgeStep={navigation === 'active' && nextStep ? () => { guidanceRef.current = acknowledgeStep(guidanceRef.current, steps ?? []); setGuidance(guidanceRef.current); } : undefined} navigationProgress={fixStatus === 'accepted' && progress && progress.total > 0 ? 100 * progress.along / progress.total : undefined} voiceEnabled={voice} onVoiceChange={setVoice} connection={online ? 'online' : 'offline'} gps={gps} onRequestGps={requestGps} map={<MapView start={start} geometry={geometry} position={position} onSelect={point => { if (navigation !== 'active' && navigation !== 'paused') selectStart(point); }} onError={setMapError} />} warning={warning} />;
}
