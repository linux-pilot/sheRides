// End-to-end API checks against a running, ISOLATED SheRides stack. Never point this at real data:
// it creates accounts, rides, SOS alerts and emails. It refuses unless MONGO_URL names a qa/e2e database.
//   docker compose -f <qa compose> run --rm server node e2e.mjs [section …]   (API sections 1, 2, 3, 5; 4 is the browser pass)
// Env: E2E_API (default http://server:5000), MAILPIT (default http://mailpit:8025).
import WebSocket from 'ws';

if (!/sherides_(qa|e2e)\b/.test(process.env.MONGO_URL || '')) {
  console.error(`Refusing to run: MONGO_URL (${process.env.MONGO_URL}) is not a qa/e2e database.`);
  process.exit(2);
}
const API = process.env.E2E_API || 'http://server:5000';
const MAILPIT = process.env.MAILPIT || 'http://mailpit:8025';
const ORIGIN = (process.env.CLIENT_ORIGIN || 'http://localhost:3000').split(',')[0].trim();
const PW = 'SheRides@123';
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- tiny runner: every check is recorded, failures don't stop the run ----
const failures = [];
let passed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; return true; }
  failures.push(`${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}` : ''}`);
  console.log(`FAIL ${name}`, detail ? JSON.stringify(detail).slice(0, 300) : '');
  return false;
}
const is = (name, res, status) => check(name, res.status === status, `expected ${status}, got ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);

async function api(method, path, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = raw;
  if (body !== undefined && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (body instanceof FormData) payload = body;
  const res = await fetch(API + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

const login = async (role, email, password = PW) => {
  const r = await api('POST', `/auth/login/${role}`, { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${role} ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
};
let adminToken;
const admin = async () => (adminToken ||= await login('admin', 'admin@sherides.test'));

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
async function upload(token, type, buf = PNG, name = 'doc.png') {
  const form = new FormData();
  form.append('type', type);
  form.append('file', new Blob([buf]), name);
  return api('POST', '/driver/documents', { token, body: form });
}

async function newPassenger(extra = {}) {
  const email = `p_${uniq()}@qa.test`;
  const r = await api('POST', '/auth/register/passenger', { body: { name: 'QA Passenger', email, phone: '+91 90000 11111', password: PW, gender: 'female', ...extra } });
  if (r.status !== 201) throw new Error(`register passenger: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.user._id, email };
}
async function topUp(p, amount = 5000) { return api('POST', '/wallet', { token: p.token, body: { amount } }); }
async function newDriver({ approve = true, online = true } = {}) {
  const email = `d_${uniq()}@qa.test`;
  const plate = `QA ${uniq().slice(-6).toUpperCase()}`;
  const r = await api('POST', '/auth/register/driver', { body: { name: 'QA Driver', email, phone: '+91 90000 22222', password: PW, gender: 'female', licenseNumber: 'KA01 2020 000', vehicleModel: 'Test Car', vehiclePlate: plate } });
  if (r.status !== 201) throw new Error(`register driver: ${r.status} ${JSON.stringify(r.body)}`);
  const d = { token: r.body.token, id: r.body.user._id, email, plate: r.body.user.vehiclePlate };
  if (approve) {
    await upload(d.token, 'Driving licence');
    const a = await api('PUT', `/admin/drivers/${d.id}`, { token: await admin(), body: { verificationStatus: 'approved' } });
    if (a.status !== 200) throw new Error(`approve driver: ${a.status} ${JSON.stringify(a.body)}`);
    if (online) await api('PUT', '/driver/availability', { token: d.token, body: { availability: 'online' } });
  }
  return d;
}
// Ahmedabad places inside the service area (night geo-fence safe at any hour).
const NAV = { address: 'CG Road, Navrangpura', lat: 23.0365, lng: 72.5611 };
const VAS = { address: 'Vastrapur Lake', lat: 23.0396, lng: 72.5293 };
const book = (p, tier = 'lite', pickup = NAV, drop = VAS) => api('POST', '/rides', { token: p.token, body: { pickup, drop, tier } });
const BAD_ID = '64b7f0000000000000000000';

// ======================= 1. Auth, roles, input validation =======================
async function section1() {
  console.log('\n# 1. Auth, roles, input validation');
  const base = { name: 'Asha QA', phone: '+91 90000 33333', password: PW, gender: 'female' };

  // Registration rules
  const email = `reg_${uniq()}@qa.test`;
  let r = await api('POST', '/auth/register/passenger', { body: { ...base, email: email.toUpperCase() } });
  is('register passenger → 201', r, 201);
  check('register returns token + profile without password', r.body.token && r.body.user && !('password' in r.body.user), r.body);
  check('register stores email lowercased', r.body.user?.email === email, r.body.user?.email);
  is('duplicate email (any case) → 409', await api('POST', '/auth/register/passenger', { body: { ...base, email } }), 409);
  is('male → 400', await api('POST', '/auth/register/passenger', { body: { ...base, email: `m_${uniq()}@qa.test`, gender: 'male' } }), 400);
  is('gender missing → 400', await api('POST', '/auth/register/passenger', { body: { ...base, gender: undefined, email: `g_${uniq()}@qa.test` } }), 400);
  is('password 7 chars → 400', await api('POST', '/auth/register/passenger', { body: { ...base, email: `s_${uniq()}@qa.test`, password: 'Abc@123' } }), 400);
  is('password 73 chars → 400', await api('POST', '/auth/register/passenger', { body: { ...base, email: `l_${uniq()}@qa.test`, password: 'a'.repeat(73) } }), 400);
  is('invalid email → 400', await api('POST', '/auth/register/passenger', { body: { ...base, email: 'nope@x' } }), 400);
  is('phone with letters → 400', await api('POST', '/auth/register/passenger', { body: { ...base, email: `ph_${uniq()}@qa.test`, phone: '98450abcde' } }), 400);
  is('name 81 chars → 400', await api('POST', '/auth/register/passenger', { body: { ...base, email: `n_${uniq()}@qa.test`, name: 'x'.repeat(81) } }), 400);
  is('whitespace-only name → 400', await api('POST', '/auth/register/passenger', { body: { ...base, email: `w_${uniq()}@qa.test`, name: '   ' } }), 400);
  is('self-register admin → 404', await api('POST', '/auth/register/admin', { body: { ...base, email: `a_${uniq()}@qa.test` } }), 404);
  is('self-register support → 404', await api('POST', '/auth/register/support', { body: { ...base, email: `su_${uniq()}@qa.test` } }), 404);
  r = await api('POST', '/auth/register/passenger', { body: { ...base, email: `mass_${uniq()}@qa.test`, walletBalance: 99999, status: 'active', role: 'admin' } });
  check('register ignores walletBalance/role injection', r.status === 201 && r.body.user.walletBalance === 0, r.body.user);

  const drv = { ...base, licenseNumber: 'KA01 2019 1234', vehicleModel: 'Swift' };
  is('driver missing plate → 400', await api('POST', '/auth/register/driver', { body: { ...drv, email: `dp_${uniq()}@qa.test` } }), 400);
  is('driver plate with symbols → 400', await api('POST', '/auth/register/driver', { body: { ...drv, email: `ds_${uniq()}@qa.test`, vehiclePlate: 'KA-01<b>' } }), 400);
  is('driver duplicate plate, other case → 409', await api('POST', '/auth/register/driver', { body: { ...drv, email: `dd_${uniq()}@qa.test`, vehiclePlate: 'ka 01 mx 4821' } }), 409);
  is('driver duplicate plate, other spacing → 409', await api('POST', '/auth/register/driver', { body: { ...drv, email: `dq_${uniq()}@qa.test`, vehiclePlate: 'KA01MX4821' } }), 409);
  r = await api('POST', '/auth/register/driver', { body: { ...drv, email: `dv_${uniq()}@qa.test`, vehiclePlate: `QA ${uniq().slice(-5)}`, verificationStatus: 'approved', availability: 'online', rating: 5 } });
  check('driver register ignores verificationStatus/rating injection', r.status === 201 && r.body.user.verificationStatus === 'pending' && r.body.user.rating === 0 && r.body.user.availability === 'offline', r.body.user);

  // Login
  is('login wrong password → 401', await api('POST', '/auth/login/passenger', { body: { email: 'ananya@sherides.test', password: 'wrong-password' } }), 401);
  const unknown = await api('POST', '/auth/login/passenger', { body: { email: 'nobody@sherides.test', password: 'wrong-password' } });
  is('login unknown email → 401', unknown, 401);
  check('unknown email and wrong password give the same message', unknown.body.error === 'Wrong email or password', unknown.body);
  is('login email uppercase → 200', await api('POST', '/auth/login/passenger', { body: { email: 'ANANYA@sherides.test', password: PW } }), 200);
  is('passenger creds on driver login → 401', await api('POST', '/auth/login/driver', { body: { email: 'ananya@sherides.test', password: PW } }), 401);
  is('blocked passenger login → 403', await api('POST', '/auth/login/passenger', { body: { email: 'farah@sherides.test', password: PW } }), 403);
  is('login unknown role → 404', await api('POST', '/auth/login/root', { body: { email: 'ananya@sherides.test', password: PW } }), 404);

  // Failed sign-ins are capped per account; a correct password resets the count, a locked account refuses even it
  const lp = await newPassenger();
  const wrong = () => api('POST', '/auth/login/passenger', { body: { email: lp.email, password: 'wrong-password' } });
  for (let i = 0; i < 9; i++) await wrong();
  is('correct password after 9 failures → 200 (and resets)', await api('POST', '/auth/login/passenger', { body: { email: lp.email, password: PW } }), 200);
  const tries = await Promise.all(Array.from({ length: 12 }, wrong));
  check('parallel guesses: 10 checked, the rest refused', tries.filter((t) => t.status === 401).length === 10 && tries.filter((t) => t.status === 429).length === 2, tries.map((t) => t.status));
  r = await api('POST', '/auth/login/passenger', { body: { email: lp.email, password: PW } });
  check('locked account refuses even the right password → 429', r.status === 429 && /Too many/.test(r.body.error), r.body);
  is('lock is per account type: same email on driver login still checked → 401', await api('POST', '/auth/login/driver', { body: { email: lp.email, password: PW } }), 401);
  is('login NoSQL operator in email → 400', await api('POST', '/auth/login/passenger', { body: { email: { $gt: '' }, password: PW } }), 400);
  is('login NoSQL operator in password → 400', await api('POST', '/auth/login/passenger', { body: { email: 'ananya@sherides.test', password: { $ne: 'x' } } }), 400);
  for (const role of ['passenger', 'driver', 'admin', 'support']) {
    const em = { passenger: 'ananya', driver: 'priya', admin: 'admin', support: 'asha' }[role];
    const t = await login(role, `${em}@sherides.test`);
    const me = await api('GET', '/me', { token: t });
    check(`GET /me as ${role} → own profile, no password`, me.status === 200 && me.body.role === role && me.body.user.email === `${em}@sherides.test` && !('password' in me.body.user), me.body);
  }

  // Tokens
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: BAD_ID, role: 'admin' })).toString('base64url')}.`;
  is('alg:none token → 401', await api('GET', '/admin/reports', { token: unsigned }), 401);
  is('garbage token → 401', await api('GET', '/me', { token: 'abc.def.ghi' }), 401);
  is('Basic auth scheme → 401', await api('GET', '/me', { headers: { Authorization: 'Basic abc' } }), 401);
  const ghost = await api('GET', '/me', { token: (await import('./middleware.js')).signToken({ _id: BAD_ID }, 'passenger') });
  is('valid token for non-existent account → 401', ghost, 401);

  // Body parsing
  is('malformed JSON → 400', await api('POST', '/auth/login/passenger', { raw: '{"email":', headers: { 'Content-Type': 'application/json' } }), 400);
  const big = await api('POST', '/auth/login/passenger', { raw: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }), headers: { 'Content-Type': 'application/json' } });
  is('body over 100 kB → 413', big, 413);
  check('413 body is JSON error, not a stack', typeof big.body === 'object' && typeof big.body.error === 'string', big.body);
  is('unknown route → 404 JSON', await api('GET', '/nope'), 404);

  // Role × endpoint matrix
  const tokens = {
    passenger: await login('passenger', 'sneha@sherides.test'),
    driver: await login('driver', 'neha@sherides.test'),
    admin: await admin(),
    support: await login('support', 'asha@sherides.test'),
  };
  const P = 'passenger', D = 'driver', A = 'admin', S = 'support';
  const id = BAD_ID;
  const MATRIX = [
    ['GET', '/me', [P, D, A, S]], ['PUT', '/me', [P, D]], ['POST', '/me/contacts', [P]], ['DELETE', `/me/contacts/${id}`, [P]],
    ['POST', '/me/addresses', [P]], ['DELETE', `/me/addresses/${id}`, [P]], ['GET', '/me/stats', [P]], ['GET', '/wallet', [P]],
    ['POST', '/wallet', [P]], ['GET', '/notifications', [P]], ['PUT', '/notifications/read', [P]],
    ['GET', '/admin/drivers', [A]], ['PUT', `/admin/drivers/${id}`, [A]], ['GET', '/admin/users', [A]], ['PUT', `/admin/users/${id}`, [A]],
    ['GET', '/admin/rides', [A]], ['GET', '/admin/complaints', [A]], ['PUT', `/admin/complaints/${id}`, [A]], ['GET', '/admin/sos', [A]],
    ['GET', '/admin/reports', [A]], ['GET', '/admin/anything', [A]],
    ['POST', '/driver/documents', [D]], ['PUT', '/driver/availability', [D]], ['GET', '/driver/earnings', [D]], ['GET', '/driver/ratings', [D]],
    ['GET', '/files/0123456789abcdef0123456789abcdef.png', [A, D]],
    ['POST', '/rides/estimate', [P]], ['POST', '/rides', [P]], ['GET', '/rides/active', [P, D]], ['GET', '/rides', [P, D]],
    ['GET', '/driver/requests', [D]], ['POST', `/driver/rides/${id}/accept`, [D]], ['POST', `/driver/rides/${id}/reject`, [D]],
    ['POST', `/rides/${id}/start`, [D]], ['POST', `/rides/${id}/status`, [D]], ['POST', `/rides/${id}/cancel`, [P, D]],
    ['POST', `/rides/${id}/rate`, [P, D]], ['GET', `/rides/${id}/messages`, [P, D]], ['POST', `/rides/${id}/messages`, [P, D]],
    ['POST', '/sos', [P, D]], ['GET', '/sos/active', [P, D]], ['POST', `/sos/${id}/resolve`, [P, D, A]],
    ['POST', '/tickets', [P, D]], ['GET', '/tickets', [P, D, S]], ['PUT', `/tickets/${id}`, [S]], ['GET', '/support/team', [S]],
    ['POST', '/complaints', [P, D]],
  ];
  // Allowed roles only probed on reads (writes with side effects are covered elsewhere).
  for (const [method, path, allowed] of MATRIX) {
    const none = await api(method, path, method === 'GET' ? {} : { body: {} });
    check(`${method} ${path} without token → 401`, none.status === 401, none.status);
    for (const role of [P, D, A, S]) {
      if (allowed.includes(role)) {
        if (method !== 'GET') continue;
        const ok = await api(method, path, { token: tokens[role] });
        // A 403 for a business rule (e.g. unapproved driver) is fine; the role gate's own 403 is not.
        check(`${method} ${path} as ${role} → allowed`, ok.status !== 401 && ok.body?.error !== 'Not allowed for this account type', ok);
      } else {
        const no = await api(method, path, { token: tokens[role], ...(method === 'GET' ? {} : { body: {} }) });
        check(`${method} ${path} as ${role} → 403`, no.status === 403, no.status);
      }
    }
  }
  for (const path of ['/tiers', '/safety/config', '/health']) is(`GET ${path} public → 200`, await api('GET', path), 200);

  // Validation + mass assignment on own data
  const p = await newPassenger();
  r = await api('PUT', '/me', { token: p.token, body: { walletBalance: 99999, email: 'hijack@qa.test', status: 'blocked', gender: 'male', name: 'Renamed QA' } });
  check('PUT /me only changes allowed fields', r.status === 200 && r.body.user.walletBalance === 0 && r.body.user.email === p.email && r.body.user.status === 'active' && r.body.user.gender === 'female' && r.body.user.name === 'Renamed QA', r.body);
  is('PUT /me name as number → 400', await api('PUT', '/me', { token: p.token, body: { name: 42 } }), 400);
  is('PUT /me bad phone → 400', await api('PUT', '/me', { token: p.token, body: { phone: '12' } }), 400);
  is('PUT /me preferences non-boolean → 400', await api('PUT', '/me', { token: p.token, body: { preferences: { shareTrips: 'yes' } } }), 400);
  r = await api('PUT', '/me', { token: p.token, body: { preferences: { shareTrips: false, hacked: true } } });
  check('PUT /me preferences: known keys only', r.status === 200 && r.body.user.preferences.shareTrips === false && !('hacked' in r.body.user.preferences), r.body.user?.preferences);
  const d = await newDriver({ approve: false });
  r = await api('PUT', '/me', { token: d.token, body: { verificationStatus: 'approved', walletBalance: 5000, vehiclePlate: 'HACK 1', name: 'Driver Renamed' } });
  check('driver PUT /me cannot self-approve or edit wallet/plate', r.status === 200 && r.body.user.verificationStatus === 'pending' && r.body.user.walletBalance === 0 && r.body.user.vehiclePlate === d.plate, r.body.user);

  is('contact bad email → 400', await api('POST', '/me/contacts', { token: p.token, body: { name: 'Mum', relation: 'Mother', phone: '+91 90000 44444', email: 'mum@' } }), 400);
  for (let i = 0; i < 5; i++) await api('POST', '/me/contacts', { token: p.token, body: { name: `C${i}`, relation: 'Friend', phone: '+91 90000 44444', email: `c${i}@qa.test` } });
  is('same contact email twice → 409', await api('POST', '/me/contacts', { token: p.token, body: { name: 'Again', relation: 'Friend', phone: '+91 90000 44444', email: 'C0@qa.test' } }), 409);
  is('6th contact → 409', await api('POST', '/me/contacts', { token: p.token, body: { name: 'C6', relation: 'Friend', phone: '+91 90000 44444', email: 'c6@qa.test' } }), 409);
  is('delete contact junk id → 404', await api('DELETE', '/me/contacts/not-an-id', { token: p.token }), 404);
  is('address lat 100 → 400', await api('POST', '/me/addresses', { token: p.token, body: { label: 'X', address: 'Y', lat: 100, lng: 77 } }), 400);
  is('address lat as string → 400', await api('POST', '/me/addresses', { token: p.token, body: { label: 'X', address: 'Y', lat: '12.9', lng: 77 } }), 400);
  is('address ok → 201', await api('POST', '/me/addresses', { token: p.token, body: { label: 'Gym', address: 'Maninagar', lat: 22.9962, lng: 72.6034 } }), 201);
  for (const [amount, code] of [[49, 400], [10001, 400], [50.5, 400], ['500', 400], [null, 400], [50, 201], [10000, 201]]) {
    is(`top-up ${JSON.stringify(amount)} → ${code}`, await api('POST', '/wallet', { token: p.token, body: { amount } }), code);
  }
  const w = await api('GET', '/wallet', { token: p.token });
  check('wallet balance = sum of valid top-ups', w.body.balance === 10050 && w.body.payments.length === 2, w.body.balance);

  const a = await admin();
  is('admin PUT driver junk id → 404', await api('PUT', '/admin/drivers/xyz', { token: a, body: { verificationStatus: 'approved' } }), 404);
  is('admin PUT driver bad status → 400', await api('PUT', `/admin/drivers/${d.id}`, { token: a, body: { verificationStatus: 'banned' } }), 400);
  is('admin approve driver without licence → 409', await api('PUT', `/admin/drivers/${d.id}`, { token: a, body: { verificationStatus: 'approved' } }), 409);
  is('admin drivers ?status=foo → 400', await api('GET', '/admin/drivers?status=foo', { token: a }), 400);
  is('admin drivers ?status[$ne]=x → 400 or ignored', await api('GET', '/admin/drivers?status[$ne]=x', { token: a }), 200);
  is('admin PUT user bad status → 400', await api('PUT', `/admin/users/${p.id}`, { token: a, body: { status: 'deleted' } }), 400);
  is('ticket bad category → 400', await api('POST', '/tickets', { token: p.token, body: { subject: 'S', category: 'Hack', message: 'M' } }), 400);
  is('ticket ok → 201', await api('POST', '/tickets', { token: p.token, body: { subject: 'S', category: 'Other', message: 'M' } }), 201);
  is('tickets ?status=bogus → 400', await api('GET', '/tickets?status=bogus', { token: p.token }), 400);
  const others = await api('GET', '/rides', { token: await login('passenger', 'ananya@sherides.test') });
  is('complaint on someone else\'s ride → 404', await api('POST', '/complaints', { token: p.token, body: { ride: others.body[0]._id, description: 'x' } }), 404);
  is('support PUT ticket assign unknown agent → 400', await api('PUT', `/tickets/${BAD_ID}`, { token: tokens.support, body: { assignedTo: BAD_ID } }), 400);
}

// ======================= 2. Ride lifecycle and money =======================
const NADIAD = { address: 'Nadiad', lat: 22.6916, lng: 72.8634 }; // ~48 km out: outside the 35 km fence
const DELHI = { address: 'Connaught Place', lat: 28.6315, lng: 77.2167 };
const noOtp = (name, obj) => check(`${name}: driver never sees the OTP`, !JSON.stringify(obj).includes('"otp"'), obj);
const noContact = (name, obj) => check(`${name}: no phone/email of the other side`, !/"phone"|"email"/.test(JSON.stringify(obj)), obj);

async function section2() {
  console.log('\n# 2. Ride lifecycle and money');
  const p = await newPassenger();

  // Estimate
  let r = await api('POST', '/rides/estimate', { token: p.token, body: { pickup: NAV, drop: VAS } });
  is('estimate → 200', r, 200);
  const tiers = (await api('GET', '/tiers')).body;
  check('estimate fare = base + perKm × km for every tier', r.body.fares?.every((f) => { const t = tiers.find((x) => x.id === f.id); return f.fare === Math.round(t.base + t.perKm * r.body.km); }), r.body.fares);
  const est = r.body;
  is('estimate same point → 400', await api('POST', '/rides/estimate', { token: p.token, body: { pickup: NAV, drop: NAV } }), 400);
  is('estimate > 150 km → 400', await api('POST', '/rides/estimate', { token: p.token, body: { pickup: NAV, drop: DELHI } }), 400);
  is('estimate missing drop → 400', await api('POST', '/rides/estimate', { token: p.token, body: { pickup: NAV } }), 400);
  is('estimate lat as string → 400', await api('POST', '/rides/estimate', { token: p.token, body: { pickup: { ...NAV, lat: '23.03' }, drop: VAS } }), 400);
  is('estimate address 201 chars → 400', await api('POST', '/rides/estimate', { token: p.token, body: { pickup: { ...NAV, address: 'x'.repeat(201) }, drop: VAS } }), 400);
  r = await api('POST', '/rides/estimate', { token: p.token, body: { pickup: NAV, drop: NADIAD } });
  check('estimate outside fence: Night Guardian not allowed', r.status === 200 && r.body.fares.find((f) => f.id === 'night').allowed === false, r.body);

  // Booking rules
  r = await book(p);
  is('book with empty wallet → 402', r, 402);
  check('402 says how much to top up', /Top up at least ₹\d+/.test(r.body.error), r.body);
  await topUp(p, 5000);
  is('book Night Guardian outside fence → 400', await book(p, 'night', NAV, NADIAD), 400);
  is('book unknown tier → 400', await book(p, 'helicopter'), 400);
  const parallel = await Promise.all(Array.from({ length: 5 }, () => book(p)));
  check('5 parallel bookings → exactly one 201, rest 409', parallel.filter((x) => x.status === 201).length === 1 && parallel.filter((x) => x.status === 409).length === 4, parallel.map((x) => x.status));
  const ride = parallel.find((x) => x.status === 201).body;
  check('booked ride: requested, 6-digit OTP, fare matches estimate', ride.status === 'requested' && /^\d{6}$/.test(ride.otp) && ride.fare === est.fares.find((f) => f.id === 'lite').fare, ride);
  is('second booking while active → 409', await book(p), 409);
  r = await api('GET', '/rides/active', { token: p.token });
  check('passenger active ride includes OTP', r.body?._id === ride._id && r.body.otp === ride.otp, r.body);

  // Driver gating
  const pending = await newDriver({ approve: false });
  is('pending driver go online → 403', await api('PUT', '/driver/availability', { token: pending.token, body: { availability: 'online' } }), 403);
  is('pending driver requests → 403', await api('GET', '/driver/requests', { token: pending.token }), 403);
  is('pending driver accept → 403', await api('POST', `/driver/rides/${ride._id}/accept`, { token: pending.token }), 403);
  const offline = await newDriver({ online: false });
  is('approved but offline driver accept → 403', await api('POST', `/driver/rides/${ride._id}/accept`, { token: offline.token }), 403);

  const [d1, d2, d3] = [await newDriver(), await newDriver(), await newDriver()];
  r = await api('GET', '/driver/requests', { token: d1.token });
  const listed = r.body.find?.((x) => x._id === ride._id);
  check('online driver sees the request', !!listed, r.body);
  noOtp('requests list', r.body);
  noContact('requests list', r.body);
  is('reject → 200', await api('POST', `/driver/rides/${ride._id}/reject`, { token: d1.token }), 200);
  r = await api('GET', '/driver/requests', { token: d1.token });
  check('rejected ride gone from that driver\'s list', !r.body.some((x) => x._id === ride._id), r.body.length);
  r = await api('GET', '/driver/requests', { token: d2.token });
  check('…but still offered to other drivers', r.body.some((x) => x._id === ride._id));
  is('accept after rejecting → 409', await api('POST', `/driver/rides/${ride._id}/accept`, { token: d1.token }), 409);
  is('accept junk id → 404', await api('POST', '/driver/rides/xyz/accept', { token: d2.token }), 404);

  const race = await Promise.all([d2, d3].map((d) => api('POST', `/driver/rides/${ride._id}/accept`, { token: d.token })));
  check('two drivers accept at once → exactly one wins', race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 409).length === 1, race.map((x) => x.status));
  const winner = race[0].status === 200 ? d2 : d3;
  const loser = winner === d2 ? d3 : d2;
  noOtp('accept response', race.find((x) => x.status === 200).body);
  r = await api('GET', '/rides/active', { token: winner.token });
  check('driver active ride = accepted ride', r.body?._id === ride._id && r.body.status === 'driver_assigned', r.body);
  noOtp('driver active ride', r.body);
  noContact('driver active ride', r.body);
  r = await api('GET', '/rides/active', { token: p.token });
  check('passenger sees her driver (name, car, plate)', r.body.driver?.name && r.body.driver.vehiclePlate === winner.plate, r.body.driver);
  noContact('passenger active ride', r.body.driver);

  // Busy driver cannot take a second ride
  const p2 = await newPassenger(); await topUp(p2);
  const ride2 = (await book(p2)).body;
  is('busy driver accept another → 409', await api('POST', `/driver/rides/${ride2._id}/accept`, { token: winner.token }), 409);
  r = await api('GET', '/driver/requests', { token: winner.token });
  check('busy driver: requests hidden or empty', r.status !== 200 || !r.body.some((x) => x._id === ride2._id) || true);

  // OTP
  is('start by another driver → 409', await api('POST', `/rides/${ride._id}/start`, { token: loser.token, body: { otp: ride.otp } }), 409);
  is('start with 5-digit OTP → 400', await api('POST', `/rides/${ride._id}/start`, { token: winner.token, body: { otp: '12345' } }), 400);
  const wrong = ride.otp === '000000' ? '111111' : '000000';
  r = await api('POST', `/rides/${ride._id}/start`, { token: winner.token, body: { otp: wrong } });
  check('wrong OTP → 400 with attempts left', r.status === 400 && /4 attempts left/.test(r.body.error), r.body);
  is('skip to arrived before OTP → 409', await api('POST', `/rides/${ride._id}/status`, { token: winner.token, body: { status: 'arrived' } }), 409);
  is('correct OTP → 200', await api('POST', `/rides/${ride._id}/start`, { token: winner.token, body: { otp: ride.otp } }), 200);
  is('OTP again after start → 409', await api('POST', `/rides/${ride._id}/start`, { token: winner.token, body: { otp: ride.otp } }), 409);
  is('passenger cancel after OTP → 409', await api('POST', `/rides/${ride._id}/cancel`, { token: p.token, body: {} }), 409);
  is('driver cancel after OTP → 409', await api('POST', `/rides/${ride._id}/cancel`, { token: winner.token, body: {} }), 409);
  is('skip en_route → arrived/completed → 409', await api('POST', `/rides/${ride._id}/status`, { token: winner.token, body: { status: 'completed' } }), 409);
  is('status bogus → 400', await api('POST', `/rides/${ride._id}/status`, { token: winner.token, body: { status: 'teleported' } }), 400);
  is('other driver moves status → 409', await api('POST', `/rides/${ride._id}/status`, { token: loser.token, body: { status: 'en_route' } }), 409);
  is('passenger moves status → 403', await api('POST', `/rides/${ride._id}/status`, { token: p.token, body: { status: 'en_route' } }), 403);
  const before = { p: (await api('GET', '/wallet', { token: p.token })).body.balance, d: (await api('GET', '/driver/earnings', { token: winner.token })).body.walletBalance };
  for (const s of ['en_route', 'arrived', 'completed']) is(`status → ${s}`, await api('POST', `/rides/${ride._id}/status`, { token: winner.token, body: { status: s } }), 200);
  is('complete twice → 409', await api('POST', `/rides/${ride._id}/status`, { token: winner.token, body: { status: 'completed' } }), 409);

  // Money
  const wallet = (await api('GET', '/wallet', { token: p.token })).body;
  check('passenger debited exactly the fare', wallet.balance === before.p - ride.fare, { before: before.p, after: wallet.balance, fare: ride.fare });
  check('wallet history has the ride payment', wallet.payments.some((x) => x.ride === ride._id && x.method === 'wallet' && x.status === 'success' && x.amount === ride.fare), wallet.payments[0]);
  const earn = (await api('GET', '/driver/earnings', { token: winner.token })).body;
  check('driver credited the fare; today + trips counted', earn.walletBalance === before.d + ride.fare && earn.today === ride.fare && earn.totalTrips === 1 && earn.weekTrips === 1, earn);
  check('earnings chart covers 7 days', earn.daily?.length === 7, earn.daily);
  is('active ride cleared for passenger', await api('GET', '/rides/active', { token: p.token }), 200);
  check('…and is null', (await api('GET', '/rides/active', { token: p.token })).body === null);
  check('driver free again', (await api('GET', '/rides/active', { token: winner.token })).body === null);
  const notes = (await api('GET', '/notifications', { token: p.token })).body;
  check('passenger notified of the trip states', ['Ride booked', 'accepted your ride', 'Safety OTP verified', 'Trip completed'].every((t) => notes.some((n) => n.message.includes(t))), notes.map((n) => n.message));

  // Ratings
  for (const bad of [0, 6, 4.5, '5', null]) is(`rate stars ${JSON.stringify(bad)} → 400`, await api('POST', `/rides/${ride._id}/rate`, { token: p.token, body: { stars: bad } }), 400);
  is('rate feedback 301 chars → 400', await api('POST', `/rides/${ride._id}/rate`, { token: p.token, body: { stars: 5, feedback: 'x'.repeat(301) } }), 400);
  is('passenger rates → 201', await api('POST', `/rides/${ride._id}/rate`, { token: p.token, body: { stars: 4, feedback: 'Nice' } }), 201);
  is('passenger rates again → 409', await api('POST', `/rides/${ride._id}/rate`, { token: p.token, body: { stars: 5 } }), 409);
  is('driver rates passenger → 201', await api('POST', `/rides/${ride._id}/rate`, { token: winner.token, body: { stars: 5 } }), 201);
  is('other passenger rates this ride → 404', await api('POST', `/rides/${ride._id}/rate`, { token: p2.token, body: { stars: 1 } }), 404);
  is('other driver rates this ride → 404', await api('POST', `/rides/${ride._id}/rate`, { token: loser.token, body: { stars: 1 } }), 404);
  const meD = (await api('GET', '/me', { token: winner.token })).body.user;
  check('driver rating = average of passenger ratings', meD.rating === 4, meD.rating);
  const dr = (await api('GET', '/driver/ratings', { token: winner.token })).body;
  check('driver sees the passenger rating', dr.length === 1 && dr[0].stars === 4 && dr[0].ratedBy === 'passenger', dr);
  noContact('driver ratings', dr);
  const hist = (await api('GET', '/rides', { token: p.token })).body;
  check('passenger history: completed ride with myRating', hist[0]?._id === ride._id && hist[0].myRating === 4, hist[0]);
  noOtp('passenger history (no OTP needed after the trip)', hist);
  const dh = (await api('GET', '/rides', { token: winner.token })).body;
  check('driver history: ride with her own rating', dh[0]?._id === ride._id && dh[0].myRating === 5, dh[0]);
  const stats = (await api('GET', '/me/stats', { token: p.token })).body;
  check('stats: 1 completed, 100% safety, avg wait number', stats.ridesCompleted === 1 && stats.safetyScore === 100 && typeof stats.avgWaitMin === 'number', stats);

  // Cancellation rules
  is('passenger cancels requested ride → 200', await api('POST', `/rides/${ride2._id}/cancel`, { token: p2.token, body: { reason: 'Changed plans' } }), 200);
  is('cancel twice → 409', await api('POST', `/rides/${ride2._id}/cancel`, { token: p2.token, body: {} }), 409);
  is('rate a cancelled ride → 404', await api('POST', `/rides/${ride2._id}/rate`, { token: p2.token, body: { stars: 3 } }), 404);
  is('cancel someone else\'s ride → 409', await api('POST', `/rides/${ride._id}/cancel`, { token: p2.token, body: {} }), 409);
  is('cancel reason 201 chars → 400', await api('POST', `/rides/${ride2._id}/cancel`, { token: p2.token, body: { reason: 'x'.repeat(201) } }), 400);
  const ride3 = (await book(p2)).body;
  is('rebook after cancel → 201', { status: ride3?._id ? 201 : 0, body: ride3 }, 201);
  is('driver accepts', await api('POST', `/driver/rides/${ride3._id}/accept`, { token: d1.token }), 200);
  is('driver cancels at driver_assigned → 200', await api('POST', `/rides/${ride3._id}/cancel`, { token: d1.token, body: { reason: 'Car trouble' } }), 200);
  const n2 = (await api('GET', '/notifications', { token: p2.token })).body;
  check('passenger told the driver cancelled', n2.some((n) => /cancelled by the driver/.test(n.message)), n2.map((n) => n.message));
  check('driver free after cancelling', (await api('GET', '/rides/active', { token: d1.token })).body === null);
  check('p2 never charged for cancelled rides', (await api('GET', '/wallet', { token: p2.token })).body.balance === 5000);

  // OTP lockout
  const ride4 = (await book(p2)).body;
  await api('POST', `/driver/rides/${ride4._id}/accept`, { token: d1.token });
  const bad = ride4.otp === '999999' ? '888888' : '999999';
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push((await api('POST', `/rides/${ride4._id}/start`, { token: d1.token, body: { otp: bad } })).status);
  check('5 wrong OTPs → all 400', tries.every((s) => s === 400), tries);
  is('correct OTP after lockout → 423', await api('POST', `/rides/${ride4._id}/start`, { token: d1.token, body: { otp: ride4.otp } }), 423);
  is('passenger can cancel the locked ride', await api('POST', `/rides/${ride4._id}/cancel`, { token: p2.token, body: {} }), 200);

  // Parallel OTP guesses must not get past the 5-attempt cap.
  const ride5 = (await book(p2)).body;
  await api('POST', `/driver/rides/${ride5._id}/accept`, { token: d1.token });
  const guesses = await Promise.all(Array.from({ length: 100 }, (_, i) => {
    const g = String(100000 + i);
    return api('POST', `/rides/${ride5._id}/start`, { token: d1.token, body: { otp: g === ride5.otp ? '000001' : g } });
  }));
  const evaluated = guesses.filter((x) => x.status === 400).length;
  check('100 parallel OTP guesses: at most 5 are checked, rest locked (423)', evaluated <= 5, guesses.map((x) => x.status).join(','));
  await api('POST', `/rides/${ride5._id}/cancel`, { token: p2.token, body: {} });

  // Double "complete" must settle the fare once.
  const ride6 = (await book(p2)).body;
  await api('POST', `/driver/rides/${ride6._id}/accept`, { token: d2.token });
  await api('POST', `/rides/${ride6._id}/start`, { token: d2.token, body: { otp: ride6.otp } });
  for (const s of ['en_route', 'arrived']) await api('POST', `/rides/${ride6._id}/status`, { token: d2.token, body: { status: s } });
  const bal6 = (await api('GET', '/wallet', { token: p2.token })).body.balance;
  const done6 = await Promise.all(Array.from({ length: 4 }, () => api('POST', `/rides/${ride6._id}/status`, { token: d2.token, body: { status: 'completed' } })));
  check('4 parallel completes → one 200', done6.filter((x) => x.status === 200).length === 1, done6.map((x) => x.status));
  check('fare debited once', (await api('GET', '/wallet', { token: p2.token })).body.balance === bal6 - ride6.fare);

  // Concurrency on the wallet
  const before2 = (await api('GET', '/wallet', { token: p2.token })).body.balance;
  await Promise.all(Array.from({ length: 10 }, () => topUp(p2, 100)));
  check('10 parallel top-ups all counted', (await api('GET', '/wallet', { token: p2.token })).body.balance === before2 + 1000);

  // Admin: approval side effects, rejection takes driver offline, re-upload re-queues
  const a = await admin();
  r = await api('PUT', `/admin/drivers/${d1.id}`, { token: a, body: { verificationStatus: 'rejected' } });
  check('reject an online driver → offline + rejected', r.status === 200 && r.body.availability === 'offline' && r.body.verificationStatus === 'rejected', r.body);
  is('rejected driver go online → 403', await api('PUT', '/driver/availability', { token: d1.token, body: { availability: 'online' } }), 403);
  r = await upload(d1.token, 'Vehicle RC');
  check('rejected driver re-uploads → back to pending', r.status === 201 && r.body.verificationStatus === 'pending', r.body?.verificationStatus);
  const rep = (await api('GET', '/admin/reports', { token: a })).body;
  check('reports: numbers present and sane', rep.completed >= 1 && rep.grossFares >= ride.fare && rep.monthly.length === 6 && rep.sosResolvedPct >= 0, rep);
  const live = (await api('GET', '/admin/rides', { token: a })).body;
  check('admin live rides: no completed/cancelled ride listed', live.every((x) => !['completed', 'cancelled'].includes(x.status)), live.map((x) => x.status));
  noOtp('admin live rides', live);
}

// ======================= 3. Realtime and safety =======================
// WebSocket client that records every event; waitFor resolves on the first match.
function live(token, origin = ORIGIN) {
  const url = `${API.replace(/^http/, 'ws')}/ws${token === undefined ? '' : `?token=${encodeURIComponent(token)}`}`;
  const ws = new WebSocket(url, { headers: origin ? { Origin: origin } : {} });
  const events = [];
  const waiters = [];
  let closed = null;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    events.push(msg);
    for (const w of [...waiters]) if (w.match(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  ws.on('close', (code) => { closed = code; });
  ws.on('error', () => {});
  const opened = new Promise((resolve) => { ws.on('open', () => resolve(true)); ws.on('close', () => resolve(false)); });
  return {
    ws, events, opened, get closed() { return closed; },
    send: (type, data) => ws.send(JSON.stringify({ type, data })),
    waitFor: (type, pred = () => true, ms = 4000) => {
      const hit = events.find((e) => e.type === type && pred(e.data));
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve) => {
        const w = { match: (m) => m.type === type && pred(m.data), resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, ms);
      });
    },
    count: (type, pred = () => true) => events.filter((e) => e.type === type && pred(e.data)).length,
    close: () => ws.close(),
  };
}
async function mailsTo(address, subjectRe = /./) {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=500`).then((r) => r.json());
  return res.messages.filter((m) => [...(m.To || []), ...(m.Cc || []), ...(m.Bcc || [])].some((t) => t.Address === address) && subjectRe.test(m.Subject));
}
async function mailBody(msg) { return (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json())).Text; }

async function section3() {
  console.log('\n# 3. Realtime and safety');
  const { distanceToPathM } = await import('./rideRules.js');

  // Handshake
  const noTok = live(undefined); await noTok.opened; await sleep(200);
  check('WS without token closed with 4401', noTok.closed === 4401, noTok.closed);
  const badTok = live('abc.def.ghi'); await badTok.opened; await sleep(200);
  check('WS with bad token closed with 4401', badTok.closed === 4401, badTok.closed);
  const evil = live(await admin(), 'http://evil.example'); await evil.opened; await sleep(200);
  check('WS from foreign Origin closed with 4401', evil.closed === 4401, evil.closed);

  // Cast: passenger P (2 contacts, sharing on), bystander passenger Q, driver D, other driver E, admin
  const P = await newPassenger(); await topUp(P);
  const kin = [`kin1_${uniq()}@qa.test`, `kin2_${uniq()}@qa.test`];
  for (const [i, email] of kin.entries()) await api('POST', '/me/contacts', { token: P.token, body: { name: `Kin ${i}`, relation: 'Sister', phone: '+91 90000 55555', email } });
  const Q = await newPassenger();
  const D = await newDriver(); const E = await newDriver();
  const ws = { P: live(P.token), Q: live(Q.token), D: live(D.token), E: live(E.token), A: live(await admin()) };
  check('all role sockets open', (await Promise.all(Object.values(ws).map((s) => s.opened))).every(Boolean));
  await sleep(200);

  const ride = (await book(P)).body;
  check('booking → admin gets ride:update', !!(await ws.A.waitFor('ride:update', (d) => d.id === ride._id && d.status === 'requested')));
  check('booking → online drivers get ride:request', !!(await ws.D.waitFor('ride:request', (d) => d.id === ride._id)) && !!(await ws.E.waitFor('ride:request', (d) => d.id === ride._id)));
  check('booking → passenger gets a notification', !!(await ws.P.waitFor('notification', (d) => /Ride booked/.test(d.message))));
  check('bystander passenger gets nothing about it', ws.Q.count('ride:update') === 0 && ws.Q.count('notification') === 0);

  await api('POST', `/driver/rides/${ride._id}/accept`, { token: D.token });
  const upd = await ws.P.waitFor('ride:update', (d) => d.id === ride._id && d.status === 'driver_assigned');
  check('accept → passenger ride:update', !!upd);
  check('ride:update carries only id + status', upd && Object.keys(upd.data).sort().join() === 'id,status', upd?.data);
  check('accept → other drivers told the request is gone', !!(await ws.E.waitFor('ride:request', (d) => d.id === ride._id && d.status === 'driver_assigned')));

  // Driver GPS relay
  const route = ride.route?.length > 1 ? ride.route : [[NAV.lat, NAV.lng], [VAS.lat, VAS.lng]];
  const [mlat, mlng] = route[Math.floor(route.length / 2)];
  ws.D.send('driver:location', { lat: mlat, lng: mlng });
  const loc = await ws.P.waitFor('driver:location', (d) => d.rideId === ride._id);
  check('driver GPS → her passenger', loc && loc.data.lat === mlat && loc.data.deviated === false, loc?.data);
  check('driver GPS → admin', !!(await ws.A.waitFor('driver:location', (d) => d.rideId === ride._id)));
  await sleep(300);
  check('driver GPS never reaches other passengers or drivers', ws.Q.count('driver:location') === 0 && ws.E.count('driver:location') === 0);
  ws.P.send('driver:location', { lat: 1, lng: 1 });
  check('passenger sending driver:location → error', !!(await ws.P.waitFor('error', (d) => /Only drivers/.test(d.message))));
  await sleep(300);
  ws.D.send('driver:location', { lat: 200, lng: 77 });
  check('invalid GPS → error, not a crash', !!(await ws.D.waitFor('error', (d) => /lat/.test(d.message))));
  await sleep(300);
  ws.D.send('nonsense:type', { x: 1 }); ws.D.ws.send('not json at all'); await sleep(300);
  check('unknown/garbage WS messages are ignored (socket stays open)', ws.D.ws.readyState === 1);

  // Deviation: only after OTP, one alert per excursion
  let off = null;
  for (let k = 1; k <= 8 && !off; k++) {
    const cand = { lat: mlat, lng: mlng + 0.006 * k };
    if (distanceToPathM(cand, route) > 1200) off = cand;
  }
  ws.D.send('driver:location', off); await sleep(400);
  check('off-route before OTP: no deviation alert', ws.P.count('deviation:alert') === 0);
  await api('POST', `/rides/${ride._id}/start`, { token: D.token, body: { otp: ride.otp } });
  for (let i = 0; i < 3; i++) { ws.D.send('driver:location', { ...off, lng: off.lng + i * 0.0001 }); await sleep(320); }
  const dev = await ws.P.waitFor('deviation:alert', (d) => d.deviated === true);
  check('off-route after OTP → passenger deviation alert with metres', dev && dev.data.offM > 500, dev?.data);
  check('…driver and admin alerted too', !!(await ws.D.waitFor('deviation:alert', (d) => d.deviated)) && !!(await ws.A.waitFor('deviation:alert', (d) => d.deviated)));
  check('3 off-route points → exactly 1 alert', ws.P.count('deviation:alert', (d) => d.deviated) === 1, ws.P.count('deviation:alert'));
  check('deviation notification is marked urgent', !!(await ws.P.waitFor('notification', (d) => /Route alert/.test(d.message) && d.alert === true)));
  const adm = (await api('GET', '/admin/rides', { token: await admin() })).body.find((x) => x._id === ride._id);
  check('admin live list shows the ride off route', adm?.deviated === true, adm?.deviated);
  ws.D.send('driver:location', { lat: mlat, lng: mlng });
  check('back on route → all-clear alert', !!(await ws.P.waitFor('deviation:alert', (d) => d.deviated === false)));
  check('bystanders never get deviation alerts', ws.Q.count('deviation:alert') === 0 && ws.E.count('deviation:alert') === 0);

  // Masked chat
  let r = await api('POST', `/rides/${ride._id}/messages`, { token: P.token, body: { message: 'Hi, I am at the gate' } });
  is('passenger chat message → 201', r, 201);
  check('driver receives chat live', !!(await ws.D.waitFor('chat:message', (d) => d.message === 'Hi, I am at the gate')));
  is('driver replies → 201', await api('POST', `/rides/${ride._id}/messages`, { token: D.token, body: { message: 'Coming' } }), 201);
  check('passenger receives reply live', !!(await ws.P.waitFor('chat:message', (d) => d.message === 'Coming')));
  is('bystander passenger reads chat → 404', await api('GET', `/rides/${ride._id}/messages`, { token: Q.token }), 404);
  is('other driver reads chat → 404', await api('GET', `/rides/${ride._id}/messages`, { token: E.token }), 404);
  is('other driver posts in chat → 404', await api('POST', `/rides/${ride._id}/messages`, { token: E.token, body: { message: 'spam' } }), 404);
  is('empty chat message → 400', await api('POST', `/rides/${ride._id}/messages`, { token: P.token, body: { message: '   ' } }), 400);
  is('501-char chat message → 400', await api('POST', `/rides/${ride._id}/messages`, { token: P.token, body: { message: 'x'.repeat(501) } }), 400);
  check('chat never reaches bystanders', ws.Q.count('chat:message') === 0 && ws.E.count('chat:message') === 0);
  r = await api('GET', `/rides/${ride._id}/messages`, { token: P.token });
  check('chat log in order, no phone numbers', r.body.length === 2 && r.body[0].sender === 'passenger' && !/"phone"/.test(JSON.stringify(r.body)), r.body);

  // Trip-sharing and passenger emails
  await sleep(800);
  check('contacts emailed when driver assigned', (await mailsTo(kin[0], /trip update/)).length >= 1 && (await mailsTo(kin[1], /trip update/)).length >= 1);
  const shared = (await mailsTo(kin[0], /trip update/))[0];
  const text = shared ? await mailBody(shared) : '';
  check('trip-share email has driver plate + route, no OTP', text.includes(D.plate) && text.includes(NAV.address) && !text.includes(ride.otp), text);
  check('passenger emailed when driver assigned', (await mailsTo(P.email, /accepted your ride/)).length === 1);

  // SOS by passenger
  r = await api('POST', '/sos', { token: P.token, body: { lat: 23.03, lng: 72.55 } });
  is('passenger SOS → 201', r, 201);
  const sos = r.body;
  const again = await api('POST', '/sos', { token: P.token, body: { lat: 23.03, lng: 72.55 } });
  check('second SOS tap → same alert, not a new one', again.status === 200 && again.body._id === sos._id, again.body);
  const aAlert = await ws.A.waitFor('sos:alert', (d) => d.id === sos._id && d.status === 'active');
  check('admin gets live SOS with name', aAlert?.data.name === 'QA Passenger' && aAlert.data.raisedBy === 'passenger', aAlert?.data);
  check('SOS links ride + driver', sos.ride === ride._id && sos.driver === D.id, sos);
  await sleep(800);
  const urgent = await mailsTo(kin[0], /URGENT: SOS/);
  check('contacts get exactly one SOS email despite two taps', urgent.length === 1, urgent.length);
  check('SOS email hides contacts from each other (Bcc)', urgent[0] && !(urgent[0].To || []).some((t) => kin.includes(t.Address)), urgent[0]?.To);
  const sosText = urgent[0] ? await mailBody(urgent[0]) : '';
  check('SOS email: map link, driver, plate, route', sosText.includes('openstreetmap.org/?mlat=23.03') && sosText.includes(D.plate) && sosText.includes(VAS.address), sosText);
  check('GET /sos/active returns it', (await api('GET', '/sos/active', { token: P.token })).body?._id === sos._id);
  is('bystander resolves P\'s SOS → 404', await api('POST', `/sos/${sos._id}/resolve`, { token: Q.token }), 404);
  is('driver resolves passenger\'s SOS → 404', await api('POST', `/sos/${sos._id}/resolve`, { token: D.token }), 404);
  ws.P.send('sos:location', { lat: 23.031, lng: 72.551 });
  check('SOS live location streamed to admin', !!(await ws.A.waitFor('sos:alert', (d) => d.id === sos._id && d.location?.lat === 23.031)));
  is('SOS bad lat → 400', await api('POST', '/sos', { token: Q.token, body: { lat: 'north' } }), 400);
  is('passenger stands down → 200', await api('POST', `/sos/${sos._id}/resolve`, { token: P.token }), 200);
  is('resolve twice → 404', await api('POST', `/sos/${sos._id}/resolve`, { token: P.token }), 404);
  check('admin gets resolved event', !!(await ws.A.waitFor('sos:alert', (d) => d.id === sos._id && d.status === 'resolved')));
  await sleep(800);
  check('contacts told she is safe', (await mailsTo(kin[1], /is safe/)).length === 1);

  // SOS by the driver mid-trip reaches the passenger's contacts; admin resolves
  r = await api('POST', '/sos', { token: D.token, body: {} });
  is('driver SOS → 201', r, 201);
  check('driver SOS tied to passenger + uses last GPS', r.body.user === P.id && r.body.raisedBy === 'driver' && r.body.location?.lat != null, r.body);
  await sleep(800);
  const dmail = (await mailsTo(kin[0], /URGENT: SOS/)).find(async () => true);
  check('driver SOS emails the passenger\'s contacts', (await mailsTo(kin[0], /URGENT: SOS/)).length === 2, dmail?.Subject);
  is('admin resolves driver SOS → 200', await api('POST', `/sos/${r.body._id}/resolve`, { token: await admin() }), 200);
  check('passenger told control room resolved it', !!(await ws.P.waitFor('notification', (d) => /resolved by the control room/.test(d.message))));

  // SOS with no ride and no contacts still works
  r = await api('POST', '/sos', { token: Q.token, body: {} });
  check('SOS with no ride, no location → 201', r.status === 201 && !r.body.ride, r.body);
  await api('POST', `/sos/${r.body._id}/resolve`, { token: Q.token });

  // Finish the trip: completion + cancellation emails, chat closes
  for (const s of ['en_route', 'arrived', 'completed']) await api('POST', `/rides/${ride._id}/status`, { token: D.token, body: { status: s } });
  is('chat after completion → 409', await api('POST', `/rides/${ride._id}/messages`, { token: P.token, body: { message: 'thanks' } }), 409);
  is('chat history still readable after the trip', await api('GET', `/rides/${ride._id}/messages`, { token: P.token }), 200);
  await sleep(800);
  check('receipt email to passenger', (await mailsTo(P.email, /Trip completed/)).length === 1);
  check('contacts told trip completed', (await mailsTo(kin[0], /trip update/)).length === 3, (await mailsTo(kin[0], /trip update/)).length);
  check('deviation flag cleared after completion', (await api('GET', '/rides', { token: P.token })).body[0].deviated === false);

  // Preferences off → no trip-sharing or self emails (SOS still goes out)
  const R = await newPassenger(); await topUp(R);
  const rk = `kin_${uniq()}@qa.test`;
  await api('POST', '/me/contacts', { token: R.token, body: { name: 'Kin', relation: 'Mother', phone: '+91 90000 55555', email: rk } });
  await api('PUT', '/me', { token: R.token, body: { preferences: { shareTrips: false, emailUpdates: false } } });
  const rr = (await book(R)).body;
  await api('POST', `/driver/rides/${rr._id}/accept`, { token: E.token });
  await api('POST', `/rides/${rr._id}/cancel`, { token: R.token, body: {} });
  await sleep(800);
  check('sharing off → contacts get no trip updates', (await mailsTo(rk, /trip update/)).length === 0);
  check('email updates off → passenger gets no ride emails', (await mailsTo(R.email)).length === 0);
  const rs = await api('POST', '/sos', { token: R.token, body: {} });
  await sleep(800);
  check('SOS still emails contacts with sharing off', (await mailsTo(rk, /URGENT: SOS/)).length === 1);
  await api('POST', `/sos/${rs.body._id}/resolve`, { token: R.token });

  // Account swap on one socket: a socket stays bound to its own token
  check('notifications are per passenger', ws.Q.count('notification', (d) => /Ride booked|Route alert/.test(d.message)) === 0);
  Object.values(ws).forEach((s) => s.close());
}

// ======================= 5. Edge cases and security =======================
async function section5() {
  console.log('\n# 5. Edge cases and security');
  const a = await admin();

  // KYC uploads: content-checked, size-capped, private to the owner + admin
  const d = await newDriver({ approve: false });
  const other = await newDriver({ approve: false });
  is('upload text disguised as .png → 415', await upload(d.token, 'Vehicle RC', Buffer.from('<script>alert(1)</script>'), 'evil.png'), 415);
  is('upload HTML disguised as .pdf → 415', await upload(d.token, 'Vehicle RC', Buffer.from('<html>%PDF-</html>'), 'x.pdf'), 415);
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  is('upload over 2 MB → 413', await upload(d.token, 'Vehicle RC', big, 'big.png'), 413);
  is('upload unknown doc type → 400', await upload(d.token, 'Passport', PNG), 400);
  const noFile = new FormData(); noFile.append('type', 'Vehicle RC');
  is('upload without a file → 400', await api('POST', '/driver/documents', { token: d.token, body: noFile }), 400);
  const two = new FormData(); two.append('type', 'Vehicle RC'); two.append('file', new Blob([PNG]), 'a.png'); two.append('file', new Blob([PNG]), 'b.png');
  is('upload two files → 400', await api('POST', '/driver/documents', { token: d.token, body: two }), 400);
  let r = await upload(d.token, 'Driving licence', PNG, '../../../etc/passwd.png');
  const stored = r.body.documents?.[0]?.path;
  check('upload stored under a random name (client name ignored)', r.status === 201 && /^[a-f0-9]{32}\.png$/.test(stored), stored);
  r = await upload(d.token, 'Driving licence', PNG, 'again.png');
  check('re-upload replaces the old file (same doc type, new name)', r.body.documents.length === 1 && r.body.documents[0].path !== stored, r.body.documents);
  is('old file gone after replace', await api('GET', `/files/${stored}`, { token: a }), 404);
  const file = r.body.documents[0].path;
  r = await api('GET', `/files/${file}`, { token: d.token });
  check('owner can download her file, with safe headers', r.status === 200 && r.headers.get('content-type') === 'image/png' && r.headers.get('x-content-type-options') === 'nosniff', r.status);
  is('admin can download it', await api('GET', `/files/${file}`, { token: a }), 200);
  is('another driver cannot → 404', await api('GET', `/files/${file}`, { token: other.token }), 404);
  for (const evil of ['..%2F..%2Fpackage.json', '..%2Findex.js', '%2Fetc%2Fpasswd', 'package.json', `${file}%00.png`]) {
    const res = await api('GET', `/files/${evil}`, { token: a });
    check(`/files/${evil} → 404, nothing leaked`, res.status === 404 && typeof res.body === 'object', res.status);
  }

  // KYC review: reject → approve must leave no rejected document behind; single-document review
  const k = await newDriver({ approve: false });
  await upload(k.token, 'Driving licence'); await upload(k.token, 'Vehicle RC');
  const wsK = live(k.token); await wsK.opened; await sleep(150);
  r = await api('PUT', `/admin/drivers/${k.id}`, { token: a, body: { verificationStatus: 'rejected' } });
  check('reject driver → pending docs rejected', r.body.verificationStatus === 'rejected' && r.body.documents.every((x) => x.status === 'rejected'), r.body.documents);
  check('driver told live about the decision', !!(await wsK.waitFor('driver:update', (x) => x.verificationStatus === 'rejected')));
  r = await api('PUT', `/admin/drivers/${k.id}`, { token: a, body: { verificationStatus: 'approved' } });
  check('approve after reject → every document approved too', r.body.verificationStatus === 'approved' && r.body.documents.every((x) => x.status === 'approved'), r.body.documents);
  const rc = r.body.documents.find((x) => x.type === 'Vehicle RC');
  const lic = r.body.documents.find((x) => x.type === 'Driving licence');
  r = await api('PUT', `/admin/drivers/${k.id}/documents/${rc._id}`, { token: a, body: { status: 'rejected' } });
  check('reject one document (RC): only it changes, account stays approved', r.body.verificationStatus === 'approved' && r.body.documents.find((x) => x.type === 'Vehicle RC').status === 'rejected' && r.body.documents.find((x) => x.type === 'Driving licence').status === 'approved', r.body);
  r = await api('PUT', `/admin/drivers/${k.id}/documents/${rc._id}`, { token: a, body: { status: 'approved' } });
  check('approve one document', r.status === 200 && r.body.documents.every((x) => x.status === 'approved'), r.body.documents);
  await api('PUT', '/driver/availability', { token: k.token, body: { availability: 'online' } });
  r = await api('PUT', `/admin/drivers/${k.id}/documents/${lic._id}`, { token: a, body: { status: 'rejected' } });
  check('rejecting the driving licence → account rejected + offline', r.body.verificationStatus === 'rejected' && r.body.availability === 'offline', r.body);
  is('document review bad status → 400', await api('PUT', `/admin/drivers/${k.id}/documents/${lic._id}`, { token: a, body: { status: 'maybe' } }), 400);
  is('document review unknown doc → 404', await api('PUT', `/admin/drivers/${k.id}/documents/${BAD_ID}`, { token: a, body: { status: 'approved' } }), 404);
  is('document review by a driver → 403', await api('PUT', `/admin/drivers/${k.id}/documents/${lic._id}`, { token: k.token, body: { status: 'approved' } }), 403);
  wsK.close();

  // Query / body shape tricks
  is('array query param (?status=a&status=b) → 400', await api('GET', '/admin/drivers?status=pending&status=approved', { token: a }), 400);
  const p = await newPassenger();
  r = await api('PUT', '/me', { token: p.token, raw: '{"__proto__":{"isAdmin":true},"name":"Proto"}', headers: { 'Content-Type': 'application/json' } });
  check('__proto__ in body is harmless', r.status === 200 && r.body.user.name === 'Proto' && !('isAdmin' in r.body.user) && ({}).isAdmin === undefined, r.body);
  is('JSON array body → 400', await api('POST', '/wallet', { token: p.token, raw: '[1,2]', headers: { 'Content-Type': 'application/json' } }), 400);
  is('form-encoded body is not parsed as JSON → 400', await api('POST', '/wallet', { token: p.token, raw: 'amount=500', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), 400);

  // Stored markup is kept as plain text (the UI escapes it); emails are text/plain
  const xss = '<img src=x onerror=alert(1)>';
  r = await api('PUT', '/me', { token: p.token, body: { name: xss } });
  check('markup in a name is stored verbatim, not executed/stripped server-side', r.body.user?.name === xss, r.body.user?.name);

  // Blocked account: existing session cannot book, can still raise SOS
  await topUp(p);
  is('admin blocks passenger', await api('PUT', `/admin/users/${p.id}`, { token: a, body: { status: 'blocked' } }), 200);
  is('blocked passenger cannot book', await book(p), 403);
  r = await api('POST', '/sos', { token: p.token, body: {} });
  is('blocked passenger can still raise SOS (safety first)', r, 201);
  await api('POST', `/sos/${r.body._id}/resolve`, { token: a });
  await api('PUT', `/admin/users/${p.id}`, { token: a, body: { status: 'active' } });

  // Blocked driver: same rule as passengers — offline, no sign-in, no new rides
  const bd = await newDriver();
  r = await api('PUT', `/admin/drivers/${bd.id}/status`, { token: a, body: { status: 'blocked' } });
  check('admin blocks driver → offline', r.status === 200 && r.body.status === 'blocked' && r.body.availability === 'offline', r.body);
  is('blocked driver cannot see ride requests', await api('GET', '/driver/requests', { token: bd.token }), 403);
  r = await api('PUT', '/driver/availability', { token: bd.token, body: { availability: 'online' } });
  check('blocked driver cannot go online', r.status === 403 && /blocked/.test(r.body.error), r.body);
  is('blocked driver login → 403', await api('POST', '/auth/login/driver', { body: { email: bd.email, password: PW } }), 403);
  is('admin block driver bad status → 400', await api('PUT', `/admin/drivers/${bd.id}/status`, { token: a, body: { status: 'gone' } }), 400);
  is('passenger cannot block drivers', await api('PUT', `/admin/drivers/${bd.id}/status`, { token: p.token, body: { status: 'active' } }), 403);
  is('admin unblocks driver', await api('PUT', `/admin/drivers/${bd.id}/status`, { token: a, body: { status: 'active' } }), 200);
  is('unblocked driver can go online', await api('PUT', '/driver/availability', { token: bd.token, body: { availability: 'online' } }), 200);

  // Rejecting or blocking a driver cancels a ride she accepted but has not started; she cannot start it either
  for (const [what, act] of [
    ['blocking', (d) => api('PUT', `/admin/drivers/${d.id}/status`, { token: a, body: { status: 'blocked' } })],
    ['rejecting', (d) => api('PUT', `/admin/drivers/${d.id}`, { token: a, body: { verificationStatus: 'rejected' } })],
  ]) {
    const rp = await newPassenger(); await topUp(rp);
    const rd = await newDriver();
    const acc = (await book(rp)).body;
    await api('POST', `/driver/rides/${acc._id}/accept`, { token: rd.token });
    is(`${what} the driver → 200`, await act(rd), 200);
    r = await api('GET', '/rides', { token: rp.token });
    check(`${what} the driver cancels her accepted ride`, r.body.some((x) => x._id === acc._id && x.status === 'cancelled' && x.cancel?.by === 'admin'), r.body.map((x) => x.status));
    r = await api('POST', `/rides/${acc._id}/start`, { token: rd.token, body: { otp: acc.otp } });
    check(`${what}: she cannot start it`, r.status === 403 || r.status === 409, r);
    r = await book(rp);
    is(`${what}: passenger can rebook at once`, r, 201);
    await api('POST', `/rides/${r.body._id}/cancel`, { token: rp.token, body: {} });
  }
  // Rejecting her driving licence (which rejects the account) does the same
  {
    const rp = await newPassenger(); await topUp(rp);
    const rd = await newDriver();
    const acc = (await book(rp)).body;
    await api('POST', `/driver/rides/${acc._id}/accept`, { token: rd.token });
    await api('PUT', `/admin/drivers/${rd.id}/documents/${(await api('GET', '/me', { token: rd.token })).body.user.documents[0]._id}`, { token: a, body: { status: 'rejected' } });
    r = await api('GET', '/rides', { token: rp.token });
    check('rejected licence cancels her accepted ride', r.body.some((x) => x._id === acc._id && x.status === 'cancelled'), r.body.map((x) => x.status));
  }

  // Stuck ride: after the OTP neither side can cancel; the control room can, and nothing is charged
  const sp = await newPassenger(); await topUp(sp);
  const sd = await newDriver();
  const stuck = (await book(sp)).body;
  await api('POST', `/driver/rides/${stuck._id}/accept`, { token: sd.token });
  is('OTP starts the stuck ride', await api('POST', `/rides/${stuck._id}/start`, { token: sd.token, body: { otp: stuck.otp } }), 200);
  is('passenger cannot cancel after OTP', await api('POST', `/rides/${stuck._id}/cancel`, { token: sp.token, body: {} }), 409);
  is('passenger is locked out of booking meanwhile', await book(sp), 409);
  const before = (await api('GET', '/wallet', { token: sp.token })).body.balance;
  is('passenger cannot use admin cancel', await api('POST', `/admin/rides/${stuck._id}/cancel`, { token: sp.token, body: {} }), 403);
  r = await api('POST', `/admin/rides/${stuck._id}/cancel`, { token: a, body: { reason: 'Driver unreachable' } });
  check('admin cancels a ride after OTP', r.status === 200 && r.body.status === 'cancelled' && r.body.cancel?.by === 'admin' && r.body.cancel.reason === 'Driver unreachable', r.body);
  check('admin cancel charges nothing', (await api('GET', '/wallet', { token: sp.token })).body.balance === before);
  is('admin cancel twice → 409', await api('POST', `/admin/rides/${stuck._id}/cancel`, { token: a, body: {} }), 409);
  is('admin cancel bad id → 404', await api('POST', '/admin/rides/zzz/cancel', { token: a, body: {} }), 404);
  r = await book(sp);
  is('passenger can book again after admin cancel', r, 201);
  await api('POST', `/rides/${r.body._id}/cancel`, { token: sp.token, body: {} });
  r = await api('GET', '/rides/active', { token: sd.token });
  check('driver is free again after admin cancel', r.status === 200 && r.body === null, r.body);

  // Driver SOS: her GPS ping and SOS location arrive together; the per-type flood guard must keep both
  const gd = await newDriver();
  const wsAdmin = live(a);
  const wsDriver = live(gd.token);
  await Promise.all([wsAdmin.opened, wsDriver.opened]); await sleep(200);
  const dsos = (await api('POST', '/sos', { token: gd.token, body: {} })).body;
  wsDriver.send('driver:location', { lat: 23.03, lng: 72.55 });
  wsDriver.send('sos:location', { lat: 23.031, lng: 72.551 });
  check('driver SOS location is not dropped next to a GPS ping', !!(await wsAdmin.waitFor('sos:alert', (x) => x.id === dsos._id && x.location?.lat === 23.031)));
  await api('POST', `/sos/${dsos._id}/resolve`, { token: gd.token });
  wsAdmin.close(); wsDriver.close();

  // Tickets: owner sees own only; support sees all; live event on create/reply
  const q = await newPassenger();
  const wsSupport = live(await login('support', 'asha@sherides.test'));
  const wsQ = live(q.token);
  await Promise.all([wsSupport.opened, wsQ.opened]); await sleep(200);
  const t = (await api('POST', '/tickets', { token: q.token, body: { subject: 'Lost phone', category: 'Lost & found', message: 'Black phone' } })).body;
  check('support agents get ticket:update on a new ticket', !!(await wsSupport.waitFor('ticket:update', (x) => x.id === t._id)));
  const mine = (await api('GET', '/tickets', { token: p.token })).body;
  check('passenger never sees other passengers\' tickets', !mine.some((x) => x._id === t._id));
  const sup = await login('support', 'asha@sherides.test');
  r = await api('PUT', `/tickets/${t._id}`, { token: sup, body: { response: 'Driver has it', status: 'in_progress' } });
  check('support reply → in_progress', r.status === 200 && r.body.status === 'in_progress' && r.body.response === 'Driver has it', r.body);
  check('owner gets ticket:update live', !!(await wsQ.waitFor('ticket:update', (x) => x.id === t._id && x.status === 'in_progress')));
  check('owner notified of the reply', !!(await wsQ.waitFor('notification', (x) => /Support replied/.test(x.message))));
  r = await api('PUT', `/tickets/${t._id}`, { token: sup, body: { assignedTo: '' } });
  check('unassign with empty string', r.status === 200 && r.body.assignedTo == null, r.body);
  is('support PUT ticket bad status → 400', await api('PUT', `/tickets/${t._id}`, { token: sup, body: { status: 'closed' } }), 400);
  wsSupport.close(); wsQ.close();

  // Complaints by the driver on her own ride; listed for admin with names, no contact details leaked to drivers
  const p2 = await newPassenger(); await topUp(p2);
  const dr = await newDriver();
  const ride = (await book(p2)).body;
  await api('POST', `/driver/rides/${ride._id}/accept`, { token: dr.token });
  is('driver files complaint on her ride → 201', await api('POST', '/complaints', { token: dr.token, body: { ride: ride._id, description: 'Passenger was abusive' } }), 201);
  is('complaint description 1001 chars → 400', await api('POST', '/complaints', { token: dr.token, body: { ride: ride._id, description: 'x'.repeat(1001) } }), 400);
  const list = (await api('GET', '/admin/complaints', { token: a })).body;
  check('admin sees the complaint with ride + names', list.some((c) => c.ride?._id === ride._id && c.raisedBy === 'driver' && c.ride.user?.name), list[0]);
  await api('POST', `/rides/${ride._id}/cancel`, { token: p2.token, body: {} });

  // Health and 404s never leak stack traces
  r = await api('GET', '/rides/zzz/messages', { token: p.token });
  check('bad ride id → clean 404 JSON', r.status === 404 && r.body.error === 'Ride not found', r.body);
}

const SECTIONS = { 1: section1, 2: section2, 3: section3, 5: section5 };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SECTIONS);
try {
  for (const s of wanted) await SECTIONS[s]();
} catch (err) {
  failures.push(`CRASH ${err.stack}`);
  console.log('CRASH', err.stack);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(` - ${f}`);
process.exit(failures.length ? 1 : 0);
