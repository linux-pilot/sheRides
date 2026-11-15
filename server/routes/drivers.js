// Drivers: KYC documents, availability, earnings and ratings; admin approval, document review and blocking.
//   POST /driver/documents     driver   multipart: type + file → updated driver
//   PUT  /driver/availability  driver   { availability } → { availability }
//   GET  /driver/earnings      driver   today / 7-day totals + daily chart
//   GET  /driver/ratings       driver   passenger ratings of her trips
//   GET  /files/:name          admin, or the driver who owns the file
//   GET  /admin/drivers?status=                     admin
//   PUT  /admin/drivers/:id   { verificationStatus } admin   approved|rejected
//   PUT  /admin/drivers/:id/documents/:docId { status } admin approved|rejected
//   PUT  /admin/drivers/:id/status { status }       admin   active|blocked
import { Router } from 'express';
import { ACCOUNT_STATUS, AVAILABILITY, DOC_TYPES, Driver, LICENCE, Rating, REVIEW_STATUS, Ride } from '../models.js';
import { HttpError, idParam, requireRole, validate } from '../middleware.js';
import { DRIVER_BUSY_STATUSES, localDate, TIME_ZONE } from '../rideRules.js';
import { emit } from '../realtime.js';
import { receiveFile, removeUpload, saveUpload, sendUpload } from '../uploads.js';
import { releaseAcceptedRide } from './rides.js';

const router = Router();
const driver = requireRole('driver');
const DECISIONS = REVIEW_STATUS.filter((s) => s !== 'pending');
const admin = requireRole('admin');

// The driver's own pages reload when an admin changes her account.
const driverChanged = (d) => emit('driver', d._id, 'driver:update', { verificationStatus: d.verificationStatus, status: d.status });

router.post('/driver/documents', driver, receiveFile, async (req, res) => {
  const { type } = validate(req.body, { type: { required: true, oneOf: DOC_TYPES } });
  const me = await Driver.findById(req.auth.id);
  // An approved driver replacing her driving licence is driving on a document nobody has reviewed: she goes offline
  // and back into the review queue. Not mid-ride, where it would strand a passenger.
  const recheck = type === LICENCE && me.verificationStatus === 'approved';
  if (recheck && (await Ride.exists({ driver: me._id, status: { $in: DRIVER_BUSY_STATUSES } }))) {
    throw new HttpError(409, 'Finish your current trip before replacing your driving licence');
  }

  const name = await saveUpload(req.file);
  const old = me.documents.find((d) => d.type === type);
  const oldPath = old?.path;
  if (old) Object.assign(old, { path: name, status: 'pending' });
  else me.documents.push({ type, path: name, status: 'pending' });
  if (type === LICENCE) me.licensePhoto = name;
  if (me.verificationStatus === 'rejected') me.verificationStatus = 'pending';
  if (recheck) Object.assign(me, { verificationStatus: 'pending', availability: 'offline' });

  try {
    await me.save();
  } catch (err) {
    await removeUpload(name);
    throw err;
  }
  await removeUpload(oldPath);
  res.status(201).json(me);
});

router.put('/driver/availability', driver, async (req, res) => {
  const { availability } = validate(req.body, { availability: { required: true, oneOf: AVAILABILITY } });
  const filter = availability === 'online' ? { _id: req.auth.id, verificationStatus: 'approved' } : { _id: req.auth.id };
  const { matchedCount } = await Driver.updateOne(filter, { availability });
  if (!matchedCount) throw new HttpError(403, 'Your account must be approved by an admin before you can go online');
  res.json({ availability });
});

router.get('/driver/earnings', driver, async (req, res) => {
  const rides = await Ride.find({ driver: req.auth.id, status: 'completed' }).select('fare endTime').lean();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return { key: localDate(d), day: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: TIME_ZONE }), amount: 0 };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  let weekTrips = 0;
  for (const r of rides) {
    const d = byKey.get(localDate(r.endTime));
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

router.get('/driver/ratings', driver, async (req, res) => {
  const rides = await Ride.find({ driver: req.auth.id, status: 'completed' }).select('_id').lean();
  res.json(await Rating.find({ ride: { $in: rides.map((r) => r._id) }, ratedBy: 'passenger' })
    .populate({ path: 'ride', select: 'user pickup drop', populate: { path: 'user', select: 'name' } })
    .sort({ createdAt: -1 }).limit(100));
});

router.get('/files/:name', requireRole('driver', 'admin'), async (req, res) => {
  const { name } = req.params;
  if (req.auth.role === 'driver' && !(await Driver.exists({ _id: req.auth.id, 'documents.path': name }))) {
    throw new HttpError(404, 'File not found');
  }
  sendUpload(res, name);
});

router.get('/admin/drivers', admin, async (req, res) => {
  const { status = 'pending' } = validate(req.query, { status: { oneOf: [...REVIEW_STATUS, 'all'] } });
  res.json(await Driver.find(status === 'all' ? {} : { verificationStatus: status }).sort({ createdAt: -1 }).limit(200));
});

// Approving the driver approves every document on file (including ones rejected earlier), so the account and its
// documents never disagree; it needs a driving licence on file. Rejecting the driver rejects the documents still
// awaiting review and takes her offline.
router.put('/admin/drivers/:id', admin, async (req, res) => {
  const id = idParam(req.params.id, 'Driver');
  const { verificationStatus: status } = validate(req.body, { verificationStatus: { required: true, oneOf: DECISIONS } });
  const approve = status === 'approved';
  const d = approve
    ? await Driver.findOneAndUpdate({ _id: id, 'documents.type': LICENCE }, { $set: { verificationStatus: status, 'documents.$[].status': 'approved' } }, { new: true })
    : await Driver.findOneAndUpdate({ _id: id }, { $set: { verificationStatus: status, availability: 'offline', 'documents.$[d].status': 'rejected' } }, { new: true, arrayFilters: [{ 'd.status': 'pending' }] });
  if (!d) {
    if (await Driver.exists({ _id: id })) throw new HttpError(409, 'Cannot approve: no driving licence uploaded yet');
    throw new HttpError(404, 'Driver not found');
  }
  if (!approve) await releaseAcceptedRide(d._id);
  driverChanged(d);
  res.json(d);
});

// Review one document. A rejected driving licence means she cannot drive: the account is rejected and taken offline
// until she uploads a new one (re-uploading puts her back in the review queue).
router.put('/admin/drivers/:id/documents/:docId', admin, async (req, res) => {
  const id = idParam(req.params.id, 'Driver');
  const docId = idParam(req.params.docId, 'Document');
  const { status } = validate(req.body, { status: { required: true, oneOf: DECISIONS } });
  const doc = (await Driver.findOne({ _id: id, 'documents._id': docId }).select('documents'))?.documents.id(docId);
  if (!doc) throw new HttpError(404, 'Document not found');
  const licenceRejected = status === 'rejected' && doc.type === LICENCE;
  const d = await Driver.findOneAndUpdate(
    // Same document id and file as when we looked: a re-upload in between is not overwritten by a stale decision.
    { _id: id, documents: { $elemMatch: { _id: doc._id, path: doc.path } } },
    { $set: { 'documents.$.status': status, ...(licenceRejected ? { verificationStatus: 'rejected', availability: 'offline' } : {}) } },
    { new: true },
  );
  if (!d) throw new HttpError(409, 'The driver just uploaded a new version of this document. Review it again.');
  if (licenceRejected) await releaseAcceptedRide(d._id);
  driverChanged(d);
  res.json(d);
});

// Same rule as for passengers: a blocked account cannot sign in or take new rides, and an accepted ride not yet
// started is cancelled; a ride already under way (and SOS) keeps working, for the passenger's safety.
router.put('/admin/drivers/:id/status', admin, async (req, res) => {
  const id = idParam(req.params.id, 'Driver');
  const { status } = validate(req.body, { status: { required: true, oneOf: ACCOUNT_STATUS } });
  const d = await Driver.findByIdAndUpdate(id, { status, ...(status === 'blocked' ? { availability: 'offline' } : {}) }, { new: true });
  if (!d) throw new HttpError(404, 'Driver not found');
  if (status === 'blocked') await releaseAcceptedRide(d._id);
  driverChanged(d);
  res.json(d);
});

export default router;
