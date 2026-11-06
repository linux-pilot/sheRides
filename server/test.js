// Runnable checks for non-trivial logic. Run: docker compose run --rm server node test.js
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { requireRole, signToken, validate } from './middleware.js';
import { detectFileType } from './uploads.js';
import { canonicalPlate } from './models.js';
import { distanceKm, distanceToPathM, distanceToRouteM, fareFor, geofenceApplies, insideServiceArea, isNight, makeOtp, NEXT_STATUS, otpMatches } from './rideRules.js';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

// Run middleware against a fake request; resolves with the error passed to next() (or null).
const run = (mw, authorization) => new Promise((resolve) => {
  const req = { headers: authorization ? { authorization } : {} };
  mw(req, {}, (err) => resolve({ err: err || null, req }));
});
const bearer = (role) => `Bearer ${signToken({ _id: 'abc123' }, role)}`;

await test('role middleware lets the right role through and sets req.auth', async () => {
  const { err, req } = await run(requireRole('admin'), bearer('admin'));
  assert.equal(err, null);
  assert.deepEqual(req.auth, { id: 'abc123', role: 'admin' });
});

await test('role middleware accepts any listed role', async () => {
  const { err } = await run(requireRole('passenger', 'driver'), bearer('driver'));
  assert.equal(err, null);
});

await test('role middleware blocks other roles with 403', async () => {
  const { err } = await run(requireRole('admin'), bearer('passenger'));
  assert.equal(err.status, 403);
});

await test('missing token → 401', async () => {
  const { err } = await run(requireRole('admin'));
  assert.equal(err.status, 401);
});

await test('token signed with another secret → 401', async () => {
  const forged = jwt.sign({ sub: 'x', role: 'admin' }, 'some-other-secret-value');
  const { err } = await run(requireRole('admin'), `Bearer ${forged}`);
  assert.equal(err.status, 401);
});

await test('expired token → 401', async () => {
  const old = jwt.sign({ sub: 'x', role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
  const { err } = await run(requireRole('admin'), `Bearer ${old}`);
  assert.equal(err.status, 401);
});

await test('validate rejects non-female gender', async () => {
  assert.throws(() => validate({ gender: 'male' }, { gender: { required: true, oneOf: ['female'] } }), { status: 400 });
});

await test('validate trims, lowercases email and reports every problem', async () => {
  assert.deepEqual(validate({ email: '  A@B.com ' }, { email: { required: true, type: 'email' } }), { email: 'a@b.com' });
  assert.throws(
    () => validate({ email: 'nope', phone: '12' }, { email: { type: 'email' }, phone: { type: 'phone' }, name: { required: true } }),
    (e) => e.status === 400 && /email/.test(e.message) && /phone/.test(e.message) && /name/.test(e.message),
  );
});

await test('validate rejects non-string values (no operator injection like {"$gt": ""})', async () => {
  assert.throws(() => validate({ email: { $gt: '' } }, { email: { required: true, type: 'email' } }), { status: 400 });
});

await test('upload check identifies JPG, PNG and PDF by content', async () => {
  assert.equal(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpg');
  assert.equal(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png');
  assert.equal(detectFileType(Buffer.from('%PDF-1.7\n')), 'pdf');
});

await test('upload check rejects other content even with an image-looking name', async () => {
  assert.equal(detectFileType(Buffer.from('<html><script>alert(1)</script>')), null); // e.g. evil.png that is really HTML
  assert.equal(detectFileType(Buffer.from('MZ\x90\x00')), null); // Windows executable
  assert.equal(detectFileType(Buffer.alloc(0)), null);
});

await test('distance: Kalupur Station → CG Road is ~4 km straight line; same point is 0', async () => {
  const km = distanceKm({ lat: 23.0276, lng: 72.6006 }, { lat: 23.0365, lng: 72.5611 });
  assert.ok(km > 3.8 && km < 4.4, `got ${km}`);
  assert.equal(distanceKm({ lat: 23.03, lng: 72.57 }, { lat: 23.03, lng: 72.57 }), 0);
});

await test('fare = base + per-km per tier, rounded to whole rupees', async () => {
  assert.equal(fareFor('lite', 10), 40 + 12 * 10);
  assert.equal(fareFor('prime', 7.1), Math.round(60 + 16 * 7.1));
  assert.equal(fareFor('night', 0), 80);
  assert.throws(() => fareFor('surge', 5));
});

await test('OTP is a 6-digit string and varies', async () => {
  const otps = new Set(Array.from({ length: 50 }, makeOtp));
  for (const o of otps) assert.match(o, /^\d{6}$/);
  assert.ok(otps.size > 40);
});

await test('OTP check: exact match only, rejects wrong length / non-digits / non-strings', async () => {
  assert.equal(otpMatches('048213', '048213'), true);
  assert.equal(otpMatches('048213', '048214'), false);
  assert.equal(otpMatches('048213', '48213'), false);
  assert.equal(otpMatches('048213', '04821a'), false);
  assert.equal(otpMatches('048213', 48213), false);
  assert.equal(otpMatches(undefined, '048213'), false);
});

await test('ride steps follow the spec order after OTP', async () => {
  assert.deepEqual(NEXT_STATUS, { otp_verified: 'en_route', en_route: 'arrived', arrived: 'completed' });
});

const A = { lat: 23.0365, lng: 72.5611 }; // CG Road, Navrangpura
const B = { lat: 22.9962, lng: 72.6034 }; // Maninagar
await test('deviation: a point on the route is ~0 m away', async () => {
  const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
  assert.ok(distanceToRouteM(mid, A, B) < 5);
  assert.ok(distanceToRouteM(A, A, B) < 1);
});

await test('deviation: ~800 m sideways is over the 500 m threshold, ~200 m is not', async () => {
  const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
  const east = (m) => ({ lat: mid.lat, lng: mid.lng + m / (111320 * Math.cos((mid.lat * Math.PI) / 180)) });
  const far = distanceToRouteM(east(800), A, B);
  const near = distanceToRouteM(east(200), A, B);
  assert.ok(far > 500 && far < 800, `far ${far}`); // perpendicular distance is a bit less than the sideways shift
  assert.ok(near < 500, `near ${near}`);
});

await test('deviation: beyond the drop point measures from the drop, not the infinite line', async () => {
  const past = { lat: B.lat - 0.01, lng: B.lng + (B.lng - A.lng) * (0.01 / (A.lat - B.lat)) }; // ~1.1 km past B along the line
  assert.ok(distanceToRouteM(past, A, B) > 1000);
});

await test('deviation follows the road path, not the straight line', async () => {
  // L-shaped road: east then south. A point at the corner is on the road, though far from the straight A→C line.
  const pa = [23.03, 72.55]; const pb = [23.03, 72.58]; const pc = [23.0, 72.58];
  const corner = { lat: 23.03, lng: 72.58 };
  assert.ok(distanceToPathM(corner, [pa, pb, pc]) < 1);
  assert.ok(distanceToRouteM(corner, { lat: pa[0], lng: pa[1] }, { lat: pc[0], lng: pc[1] }) > 2000);
});

await test('night window is 22:00–06:00 IST', async () => {
  const ist = (h, m = 0) => new Date(Date.UTC(2026, 10, 6, h, m) - (5 * 60 + 30) * 60000); // IST clock time → instant
  assert.equal(isNight(ist(21, 59)), false);
  assert.equal(isNight(ist(22, 0)), true);
  assert.equal(isNight(ist(0, 30)), true);
  assert.equal(isNight(ist(5, 59)), true);
  assert.equal(isNight(ist(6, 0)), false);
  assert.equal(isNight(ist(13, 0)), false);
});

await test('geo-fence applies at night and always for Night Guardian; Ahmedabad inside, Vadodara outside', async () => {
  const noon = new Date(Date.UTC(2026, 10, 6, 6, 30)); // 12:00 IST
  assert.equal(geofenceApplies('lite', noon), false);
  assert.equal(geofenceApplies('night', noon), true);
  assert.equal(insideServiceArea(B), true);
  assert.equal(insideServiceArea({ lat: 22.3072, lng: 73.1812 }), false); // Vadodara
});

await test('vehicle plates get one spelling, whatever the spacing or case', async () => {
  for (const v of ['KA01MX4821', 'ka 01 mx 4821', ' KA 01MX  4821 ']) assert.equal(canonicalPlate(v), 'KA 01 MX 4821');
  assert.equal(canonicalPlate('22bh1234aa'), '22 BH 1234 AA');
});

console.log(`\n${passed} passed`);
