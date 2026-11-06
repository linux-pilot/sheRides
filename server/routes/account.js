// The signed-in person's own data.
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
import { Router } from 'express';
import mongoose from 'mongoose';
import { Driver, Notification, Payment, Ride, SosAlert, User } from '../models.js';
import { HttpError, requireRole, validate } from '../middleware.js';
import { notifyUser } from '../notify.js';

const router = Router();
const passenger = requireRole('passenger');
const MAX_CONTACTS = 5;
const MAX_ADDRESSES = 10;
const profile = (doc) => { const { password, __v, ...rest } = doc.toObject(); return rest; };

router.put('/me', requireRole('passenger', 'driver'), async (req, res) => {
  const fields = validate(req.body, { name: { max: 80 }, phone: { type: 'phone' } });
  const update = { ...fields };
  if (req.auth.role === 'passenger' && req.body?.preferences !== undefined) {
    const p = req.body.preferences;
    for (const k of ['shareTrips', 'emailUpdates']) {
      if (p?.[k] !== undefined) {
        if (typeof p[k] !== 'boolean') throw new HttpError(400, `preferences.${k} must be true or false`);
        update[`preferences.${k}`] = p[k];
      }
    }
  }
  const Model = req.auth.role === 'passenger' ? User : Driver;
  const doc = await Model.findByIdAndUpdate(req.auth.id, { $set: update }, { new: true, runValidators: true });
  if (!doc) throw new HttpError(401, 'Account no longer exists');
  res.json({ role: req.auth.role, user: profile(doc) });
});

const subId = (v) => { if (!mongoose.isValidObjectId(v)) throw new HttpError(404, 'Not found'); return v; };

router.post('/me/contacts', passenger, async (req, res) => {
  const c = validate(req.body, {
    name: { required: true, max: 60 }, relation: { required: true, max: 30 },
    phone: { required: true, type: 'phone' }, email: { required: true, type: 'email', max: 120 },
  });
  // Capacity check and insert in one atomic update.
  const doc = await User.findOneAndUpdate(
    { _id: req.auth.id, [`emergencyContacts.${MAX_CONTACTS - 1}`]: { $exists: false }, 'emergencyContacts.email': { $ne: c.email } },
    { $push: { emergencyContacts: c } }, { new: true },
  );
  if (!doc) {
    const dup = await User.exists({ _id: req.auth.id, 'emergencyContacts.email': c.email });
    throw new HttpError(409, dup ? 'That contact is already saved' : `You can save up to ${MAX_CONTACTS} emergency contacts`);
  }
  res.status(201).json({ role: 'passenger', user: profile(doc) });
});

router.delete('/me/contacts/:cid', passenger, async (req, res) => {
  const doc = await User.findByIdAndUpdate(req.auth.id, { $pull: { emergencyContacts: { _id: subId(req.params.cid) } } }, { new: true });
  res.json({ role: 'passenger', user: profile(doc) });
});

router.post('/me/addresses', passenger, async (req, res) => {
  const a = validate(req.body, {
    label: { required: true, max: 30 }, address: { required: true, max: 200 },
    lat: { required: true, type: 'number', range: [-90, 90] }, lng: { required: true, type: 'number', range: [-180, 180] },
  });
  const doc = await User.findOneAndUpdate(
    { _id: req.auth.id, [`savedAddresses.${MAX_ADDRESSES - 1}`]: { $exists: false } },
    { $push: { savedAddresses: a } }, { new: true },
  );
  if (!doc) throw new HttpError(409, `You can save up to ${MAX_ADDRESSES} places`);
  res.status(201).json({ role: 'passenger', user: profile(doc) });
});

router.delete('/me/addresses/:aid', passenger, async (req, res) => {
  const doc = await User.findByIdAndUpdate(req.auth.id, { $pull: { savedAddresses: { _id: subId(req.params.aid) } } }, { new: true });
  res.json({ role: 'passenger', user: profile(doc) });
});

// Safety score = share of completed rides with no SOS and no route deviation alert.
router.get('/me/stats', passenger, async (req, res) => {
  const user = new mongoose.Types.ObjectId(req.auth.id);
  const completed = await Ride.find({ user, status: 'completed' }).select('_id acceptedAt createdAt').lean();
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
  const { amount } = validate(req.body, { amount: { required: true, type: 'number', range: [50, 10000] } });
  if (!Number.isInteger(amount)) throw new HttpError(400, 'amount must be whole rupees');
  const user = await User.findByIdAndUpdate(req.auth.id, { $inc: { walletBalance: amount } }, { new: true });
  const payment = await Payment.create({ user: req.auth.id, amount, method: 'topup', status: 'success' });
  await notifyUser(req.auth.id, `₹${amount.toLocaleString('en-IN')} added to your wallet.`);
  res.status(201).json({ balance: user.walletBalance, payment });
});

router.get('/notifications', passenger, async (req, res) => {
  res.json(await Notification.find({ user: req.auth.id }).sort({ createdAt: -1 }).limit(50));
});

router.put('/notifications/read', passenger, async (req, res) => {
  await Notification.updateMany({ user: req.auth.id, isRead: false }, { isRead: true });
  res.json({ ok: true });
});

export default router;
