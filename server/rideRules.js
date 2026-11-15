// Pure ride rules (no DB): lifecycle, fare tiers, distance, OTP, deviation and the service area.
import { randomInt, timingSafeEqual } from 'node:crypto';

export const RIDE_STATUS = ['requested', 'driver_assigned', 'otp_verified', 'en_route', 'arrived', 'completed', 'cancelled'];
export const PAST_STATUSES = ['completed', 'cancelled'];
export const ACTIVE_STATUSES = RIDE_STATUS.filter((s) => !PAST_STATUSES.includes(s));
export const DRIVER_BUSY_STATUSES = ACTIVE_STATUSES.filter((s) => s !== 'requested');
// Deviation is only meaningful while the passenger is on board and the car is moving.
export const MONITORED_STATUSES = ['otp_verified', 'en_route'];
// After OTP verification the driver moves the trip forward one step at a time.
export const NEXT_STATUS = { otp_verified: 'en_route', en_route: 'arrived', arrived: 'completed' };
export const statusLabel = (s) => s.replace(/_/g, ' ');
export const CANCELLABLE = { passenger: ['requested', 'driver_assigned'], driver: ['driver_assigned'] };

// ponytail: no surge pricing.
export const TIERS = [
  { id: 'lite', name: 'SheRides Lite', desc: 'Hatchback · 4 seats', base: 40, perKm: 12 },
  { id: 'prime', name: 'SheRides Prime', desc: 'Sedan · extra legroom', base: 60, perKm: 16 },
];
export const TIER_IDS = TIERS.map((t) => t.id);

export function fareFor(tierId, km) {
  const tier = TIERS.find((t) => t.id === tierId);
  if (!tier) throw new Error(`Unknown tier ${tierId}`);
  return Math.round(tier.base + tier.perKm * km);
}

// Straight-line (haversine) distance in km, 1 decimal. Used when the road router is unavailable.
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

// Shortest trip we accept; also stops "book a ride to where I already am". (The service area caps the longest.)
export const MIN_KM = 0.2;

export const makeOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Constant-time compare so response timing does not leak how many digits matched.
export function otpMatches(expected, given) {
  if (typeof given !== 'string' || !/^\d{6}$/.test(given) || typeof expected !== 'string') return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
export const MAX_OTP_ATTEMPTS = 5;

export const DEVIATION_M = 500;
// Metres from p to segment a→b (flat-earth projection, accurate to well under a metre at city scale).
export function distanceToSegmentM(p, a, b) {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  const ky = 110540;
  const bx = (b.lng - a.lng) * kx;
  const by = (b.lat - a.lat) * ky;
  const px = (p.lng - a.lng) * kx;
  const py = (p.lat - a.lat) * ky;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

// Metres from p to the nearest point of a planned path [[lat, lng], …] (two or more points).
export function distanceToPathM(p, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = { lat: path[i - 1][0], lng: path[i - 1][1] };
    const b = { lat: path[i][0], lng: path[i][1] };
    best = Math.min(best, distanceToSegmentM(p, a, b));
  }
  return best;
}

// Geo-fence: every ride, at any hour, must start and end inside the service area.
export const SERVICE_AREA = { name: 'Ahmedabad', center: { lat: 23.0225, lng: 72.5714 }, radiusKm: 35 };
export const TIME_ZONE = 'Asia/Kolkata';
// 'YYYY-MM-DD' of a moment in the service area's time zone.
export const localDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
export const insideServiceArea = (p) => distanceKm(SERVICE_AREA.center, p) <= SERVICE_AREA.radiusKm;
