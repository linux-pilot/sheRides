// Runnable checks for non-trivial logic. Run: docker compose run --rm server node test.js
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authorize, signToken, validate } from './middleware.js';
import { detectFileType } from './uploads.js';
import { canonicalPlate } from './models.js';
import { distanceKm, distanceToPathM, distanceToSegmentM, fareFor, insideServiceArea, makeOtp, otpMatches, TIERS } from './rideRules.js';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

const ID = '64b7f0000000000000000001';
const bearer = (role) => `Bearer ${signToken({ _id: ID }, role)}`;

await test('role check lets a listed role through as { id, role }', async () => {
  assert.deepEqual(authorize(bearer('admin'), ['admin']), { id: ID, role: 'admin' });
  assert.deepEqual(authorize(bearer('driver'), ['passenger', 'driver']), { id: ID, role: 'driver' });
});

await test('role check refuses other roles with 403', async () => {
  assert.throws(() => authorize(bearer('passenger'), ['admin']), { status: 403 });
});

await test('missing, forged or expired token → 401', async () => {
  assert.throws(() => authorize(undefined, ['admin']), { status: 401 });
  assert.throws(() => authorize(`Bearer ${jwt.sign({ sub: ID, role: 'admin' }, 'some-other-secret-value')}`, ['admin']), { status: 401 });
  const old = jwt.sign({ sub: ID, role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
  assert.throws(() => authorize(`Bearer ${old}`, ['admin']), { status: 401 });
});

await test('validate oneOf rejects other values (women-only gender rule)', async () => {
  assert.throws(() => validate({ gender: 'male' }, { gender: { required: true, oneOf: ['female'] } }), { status: 400 });
});

await test('validate checks booleans and whole numbers, and names nested fields', async () => {
  assert.deepEqual(validate({ on: false, n: 3 }, { on: { type: 'boolean' }, n: { type: 'integer' } }), { on: false, n: 3 });
  assert.throws(() => validate({ on: 'yes' }, { on: { type: 'boolean' } }), { status: 400 });
  assert.throws(() => validate({ n: 2.5 }, { n: { type: 'integer' } }), { status: 400 });
  assert.throws(() => validate({}, { lat: { required: true } }, 'pickup.'), /pickup\.lat is required/);
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

await test('fare = base + per-km per tier, whole rupees; unknown and retired tiers refused', async () => {
  for (const t of TIERS) {
    assert.equal(fareFor(t.id, 0), t.base);
    assert.equal(fareFor(t.id, 10) - fareFor(t.id, 0), 10 * t.perKm);
    assert.ok(Number.isInteger(fareFor(t.id, 7.13)));
  }
  assert.throws(() => fareFor('surge', 5));
  assert.throws(() => fareFor('night', 5)); // Night Guardian tier was retired
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

const A = { lat: 23.0365, lng: 72.5611 }; // CG Road, Navrangpura
const B = { lat: 22.9962, lng: 72.6034 }; // Maninagar
await test('deviation: a point on the route is ~0 m away', async () => {
  const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
  assert.ok(distanceToSegmentM(mid, A, B) < 5);
  assert.ok(distanceToSegmentM(A, A, B) < 1);
});

await test('deviation: ~800 m sideways is over the 500 m threshold, ~200 m is not', async () => {
  const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
  const east = (m) => ({ lat: mid.lat, lng: mid.lng + m / (111320 * Math.cos((mid.lat * Math.PI) / 180)) });
  const far = distanceToSegmentM(east(800), A, B);
  const near = distanceToSegmentM(east(200), A, B);
  assert.ok(far > 500 && far < 800, `far ${far}`); // perpendicular distance is a bit less than the sideways shift
  assert.ok(near < 500, `near ${near}`);
});

await test('deviation: beyond the drop point measures from the drop, not the infinite line', async () => {
  const past = { lat: B.lat - 0.01, lng: B.lng + (B.lng - A.lng) * (0.01 / (A.lat - B.lat)) }; // ~1.1 km past B along the line
  assert.ok(distanceToSegmentM(past, A, B) > 1000);
});

await test('deviation follows the road path, not the straight line', async () => {
  // L-shaped road: east then south. A point at the corner is on the road, though far from the straight A→C line.
  const pa = [23.03, 72.55]; const pb = [23.03, 72.58]; const pc = [23.0, 72.58];
  const corner = { lat: 23.03, lng: 72.58 };
  assert.ok(distanceToPathM(corner, [pa, pb, pc]) < 1);
  assert.ok(distanceToSegmentM(corner, { lat: pa[0], lng: pa[1] }, { lat: pc[0], lng: pc[1] }) > 2000);
});

await test('geo-fence: Ahmedabad is inside the service area, Nadiad and Vadodara are outside', async () => {
  assert.equal(insideServiceArea(A), true);
  assert.equal(insideServiceArea(B), true);
  assert.equal(insideServiceArea({ lat: 22.6916, lng: 72.8634 }), false); // Nadiad, ~48 km out
  assert.equal(insideServiceArea({ lat: 22.3072, lng: 73.1812 }), false); // Vadodara
});

await test('vehicle plates get one spelling, whatever the spacing or case', async () => {
  for (const v of ['KA01MX4821', 'ka 01 mx 4821', ' KA 01MX  4821 ']) assert.equal(canonicalPlate(v), 'KA 01 MX 4821');
  assert.equal(canonicalPlate('22bh1234aa'), '22 BH 1234 AA');
});

console.log(`\n${passed} passed`);
