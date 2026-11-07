// Admin control room.
//   GET /admin/drivers?status=          PUT /admin/drivers/:id   { verificationStatus }
//                                       PUT /admin/drivers/:id/documents/:docId { status: approved|rejected }
//                                       PUT /admin/drivers/:id/status { status: active|blocked }
//   GET /admin/users                    PUT /admin/users/:id     { status: active|blocked }
//   GET /admin/rides                    active rides with live driver location
//                                       POST /admin/rides/:id/cancel { reason? }  (any active status)
//   GET /admin/complaints?status=       PUT /admin/complaints/:id { status?, resolutionNotes? }
//   GET /admin/sos?status=              (resolve via POST /sos/:id/resolve)
//   GET /admin/reports                  dashboard numbers + rides per month
import { Router } from 'express';
import mongoose from 'mongoose';
import { Complaint, Driver, Rating, Ride, SosAlert, User } from '../models.js';
import { HttpError, requireRole, validate } from '../middleware.js';
import { ACTIVE_STATUSES } from '../rideRules.js';
import { emit } from '../realtime.js';
import { rideChanged } from '../notify.js';

const router = Router();
router.use('/admin', requireRole('admin'));
const objectId = (id, what) => { if (!mongoose.isValidObjectId(id)) throw new HttpError(404, `${what} not found`); return id; };

// A driver who can no longer drive (rejected or blocked) must not pick anyone up: a ride she accepted but has not
// started is cancelled so the passenger can rebook at once. A ride already under way continues (cancel from Live rides).
async function releaseAcceptedRide(driverId) {
  const ride = await Ride.findOneAndUpdate(
    { driver: driverId, status: 'driver_assigned' },
    { status: 'cancelled', cancel: { by: 'admin', reason: 'your driver is no longer available', at: new Date() } },
  );
  if (ride) rideChanged(ride._id);
}

router.get('/admin/drivers', async (req, res) => {
  const { status = 'pending' } = validate(req.query, { status: { oneOf: ['pending', 'approved', 'rejected', 'all'] } });
  const filter = status === 'all' ? {} : { verificationStatus: status };
  res.json(await Driver.find(filter).sort({ createdAt: -1 }).limit(200));
});

router.put('/admin/drivers/:id', async (req, res) => {
  objectId(req.params.id, 'Driver');
  const { verificationStatus: status } = validate(req.body, { verificationStatus: { required: true, oneOf: ['approved', 'rejected'] } });
  // Approving the driver approves every document on file (including ones rejected earlier), so the account
  // and its documents never disagree. Approval needs a driving licence on file.
  // Rejecting the driver rejects the documents still awaiting review and takes her offline.
  const approve = status === 'approved';
  const filter = { _id: req.params.id, ...(approve ? { 'documents.type': 'Driving licence' } : {}) };
  const update = approve
    ? { verificationStatus: status, 'documents.$[].status': 'approved' }
    : { verificationStatus: status, availability: 'offline', 'documents.$[d].status': 'rejected' };
  const driver = await Driver.findOneAndUpdate(filter, { $set: update }, { new: true, ...(approve ? {} : { arrayFilters: [{ 'd.status': 'pending' }] }) });
  if (!driver) {
    if (await Driver.exists({ _id: req.params.id })) throw new HttpError(409, 'Cannot approve: no driving licence uploaded yet');
    throw new HttpError(404, 'Driver not found');
  }
  if (!approve) await releaseAcceptedRide(driver._id);
  emit('driver', driver._id, 'driver:update', { verificationStatus: driver.verificationStatus });
  res.json(driver);
});

// Review one document. A rejected driving licence means she cannot drive: the account is rejected and
// taken offline until she uploads a new one (re-uploading puts her back in the review queue).
router.put('/admin/drivers/:id/documents/:docId', async (req, res) => {
  objectId(req.params.id, 'Driver');
  objectId(req.params.docId, 'Document');
  const { status } = validate(req.body, { status: { required: true, oneOf: ['approved', 'rejected'] } });
  const current = await Driver.findOne({ _id: req.params.id, 'documents._id': req.params.docId }).select('documents');
  const doc = current?.documents.id(req.params.docId);
  if (!doc) throw new HttpError(404, 'Document not found');
  const licenceRejected = status === 'rejected' && doc.type === 'Driving licence';
  const driver = await Driver.findOneAndUpdate(
    // Same document id and file as when we looked: a re-upload in between is not overwritten by a stale decision.
    { _id: req.params.id, documents: { $elemMatch: { _id: doc._id, path: doc.path } } },
    { $set: { 'documents.$.status': status, ...(licenceRejected ? { verificationStatus: 'rejected', availability: 'offline' } : {}) } },
    { new: true },
  );
  if (!driver) throw new HttpError(409, 'The driver just uploaded a new version of this document. Review it again.');
  if (licenceRejected) await releaseAcceptedRide(driver._id);
  emit('driver', driver._id, 'driver:update', { verificationStatus: driver.verificationStatus });
  res.json(driver);
});

// Block or unblock a driver, with the same rule as passengers: a blocked account cannot sign in or take new rides,
// and an accepted ride not yet started is cancelled; a ride already under way (and SOS) keeps working, for the
// passenger's safety. Cancel it from Live rides if needed.
router.put('/admin/drivers/:id/status', async (req, res) => {
  objectId(req.params.id, 'Driver');
  const { status } = validate(req.body, { status: { required: true, oneOf: ['active', 'blocked'] } });
  const driver = await Driver.findByIdAndUpdate(req.params.id, { status, ...(status === 'blocked' ? { availability: 'offline' } : {}) }, { new: true });
  if (!driver) throw new HttpError(404, 'Driver not found');
  if (status === 'blocked') await releaseAcceptedRide(driver._id);
  emit('driver', driver._id, 'driver:update', { verificationStatus: driver.verificationStatus, status: driver.status });
  res.json(driver);
});

router.get('/admin/users', async (req, res) => {
  const users = await User.find().select('name email phone status walletBalance createdAt').sort({ createdAt: -1 }).limit(500).lean();
  const counts = await Ride.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: '$user', n: { $sum: 1 } } }]);
  const byUser = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(users.map((u) => ({ ...u, rides: byUser.get(String(u._id)) || 0 })));
});

router.put('/admin/users/:id', async (req, res) => {
  objectId(req.params.id, 'User');
  const { status } = validate(req.body, { status: { required: true, oneOf: ['active', 'blocked'] } });
  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('name email phone status walletBalance');
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
});

router.get('/admin/rides', async (req, res) => {
  res.json(await Ride.find({ status: { $in: ACTIVE_STATUSES } })
    .populate([{ path: 'driver', select: 'name vehicleModel vehiclePlate location' }, { path: 'user', select: 'name' }])
    .sort({ createdAt: -1 }).limit(200));
});

// Control-room cancel for a ride nobody else can end (e.g. the driver vanished mid-trip): passengers and drivers
// cannot cancel after the OTP, and the one-active-ride index would otherwise lock both out of new rides.
// No fare is charged: payment only happens on `completed`.
router.post('/admin/rides/:id/cancel', async (req, res) => {
  objectId(req.params.id, 'Ride');
  const { reason } = validate(req.body, { reason: { max: 200 } });
  const ride = await Ride.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ACTIVE_STATUSES } },
    { status: 'cancelled', deviated: false, cancel: { by: 'admin', reason, at: new Date() } },
    { new: true },
  );
  if (!ride) throw new HttpError(409, 'This ride is no longer active');
  rideChanged(ride._id);
  res.json(ride);
});

router.get('/admin/complaints', async (req, res) => {
  const { status = 'all' } = validate(req.query, { status: { oneOf: ['open', 'investigating', 'resolved', 'all'] } });
  res.json(await Complaint.find(status === 'all' ? {} : { status })
    .populate({ path: 'ride', select: 'pickup drop user driver createdAt', populate: [{ path: 'user', select: 'name' }, { path: 'driver', select: 'name' }] })
    .sort({ createdAt: -1 }).limit(200));
});

router.put('/admin/complaints/:id', async (req, res) => {
  objectId(req.params.id, 'Complaint');
  const update = validate(req.body, { status: { oneOf: ['open', 'investigating', 'resolved'] }, resolutionNotes: { max: 1000 } });
  const c = await Complaint.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
  if (!c) throw new HttpError(404, 'Complaint not found');
  res.json(c);
});

router.get('/admin/sos', async (req, res) => {
  const { status = 'all' } = validate(req.query, { status: { oneOf: ['active', 'resolved', 'all'] } });
  res.json(await SosAlert.find(status === 'all' ? {} : { status })
    .populate([{ path: 'user', select: 'name phone' }, { path: 'driver', select: 'name vehicleModel vehiclePlate phone' }, { path: 'ride', select: 'pickup drop status' }])
    .sort({ status: 1, triggeredAt: -1 }).limit(200));
});

router.get('/admin/reports', async (req, res) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5, 1);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const [byMonth, fares, statusCounts, sos, ratings, users, drivers, pendingDrivers, openComplaints] = await Promise.all([
    Ride.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo }, status: 'completed' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } },
    ]),
    Ride.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$fare' } } }]),
    Ride.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    SosAlert.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Rating.aggregate([{ $match: { ratedBy: 'passenger' } }, { $group: { _id: null, avg: { $avg: '$stars' }, n: { $sum: 1 } } }]),
    User.countDocuments(), Driver.countDocuments({ verificationStatus: 'approved' }),
    Driver.countDocuments({ verificationStatus: 'pending' }), Complaint.countDocuments({ status: { $ne: 'resolved' } }),
  ]);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(sixMonthsAgo); d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { m: d.toLocaleDateString('en-IN', { month: 'short' }), n: byMonth.find((x) => x._id === key)?.n || 0 };
  });
  const count = (rows, k) => rows.find((r) => r._id === k)?.n || 0;
  const sosTotal = sos.reduce((s, r) => s + r.n, 0);
  res.json({
    monthly: months,
    completed: count(statusCounts, 'completed'),
    cancelled: count(statusCounts, 'cancelled'),
    active: statusCounts.filter((r) => ACTIVE_STATUSES.includes(r._id)).reduce((s, r) => s + r.n, 0),
    grossFares: fares[0]?.total || 0,
    sosActive: count(sos, 'active'),
    sosResolvedPct: sosTotal ? Math.round((count(sos, 'resolved') / sosTotal) * 100) : 100,
    avgRating: ratings[0] ? Math.round(ratings[0].avg * 10) / 10 : null,
    users, drivers, pendingDrivers, openComplaints,
  });
});

export default router;
