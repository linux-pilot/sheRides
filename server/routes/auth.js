// POST /auth/register/:role  (passenger | driver)  → { token, role, user }
// POST /auth/login/:role     (any of the 4 roles)  → { token, role, user }
// GET  /me                   (signed in)           → { role, user }
// Admin and support accounts are never self-registered; they come from seed.js.
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { ACCOUNT_MODEL, hashPassword, ROLES } from '../models.js';
import { BLOCKED_MESSAGE, FIELD, HttpError, required, requireRole, signToken, validate } from '../middleware.js';

const router = Router();
// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
const DUMMY_HASH = await hashPassword('not-a-real-password');

const base = {
  name: required(FIELD.name),
  email: required(FIELD.email),
  phone: required(FIELD.phone),
  password: { required: true, min: 8, max: 72 }, // bcrypt only reads the first 72 bytes
  // Women-only platform: anything other than "female" is rejected here, before any write.
  gender: { required: true, oneOf: ['female'] },
};
const driverFields = {
  licenseNumber: { required: true, max: 30, pattern: /^[A-Za-z0-9 -]+$/ },
  vehicleModel: { required: true, max: 60 },
  vehiclePlate: { required: true, max: 15, pattern: /^[A-Za-z0-9 ]+$/ },
};

// Failed sign-ins are counted per account AND client address (role + email + IP): after MAX_FAILS within FAIL_WINDOW_MS
// that client is refused for the rest of the window, so passwords cannot be guessed endlessly. Keyed on the client too,
// so a stranger's wrong guesses do not lock the real owner (e.g. the control-room admin) out. The address comes from
// X-Forwarded-For (set by the site's /api proxy), which a client calling the API directly can fake, so a higher
// account-wide ceiling still stops guessing from many (or faked) addresses.
// An attempt is counted BEFORE the password check so parallel guesses cannot slip past the cap; a correct password
// clears that client's count and takes its own attempt back off the account-wide count.
// ponytail: in memory, one server process. Upgrade: Redis-backed limiter shared by every API instance.
const MAX_FAILS = 10;
const MAX_ACCOUNT_FAILS = 100;
const FAIL_WINDOW_MS = 15 * 60_000;
const attempts = new Map(); // "role:email|ip" or "role:email" → { n, until }
function takeAttempt(key, max) {
  const now = Date.now();
  let a = attempts.get(key);
  if (!a || a.until <= now) {
    a = { n: 0, until: now + FAIL_WINDOW_MS };
    attempts.set(key, a);
    if (attempts.size > 10_000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  }
  if (a.n >= max) throw new HttpError(429, `Too many failed sign-ins. Try again in ${Math.ceil((a.until - now) / 60_000)} minutes.`);
  a.n += 1;
  return a;
}

router.post('/auth/register/:role', async (req, res) => {
  const { role } = req.params;
  if (role !== 'passenger' && role !== 'driver') throw new HttpError(404, 'Unknown account type');

  const data = validate(req.body, role === 'driver' ? { ...base, ...driverFields } : base);
  data.password = await hashPassword(data.password);
  // drivers has no gender column in the data dictionary: checked above, dropped by the schema. New drivers start `pending`.
  const account = await ACCOUNT_MODEL[role].create(data);
  res.status(201).json({ token: signToken(account, role), role, user: account });
});

router.post('/auth/login/:role', async (req, res) => {
  const { role } = req.params;
  if (!ROLES.includes(role)) throw new HttpError(404, 'Unknown account type');
  const { email, password } = validate(req.body, {
    email: required(FIELD.email),
    password: { required: true, max: 72 },
  });

  const key = `${role}:${email}|${req.ip}`;
  takeAttempt(key, MAX_FAILS);
  const accountWide = takeAttempt(`${role}:${email}`, MAX_ACCOUNT_FAILS);
  const account = await ACCOUNT_MODEL[role].findOne({ email }).select('+password');
  const ok = await bcrypt.compare(password, account?.password || DUMMY_HASH);
  if (!account || !ok) throw new HttpError(401, 'Wrong email or password');
  attempts.delete(key);
  accountWide.n -= 1;
  if (account.status === 'blocked') throw new HttpError(403, BLOCKED_MESSAGE);

  res.json({ token: signToken(account, role), role, user: account });
});

router.get('/me', requireRole(...ROLES, { blockedOk: true }), async (req, res) => {
  res.json({ role: req.auth.role, user: await ACCOUNT_MODEL[req.auth.role].findById(req.auth.id) });
});

export default router;
