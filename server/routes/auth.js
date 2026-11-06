// POST /auth/register/:role  (passenger | driver)  → { token, role, user }
// POST /auth/login/:role     (any of the 4 roles)  → { token, role, user }
// GET  /me                   (signed in)           → { role, user }
// Admin and support accounts are never self-registered; they come from seed.js.
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { ACCOUNT_MODEL, Driver, ROLES, User } from '../models.js';
import { HttpError, requireRole, signToken, validate } from '../middleware.js';

const router = Router();
const ROUNDS = 10;
// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', ROUNDS);

const base = {
  name: { required: true, max: 80 },
  email: { required: true, type: 'email', max: 120 },
  phone: { required: true, type: 'phone' },
  password: { required: true, min: 8, max: 72 }, // bcrypt only reads the first 72 bytes
  // Women-only platform: anything other than "female" is rejected here, before any write.
  gender: { required: true, oneOf: ['female'] },
};
const driverFields = {
  licenseNumber: { required: true, max: 30, pattern: /^[A-Za-z0-9 -]+$/ },
  vehicleModel: { required: true, max: 60 },
  vehiclePlate: { required: true, max: 15, pattern: /^[A-Za-z0-9 ]+$/ },
};

// Public profile: never includes the password hash.
const profile = (doc) => {
  const { password, __v, ...rest } = doc.toObject();
  return rest;
};

router.post('/auth/register/:role', async (req, res) => {
  const { role } = req.params;
  if (role !== 'passenger' && role !== 'driver') throw new HttpError(404, 'Unknown account type');

  const data = validate(req.body, role === 'driver' ? { ...base, ...driverFields } : base);
  if (data.gender !== 'female') throw new HttpError(400, 'SheRides is open to women only'); // belt and braces
  data.password = await bcrypt.hash(data.password, ROUNDS);

  let account;
  if (role === 'passenger') {
    account = await User.create(data);
  } else {
    // drivers has no gender column in the data dictionary: checked above, not stored.
    const { gender, ...driver } = data;
    // New drivers start `pending`; the client then uploads KYC docs via POST /driver/documents.
    account = await Driver.create(driver);
  }
  res.status(201).json({ token: signToken(account, role), role, user: profile(account) });
});

router.post('/auth/login/:role', async (req, res) => {
  const { role } = req.params;
  if (!ROLES.includes(role)) throw new HttpError(404, 'Unknown account type');
  const { email, password } = validate(req.body, {
    email: { required: true, type: 'email', max: 120 },
    password: { required: true, max: 72 },
  });

  const account = await ACCOUNT_MODEL[role].findOne({ email }).select('+password');
  const ok = await bcrypt.compare(password, account?.password || DUMMY_HASH);
  if (!account || !ok) throw new HttpError(401, 'Wrong email or password');
  if (account.status === 'blocked') throw new HttpError(403, 'This account is blocked. Contact support.');

  res.json({ token: signToken(account, role), role, user: profile(account) });
});

router.get('/me', requireRole(...ROLES), async (req, res) => {
  const account = await ACCOUNT_MODEL[req.auth.role].findById(req.auth.id);
  if (!account) throw new HttpError(401, 'Account no longer exists');
  res.json({ role: req.auth.role, user: profile(account) });
});

export default router;
