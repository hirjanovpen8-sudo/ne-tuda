import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Coordinate } from './planner';

interface Props { start: Coordinate | null; geometry: readonly Coordinate[] | null; position: Coordinate | null; onSelect: (point: Coordinate) => void; onError: (message: string) => void }
export default function MapView({ start, geometry, position, onSelect, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const positionMarker = useRef<maplibregl.Marker | null>(null);
  const select = useRef(onSelect); select.current = onSelect;
  const report = useRef(onError); report.current = onError;
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    try { m = new maplibregl.Map({ container: container.current, style: 'https://tiles.openfreemap.org/styles/dark', center: [73.3686, 54.9885], zoom: 12, locale: { 'NavigationControl.ZoomIn': 'Приблизить', 'NavigationControl.ZoomOut': 'Отдалить', 'NavigationControl.ResetBearing': 'Сбросить ориентацию на север', 'AttributionControl.ToggleAttribution': 'Показать сведения об источниках карты', 'Map.Title': 'Карта', 'Marker.Title': 'Маркер карты' } }); }
    catch (error) { report.current(error instanceof Error ? `Не удалось создать карту: ${error.message}` : 'Не удалось создать карту.'); return; }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    m.on('click', e => select.current([e.lngLat.lng, e.lngLat.lat]));
    m.on('error', () => report.current('Не удалось загрузить часть карты. Проверьте соединение и доступность OpenFreeMap.'));
    return () => { marker.current?.remove(); positionMarker.current?.remove(); positionMarker.current = null; m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current; if (!m) return;
    marker.current?.remove(); marker.current = null;
    if (start) { marker.current = new maplibregl.Marker({ color: '#f39468' }).setLngLat([start[0], start[1]]).addTo(m); m.flyTo({ center: [start[0], start[1]], zoom: Math.max(m.getZoom(), 13) }); }
  }, [start]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    if (!position) { positionMarker.current?.remove(); positionMarker.current = null; return; }
    if (!positionMarker.current) positionMarker.current = new maplibregl.Marker({ color: '#2868e0' }).setLngLat([position[0], position[1]]).addTo(m);
    else positionMarker.current.setLngLat([position[0], position[1]]);
  }, [position]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    const update = () => {
      const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: geometry ? geometry.map(p => [p[0], p[1]]) : [] } };
      const source = m.getSource('walk-route') as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else { m.addSource('walk-route', { type: 'geojson', data }); m.addLayer({ id: 'walk-route-casing', type: 'line', source: 'walk-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#10233a', 'line-width': 9 } }); m.addLayer({ id: 'walk-route', type: 'line', source: 'walk-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#55e5ff', 'line-width': 5, 'line-opacity': 1 } }); }
      if (geometry && geometry.length > 1) { const bounds = new maplibregl.LngLatBounds(); geometry.forEach(p => bounds.extend([p[0], p[1]])); m.fitBounds(bounds, { padding: 35, maxZoom: 15 }); }
    };
    const onStyleData = () => { if (m.isStyleLoaded()) { m.off('styledata', onStyleData); update(); } };
    if (m.isStyleLoaded()) update(); else m.on('styledata', onStyleData);
    return () => { m.off('styledata', onStyleData); };
  }, [geometry]);
  return <div ref={container} className="app-map" aria-label="Карта: нажмите, чтобы выбрать старт" />;
}
