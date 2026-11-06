import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CITY } from '../constants.js';

const pinIcon = (kind) => L.divIcon({ className: '', html: `<div class="pin ${kind}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });

// Plain Leaflet + OpenStreetMap. markers: [{pos:[lat,lng], kind:'pickup'|'drop'|'car'|'sos', label}]
// circle: { center: {lat,lng}, radiusKm } draws a geo-fence.
// `height` is the desktop height; CSS caps it on small screens.
export function MapView({ center = CITY, zoom = 13, markers = [], route, circle, height = 320 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fitted = useRef('');

  useEffect(() => {
    // Wheel zoom off so the page still scrolls over a map (touch and trackpad).
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView(center, zoom);
    fitted.current = ''; // a new map (e.g. StrictMode remount) has not been fitted yet
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    // Keep tiles correct when the container resizes (rotation, sidebar, breakpoints).
    const ro = new ResizeObserver(() => map.current.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.current.remove(); };
  }, []);

  useEffect(() => {
    layer.current.clearLayers();
    // Re-zoom only when the route, fence or set of pins changes — not every time the car moves.
    const fitKey = JSON.stringify([route, circle, route ? null : markers.map((m) => `${m.kind}:${m.label}`)]);
    const refit = fitKey !== fitted.current;
    fitted.current = fitKey;
    if (circle) {
      const c = L.circle([circle.center.lat, circle.center.lng], { radius: circle.radiusKm * 1000, color: '#ff5b8e', weight: 2, fillOpacity: 0.08 }).addTo(layer.current);
      if (refit && !route && markers.length < 2) map.current.fitBounds(c.getBounds(), { padding: [10, 10] });
    }
    if (route) {
      const line = L.polyline(route, { color: '#ff5b8e', weight: 5, opacity: 0.9 }).addTo(layer.current);
      if (refit) map.current.fitBounds(line.getBounds(), { padding: [30, 30] });
    }
    markers.forEach((m) => {
      const mk = L.marker(m.pos, { icon: pinIcon(m.kind), zIndexOffset: m.kind === 'car' || m.kind === 'sos' ? 500 : 0 }).addTo(layer.current);
      // Labels hold user-typed names and addresses: pass Leaflet an element with textContent,
      // never a string (Leaflet inserts strings as HTML → stored XSS).
      if (m.label) { const tip = document.createElement('span'); tip.textContent = m.label; mk.bindTooltip(tip); }
    });
    if (refit && !route && markers.length > 1) map.current.fitBounds(markers.map((m) => m.pos), { padding: [40, 40], maxZoom: 15 });
    else if (refit && !route && !circle && markers.length === 1) map.current.setView(markers[0].pos, 14);
  }, [JSON.stringify(markers), JSON.stringify(route), JSON.stringify(circle)]);

  return <div ref={el} className="map" style={{ '--map-h': `${height}px` }} />;
}
