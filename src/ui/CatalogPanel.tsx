import { useEffect, useRef, useState } from 'react';
import { searchCatalog, type CatalogPlace } from '../catalog';
import type { Coordinate } from '../services/providers';
import './catalog.css';

export interface CatalogPanelProps {
  /** Selected start as [longitude, latitude], or null when no start is selected. */
  start: Coordinate | null;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'success'; key: string; places: CatalogPlace[] }
  | { status: 'error'; key: string; message: string };

const RADIUS_METERS = 500;
const TIMEOUT_MS = 25000;

function validStart(start: Coordinate | null): start is Coordinate {
  return !!start && Number.isFinite(start[0]) && Number.isFinite(start[1]) && Math.abs(start[0]) <= 180 && Math.abs(start[1]) <= 90;
}

function placeTitle(place: CatalogPlace): string {
  if (place.name) return place.name;
  for (const key of ['tourism', 'historic', 'leisure', 'natural']) {
    if (place.tags[key]?.trim()) return `${key}: ${place.tags[key]}`;
  }
  return 'Тип неизвестен';
}

/** Independent, explicitly triggered search; results are not added to a route. */
export function CatalogPanel({ start }: CatalogPanelProps) {
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const request = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const key = validStart(start) ? `${start[0]},${start[1]}` : null;

  useEffect(() => {
    setState({ status: 'idle' });
    return () => {
      if (request.current) {
        clearTimeout(request.current.timer);
        request.current.controller.abort();
        request.current = null;
      }
    };
  }, [key]);

  function search() {
    if (!validStart(start) || key === null) return;
    if (request.current) {
      clearTimeout(request.current.timer);
      request.current.controller.abort();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (request.current?.controller !== controller) return;
      request.current = null;
      controller.abort();
      setState({ status: 'error', key, message: 'Время ожидания истекло. Попробуйте ещё раз.' });
    }, TIMEOUT_MS);
    request.current = { controller, timer };
    setState({ status: 'loading', key });
    void searchCatalog(start, RADIUS_METERS, { signal: controller.signal }).then(places => {
      if (request.current?.controller !== controller) return;
      clearTimeout(timer);
      request.current = null;
      setState({ status: 'success', key, places });
    }).catch(() => {
      if (request.current?.controller !== controller) return;
      clearTimeout(timer);
      request.current = null;
      setState({ status: 'error', key, message: 'Не удалось загрузить места. Попробуйте ещё раз.' });
    });
  }

  const current = state.status !== 'idle' && state.key === key ? state : { status: 'idle' as const };
  return (
    <section className="catalog-panel" aria-label="Места рядом со стартом">
      <h2>Места рядом со стартом</h2>
      <p>Поиск в радиусе {RADIUS_METERS} м от выбранного старта выполняется только по кнопке. При нажатии координаты будут отправлены внешнему сервису Overpass.</p>
      <p className="catalog-warning">Данные OpenStreetMap не проверены и могут быть устаревшими или неполными. Часы, доступ, освещение и стоимость нужно уточнять самостоятельно; результаты не добавляются в маршрут.</p>
      {!key && <p>Выберите корректную точку старта.</p>}
      <button type="button" onClick={search} disabled={!key || current.status === 'loading'}>Найти места</button>
      {current.status === 'loading' && <p role="status">Загрузка мест…</p>}
      {current.status === 'error' && <p role="alert">{current.message}</p>}
      {current.status === 'success' && (current.places.length === 0 ? <p role="status">Места не найдены.</p> :
        <ul className="catalog-list">{current.places.map(place => <li key={place.id}>
          <h3>{placeTitle(place)}</h3>
          <p><a href={place.source.url} target="_blank" rel="noopener noreferrer">{place.source.name} ↗</a> · {place.source.attribution}</p>
          <dl>
            <div><dt>Часы (opening_hours)</dt><dd>{place.openingHours ?? 'Неизвестно'}</dd></div>
            <div><dt>Освещение (lit)</dt><dd>{place.lighting ?? 'Неизвестно'}</dd></div>
            <div><dt>Доступ (access)</dt><dd>{place.access ?? 'Неизвестно'}</dd></div>
            <div><dt>Плата (fee)</dt><dd>{place.price?.fee ?? 'Неизвестно'}</dd></div>
            <div><dt>Стоимость (charge)</dt><dd>{place.price?.charge ?? 'Неизвестно'}</dd></div>
          </dl>
        </li>)}</ul>)}
    </section>
  );
}

export default CatalogPanel;
