// Passenger accounts: own profile, contacts, places, wallet, notifications; admin list and block.
//   PUT    /me                       passenger|driver   { name?, phone?, preferences? }
//   POST   /me/contacts              passenger          { name, relation, phone, email }  (max 5)
//   DELETE /me/contacts/:cid         passenger
//   POST   /me/addresses             passenger          { label, address, lat, lng }      (max 10)
//   DELETE /me/addresses/:aid        passenger
//   GET    /me/stats                 passenger          dashboard numbers
//   GET    /wallet                   passenger          { balance, payments }
//   POST   /wallet       { amount }  passenger          mock top-up (₹50–₹10,000)
//   GET    /notifications            passenger
//   PUT    /notifications/read       passenger
//   GET    /admin/users              admin              passengers + completed ride counts
//   PUT    /admin/users/:id          admin              { status: active|blocked }
import { Router } from 'express';
import { ACCOUNT_MODEL, ACCOUNT_STATUS, Notification, Payment, Ride, SosAlert, User } from '../models.js';
import { HttpError, idParam, POINT, requireRole, validate } from '../middleware.js';
import { inr, notifyUser } from '../notify.js';

const router = Router();
const passenger = requireRole('passenger');
const admin = requireRole('admin');
const MAX_CONTACTS = 5;
const MAX_ADDRESSES = 10;

// Blocked accounts may still edit their profile (e.g. switch trip sharing on during a ride).
router.put('/me', requireRole('passenger', 'driver', { blockedOk: true }), async (req, res) => {
  const update = validate(req.body, { name: { max: 80 }, phone: { type: 'phone' } });
  if (req.auth.role === 'passenger' && req.body?.preferences !== undefined) {
    const prefs = validate(req.body.preferences, { shareTrips: { type: 'boolean' }, emailUpdates: { type: 'boolean' } }, 'preferences.');
    for (const [k, v] of Object.entries(prefs)) update[`preferences.${k}`] = v;
  }
  const doc = await ACCOUNT_MODEL[req.auth.role].findByIdAndUpdate(req.auth.id, { $set: update }, { new: true, runValidators: true });
  res.json({ role: req.auth.role, user: doc });
});

router.post('/me/contacts', passenger, async (req, res) => {
  const c = validate(req.body, {
    name: { required: true, max: 60 }, relation: { required: true, max: 30 },
    phone: { required: true, type: 'phone' }, email: { required: true, type: 'email', max: 120 },
  });
  // ponytail: the address is not verified, so trip and SOS emails go to whoever she types (at most MAX_CONTACTS).
  // Upgrade: email a confirmation link and send trip updates only to confirmed contacts (SOS should still go to all).
  // Capacity check and insert in one atomic update.
  const doc = await User.findOneAndUpdate(
    { _id: req.auth.id, [`emergencyContacts.${MAX_CONTACTS - 1}`]: { $exists: false }, 'emergencyContacts.email': { $ne: c.email } },
    { $push: { emergencyContacts: c } }, { new: true },
  );
  if (!doc) {
    const dup = await User.exists({ _id: req.auth.id, 'emergencyContacts.email': c.email });
    throw new HttpError(409, dup ? 'That contact is already saved' : `You can save up to ${MAX_CONTACTS} emergency contacts`);
  }
  res.status(201).json({ role: 'passenger', user: doc });
});

router.delete('/me/contacts/:cid', passenger, async (req, res) => {
  const doc = await User.findByIdAndUpdate(req.auth.id, { $pull: { emergencyContacts: { _id: idParam(req.params.cid, 'Contact') } } }, { new: true });
  res.json({ role: 'passenger', user: doc });
});

router.post('/me/addresses', passenger, async (req, res) => {
  const a = validate(req.body, { label: { required: true, max: 30 }, address: { required: true, max: 200 }, ...POINT });
  const doc = await User.findOneAndUpdate(
    { _id: req.auth.id, [`savedAddresses.${MAX_ADDRESSES - 1}`]: { $exists: false } },
    { $push: { savedAddresses: a } }, { new: true },
  );
  if (!doc) throw new HttpError(409, `You can save up to ${MAX_ADDRESSES} places`);
  res.status(201).json({ role: 'passenger', user: doc });
});

router.delete('/me/addresses/:aid', passenger, async (req, res) => {
  const doc = await User.findByIdAndUpdate(req.auth.id, { $pull: { savedAddresses: { _id: idParam(req.params.aid, 'Place') } } }, { new: true });
  res.json({ role: 'passenger', user: doc });
});

// Safety score = share of completed rides with no SOS.
router.get('/me/stats', passenger, async (req, res) => {
  const user = req.auth.id;
  const completed = await Ride.find({ user, status: 'completed' }).select('_id').lean();
  const accepted = await Ride.find({ user, acceptedAt: { $exists: true } }).select('acceptedAt createdAt').lean();
  const sosRides = await SosAlert.distinct('ride', { user, ride: { $in: completed.map((r) => r._id) } });
  const waits = accepted.map((r) => (r.acceptedAt - r.createdAt) / 60000);
  res.json({
    ridesCompleted: completed.length,
    safetyScore: completed.length ? Math.round(((completed.length - sosRides.length) / completed.length) * 100) : 100,
    avgWaitMin: waits.length ? Math.round((waits.reduce((a, b) => a + b, 0) / waits.length) * 10) / 10 : null,
  });
});

router.get('/wallet', passenger, async (req, res) => {
  const user = await User.findById(req.auth.id);
  const payments = await Payment.find({ user: req.auth.id }).sort({ createdAt: -1 }).limit(50);
  res.json({ balance: user.walletBalance, payments });
});

// ponytail: mock top-up — money appears instantly. Upgrade: Razorpay order + webhook-verified capture.
router.post('/wallet', passenger, async (req, res) => {
  const { amount } = validate(req.body, { amount: { required: true, type: 'integer', range: [50, 10000] } });
  const user = await User.findByIdAndUpdate(req.auth.id, { $inc: { walletBalance: amount } }, { new: true });
  const payment = await Payment.create({ user: req.auth.id, amount, method: 'topup', status: 'success' });
  await notifyUser(req.auth.id, `${inr(amount)} added to your wallet.`);
  res.status(201).json({ balance: user.walletBalance, payment });
});

router.get('/notifications', passenger, async (req, res) => {
  res.json(await Notification.find({ user: req.auth.id }).sort({ createdAt: -1 }).limit(50));
});

router.put('/notifications/read', passenger, async (req, res) => {
  await Notification.updateMany({ user: req.auth.id, isRead: false }, { isRead: true });
  res.json({ ok: true });
});

router.get('/admin/users', admin, async (req, res) => {
  const users = await User.find().select('name email phone status walletBalance createdAt').sort({ createdAt: -1 }).limit(500).lean();
  const counts = await Ride.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: '$user', n: { $sum: 1 } } }]);
  const byUser = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(users.map((u) => ({ ...u, rides: byUser.get(String(u._id)) || 0 })));
});

router.put('/admin/users/:id', admin, async (req, res) => {
  const { status } = validate(req.body, { status: { required: true, oneOf: ACCOUNT_STATUS } });
  const user = await User.findByIdAndUpdate(idParam(req.params.id, 'User'), { status }, { new: true }).select('name email phone status walletBalance');
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
});

export default router;
