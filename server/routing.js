// Road routes from OSRM (open-source routing on OpenStreetMap data — same data as the map).
// ponytail: uses the free public demo server (light use, no SLA). Upgrade: self-hosted OSRM container.
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const MAX_POINTS = 400; // enough to draw and check deviation; keeps ride documents small
const cache = new Map(); // estimate → book within a minute asks for the same route

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Keep every k-th point (always keeping the last) so long routes stay under MAX_POINTS.
function thin(points) {
  if (points.length <= MAX_POINTS) return points;
  const k = Math.ceil(points.length / MAX_POINTS);
  return points.filter((_, i) => i % k === 0 || i === points.length - 1);
}

// → { km, durationMin, path: [[lat, lng], …] } or null when the router is unavailable.
export async function roadRoute(a, b) {
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(5)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.route;
  try {
    const res = await fetch(`${OSRM_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    const r = data.code === 'Ok' && data.routes?.[0];
    if (!r) return null;
    const route = {
      km: round(r.distance / 1000, 1),
      durationMin: Math.max(1, Math.round(r.duration / 60)),
      path: thin(r.geometry.coordinates.map(([lng, lat]) => [round(lat, 6), round(lng, 6)])),
    };
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), route });
    return route;
  } catch {
    return null;
  }
}
