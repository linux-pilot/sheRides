// Driver KYC + availability, and access-checked file downloads.
// POST /driver/documents     (driver, multipart: type + file) → updated driver
// PUT  /driver/availability  (driver, { availability })       → { availability }
// GET  /driver/earnings      (driver)  today / 7-day totals + daily chart
// GET  /driver/ratings       (driver)  passenger ratings of her trips
// GET  /files/:name          (admin, or the driver who owns the file)
import { Router } from 'express';
import { Driver, Rating, Ride } from '../models.js';
import { HttpError, requireRole, validate } from '../middleware.js';
import { DOC_TYPES, receiveFile, removeUpload, saveUpload, sendUpload } from '../uploads.js';

const router = Router();

router.post('/driver/documents', requireRole('driver'), receiveFile, async (req, res) => {
  const { type } = validate(req.body, { type: { required: true, oneOf: DOC_TYPES } });
  const driver = await Driver.findById(req.auth.id);
  if (!driver) throw new HttpError(401, 'Account no longer exists');

  const name = await saveUpload(req.file);
  const old = driver.documents.find((d) => d.type === type);
  const oldPath = old?.path;
  if (old) Object.assign(old, { path: name, status: 'pending' });
  else driver.documents.push({ type, path: name, status: 'pending' });
  if (type === 'Driving licence') driver.licensePhoto = name;
  // A rejected driver who re-uploads goes back into the admin review queue.
  if (driver.verificationStatus === 'rejected') driver.verificationStatus = 'pending';

  try {
    await driver.save();
  } catch (err) {
    await removeUpload(name); // don't leave an orphan file if the DB write fails
    throw err;
  }
  await removeUpload(oldPath);
  res.status(201).json(driver);
});

router.put('/driver/availability', requireRole('driver'), async (req, res) => {
  const { availability } = validate(req.body, { availability: { required: true, oneOf: ['online', 'offline'] } });
  // Only approved, unblocked drivers may go online; checked in the same atomic update.
  const filter = availability === 'online' ? { _id: req.auth.id, verificationStatus: 'approved', status: { $ne: 'blocked' } } : { _id: req.auth.id };
  const { matchedCount } = await Driver.updateOne(filter, { availability });
  if (!matchedCount) {
    const blocked = await Driver.exists({ _id: req.auth.id, status: 'blocked' });
    throw new HttpError(403, blocked ? 'This account is blocked. Contact support.' : 'Your account must be approved by an admin before you can go online');
  }
  res.json({ availability });
});

const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD in IST

router.get('/driver/earnings', requireRole('driver'), async (req, res) => {
  const rides = await Ride.find({ driver: req.auth.id, status: 'completed' }).select('fare endTime').lean();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return { key: dayKey(d), day: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }), amount: 0 };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  let weekTrips = 0;
  for (const r of rides) {
    const d = byKey.get(dayKey(r.endTime));
    if (d) { d.amount += r.fare; weekTrips += 1; }
  }
  const me = await Driver.findById(req.auth.id).select('walletBalance');
  res.json({
    today: days[6].amount,
    week: days.reduce((s, d) => s + d.amount, 0),
    weekTrips,
    totalTrips: rides.length,
    walletBalance: me.walletBalance,
    daily: days.map(({ day, amount }) => ({ day, amount })),
  });
});

router.get('/driver/ratings', requireRole('driver'), async (req, res) => {
  const rides = await Ride.find({ driver: req.auth.id, status: 'completed' }).select('_id').lean();
  const ratings = await Rating.find({ ride: { $in: rides.map((r) => r._id) }, ratedBy: 'passenger' })
    .populate({ path: 'ride', select: 'user pickup drop', populate: { path: 'user', select: 'name' } })
    .sort({ createdAt: -1 }).limit(100);
  res.json(ratings);
});

router.get('/files/:name', requireRole('driver', 'admin'), async (req, res) => {
  const { name } = req.params;
  if (req.auth.role === 'driver') {
    const owns = await Driver.exists({ _id: req.auth.id, 'documents.path': name });
    if (!owns) throw new HttpError(404, 'File not found');
  }
  sendUpload(res, name);
});

export default router;
