// Booking, fare estimate, safety OTP, ride lifecycle, ratings and masked chat.
//   GET  /tiers                          public
//   POST /rides/estimate                 passenger    { pickup, drop } → { km, fares }
//   POST /rides                          passenger    book → ride (with OTP)
//   GET  /rides/active                   passenger|driver
//   GET  /rides                          passenger|driver   history (completed/cancelled) + my rating
//   GET  /driver/requests                driver (approved + online)
//   POST /driver/rides/:id/accept|reject driver
//   POST /rides/:id/start   { otp }      driver       driver_assigned → otp_verified
//   POST /rides/:id/status  { status }   driver       otp_verified → en_route → arrived → completed
//   POST /rides/:id/cancel  { reason }   passenger|driver
//   POST /rides/:id/rate    { stars, feedback }  passenger|driver (completed rides)
//   GET|POST /rides/:id/messages         passenger|driver   masked chat (no phone numbers exchanged)
// The OTP is only ever sent to the passenger; drivers must hear it in the car.
import { Router } from 'express';
import mongoose from 'mongoose';
import { Driver, Payment, Rating, Ride, RideMessage, User } from '../models.js';
import { HttpError, requireRole, validate } from '../middleware.js';
import { emit } from '../realtime.js';
import { rideChanged } from '../notify.js';
import { roadRoute } from '../routing.js';
import {
  ACTIVE_STATUSES, CANCELLABLE, distanceKm, DRIVER_BUSY_STATUSES, fareFor, geofenceApplies, insideServiceArea, makeOtp,
  MAX_KM, MAX_OTP_ATTEMPTS, MIN_KM, NEXT_STATUS, otpMatches, SERVICE_AREA, TIER_IDS, TIERS,
} from '../rideRules.js';

const router = Router();
const passenger = requireRole('passenger');
const driver = requireRole('driver');
const either = requireRole('passenger', 'driver');

const PLACE = {
  address: { required: true, max: 200 },
  lat: { required: true, type: 'number', range: [-90, 90] },
  lng: { required: true, type: 'number', range: [-180, 180] },
};
// Validates both places, then plans the road route. Fare distance = road km (straight line only as fallback).
async function readTrip(body) {
  const place = (key) => {
    try { return validate(body?.[key], PLACE); } catch (e) { throw new HttpError(400, `${key}: ${e.message}`); }
  };
  const pickup = place('pickup');
  const drop = place('drop');
  const straight = distanceKm(pickup, drop);
  if (straight < MIN_KM) throw new HttpError(400, 'Pickup and destination are too close together');
  if (straight > MAX_KM) throw new HttpError(400, `Trips over ${MAX_KM} km are not supported`);
  const road = await roadRoute(pickup, drop);
  if (road && road.km > MAX_KM) throw new HttpError(400, `Trips over ${MAX_KM} km are not supported`);
  return road
    ? { pickup, drop, km: road.km, durationMin: road.durationMin, route: road.path }
    : { pickup, drop, km: straight, durationMin: Math.max(1, Math.round((straight / 25) * 60)) }; // ~25 km/h city fallback
}
// Night geo-fence (22:00–06:00 IST, and always for Night Guardian): both ends inside the service area.
function checkGeofence(tier, { pickup, drop }) {
  if (geofenceApplies(tier) && !(insideServiceArea(pickup) && insideServiceArea(drop))) {
    throw new HttpError(400, `${tier === 'night' ? 'Night Guardian' : 'Night'} rides must start and end within ${SERVICE_AREA.radiusKm} km of ${SERVICE_AREA.name} centre`);
  }
}

const ownerField = (role) => (role === 'passenger' ? 'user' : 'driver');
const rideId = (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Ride not found');
  return req.params.id;
};
// Each side sees the other's name and the vehicle, never phone numbers (masked calling).
const POPULATE = [{ path: 'driver', select: 'name vehicleModel vehiclePlate rating location' }, { path: 'user', select: 'name' }];
const findRide = (filter, role) => {
  const q = Ride.findOne(filter).populate(POPULATE);
  return role === 'passenger' ? q.select('+otp') : q;
};
// E11000 on the partial unique indexes = an active ride already exists.
const busy = (message) => (err) => { throw err.code === 11000 ? new HttpError(409, message) : err; };

router.get('/tiers', (req, res) => res.json(TIERS));

router.post('/rides/estimate', passenger, async (req, res) => {
  const trip = await readTrip(req.body);
  res.json({ km: trip.km, durationMin: trip.durationMin, route: trip.route || null, fares: TIERS.map((t) => ({ ...t, fare: fareFor(t.id, trip.km), allowed: !geofenceApplies(t.id) || (insideServiceArea(trip.pickup) && insideServiceArea(trip.drop)) })) });
});

router.post('/rides', passenger, async (req, res) => {
  const trip = await readTrip(req.body);
  const { tier } = validate(req.body, { tier: { required: true, oneOf: TIER_IDS } });
  checkGeofence(tier, trip);
  const fare = fareFor(tier, trip.km);
  const user = await User.findById(req.auth.id);
  if (!user || user.status !== 'active') throw new HttpError(403, 'This account is blocked. Contact support.');
  if (user.walletBalance < fare) throw new HttpError(402, `Wallet balance is ₹${user.walletBalance}. Top up at least ₹${fare - user.walletBalance} to book this ride.`);

  const ride = await Ride.create({ ...trip, tier, user: req.auth.id, fare, otp: makeOtp() })
    .catch(busy('You already have an active ride'));
  rideChanged(ride._id);
  res.status(201).json(await findRide({ _id: ride._id }, 'passenger'));
});

router.get('/rides/active', either, async (req, res) => {
  const statuses = req.auth.role === 'driver' ? DRIVER_BUSY_STATUSES : ACTIVE_STATUSES;
  res.json(await findRide({ [ownerField(req.auth.role)]: req.auth.id, status: { $in: statuses } }, req.auth.role));
});

router.get('/rides', either, async (req, res) => {
  const rides = await Ride.find({ [ownerField(req.auth.role)]: req.auth.id, status: { $in: ['completed', 'cancelled'] } })
    .populate(POPULATE).sort({ createdAt: -1 }).limit(50).lean();
  const mine = await Rating.find({ ride: { $in: rides.map((r) => r._id) }, ratedBy: req.auth.role }).lean();
  const byRide = new Map(mine.map((r) => [String(r.ride), r.stars]));
  res.json(rides.map((r) => ({ ...r, myRating: byRide.get(String(r._id)) ?? null })));
});

const assertCanDrive = async (id) => {
  if (!(await Driver.exists({ _id: id, verificationStatus: 'approved', availability: 'online' }))) {
    throw new HttpError(403, 'Go online (approved drivers only) to see and accept ride requests');
  }
};

router.get('/driver/requests', driver, async (req, res) => {
  await assertCanDrive(req.auth.id);
  const open = await Ride.find({ status: 'requested', declinedBy: { $ne: req.auth.id } })
    .populate(POPULATE).sort({ createdAt: 1 }).limit(20);
  res.json(open);
});

router.post('/driver/rides/:id/accept', driver, async (req, res) => {
  const id = rideId(req);
  await assertCanDrive(req.auth.id);
  // Atomic: only one driver can move a ride out of `requested`.
  const ride = await Ride.findOneAndUpdate(
    { _id: id, status: 'requested', declinedBy: { $ne: req.auth.id } },
    { driver: req.auth.id, status: 'driver_assigned', acceptedAt: new Date() },
    { new: true },
  ).catch(busy('Finish your current ride before accepting another'));
  if (!ride) throw new HttpError(409, 'This ride is no longer available');
  rideChanged(id);
  res.json(await findRide({ _id: id }, 'driver'));
});

router.post('/driver/rides/:id/reject', driver, async (req, res) => {
  await Ride.updateOne({ _id: rideId(req), status: 'requested' }, { $addToSet: { declinedBy: req.auth.id } });
  res.json({ ok: true });
});

router.post('/rides/:id/start', driver, async (req, res) => {
  const id = rideId(req);
  const { otp } = validate(req.body, { otp: { required: true, pattern: /^\d{6}$/ } });
  // Use up one attempt atomically BEFORE comparing, so parallel guesses can never exceed the cap.
  const ride = await Ride.findOneAndUpdate(
    { _id: id, driver: req.auth.id, status: 'driver_assigned', otpAttempts: { $lt: MAX_OTP_ATTEMPTS } },
    { $inc: { otpAttempts: 1 } },
    { new: true },
  ).select('+otp +otpAttempts');
  if (!ride) {
    const waiting = await Ride.exists({ _id: id, driver: req.auth.id, status: 'driver_assigned' });
    throw waiting ? new HttpError(423, 'Too many wrong OTPs. The passenger must cancel and rebook.') : new HttpError(409, 'This ride is not waiting for an OTP');
  }

  if (!otpMatches(ride.otp, otp)) {
    const left = MAX_OTP_ATTEMPTS - ride.otpAttempts;
    throw new HttpError(400, left > 0 ? `OTP does not match. ${left} attempt${left === 1 ? '' : 's'} left.` : 'OTP does not match. No attempts left.');
  }
  const { modifiedCount } = await Ride.updateOne({ _id: id, status: 'driver_assigned' }, { status: 'otp_verified', startTime: new Date() });
  if (!modifiedCount) throw new HttpError(409, 'This ride is not waiting for an OTP');
  rideChanged(id);
  res.json(await findRide({ _id: id }, 'driver'));
});

// Auto-debit the fare from the passenger's wallet and credit the driver. The conditional update
// means the balance can never go negative; a failed debit is recorded and the passenger is told.
async function settleFare(ride) {
  const { modifiedCount } = await User.updateOne({ _id: ride.user, walletBalance: { $gte: ride.fare } }, { $inc: { walletBalance: -ride.fare } });
  const paid = modifiedCount === 1;
  await Payment.create({ user: ride.user, ride: ride._id, amount: ride.fare, method: 'wallet', status: paid ? 'success' : 'failed' });
  if (paid) await Driver.updateOne({ _id: ride.driver }, { $inc: { walletBalance: ride.fare } });
  return paid;
}

router.post('/rides/:id/status', driver, async (req, res) => {
  const id = rideId(req);
  const { status } = validate(req.body, { status: { required: true, oneOf: Object.values(NEXT_STATUS) } });
  const from = Object.keys(NEXT_STATUS).find((s) => NEXT_STATUS[s] === status);
  const ride = await Ride.findOneAndUpdate(
    { _id: id, driver: req.auth.id, status: from },
    { status, ...(status === 'completed' ? { endTime: new Date(), deviated: false } : {}) },
    { new: true },
  );
  if (!ride) throw new HttpError(409, `Ride must be "${from.replace('_', ' ')}" to move to "${status.replace('_', ' ')}"`);
  const extra = status === 'completed' ? { paid: await settleFare(ride) } : {};
  rideChanged(id, extra);
  res.json(await findRide({ _id: id }, 'driver'));
});

router.post('/rides/:id/cancel', either, async (req, res) => {
  const id = rideId(req);
  const { role } = req.auth;
  const { reason } = validate(req.body, { reason: { max: 200 } });
  const { modifiedCount } = await Ride.updateOne(
    { _id: id, [ownerField(role)]: req.auth.id, status: { $in: CANCELLABLE[role] } },
    { status: 'cancelled', cancel: { by: role, reason, at: new Date() } },
  );
  if (!modifiedCount) throw new HttpError(409, 'This ride can no longer be cancelled');
  rideChanged(id);
  res.json(await findRide({ _id: id }, role));
});

// Driver rating = average of passenger ratings across her completed rides.
async function refreshDriverRating(driverId) {
  const rides = await Ride.find({ driver: driverId, status: 'completed' }).distinct('_id');
  const [agg] = await Rating.aggregate([{ $match: { ride: { $in: rides }, ratedBy: 'passenger' } }, { $group: { _id: null, avg: { $avg: '$stars' } } }]);
  await Driver.updateOne({ _id: driverId }, { rating: agg ? Math.round(agg.avg * 10) / 10 : 0 });
}

router.post('/rides/:id/rate', either, async (req, res) => {
  const id = rideId(req);
  const { stars } = validate(req.body, { stars: { required: true, type: 'number', range: [1, 5] } });
  if (!Number.isInteger(stars)) throw new HttpError(400, 'stars must be a whole number from 1 to 5');
  const { feedback } = validate(req.body, { feedback: { max: 300 } });
  const ride = await Ride.findOne({ _id: id, [ownerField(req.auth.role)]: req.auth.id, status: 'completed' });
  if (!ride) throw new HttpError(404, 'Only your completed rides can be rated');
  const rating = await Rating.create({ ride: id, ratedBy: req.auth.role, stars, feedback })
    .catch(busy('You have already rated this ride'));
  if (req.auth.role === 'passenger') await refreshDriverRating(ride.driver);
  res.status(201).json(rating);
});

// Masked chat between the passenger and the assigned driver.
async function chatRide(req) {
  // For a driver the ownership key IS `driver`, so the "has a driver" condition must not share that key
  // (a duplicate key in one object literal would overwrite the ownership check).
  const filter = { _id: rideId(req), [ownerField(req.auth.role)]: req.auth.id };
  if (req.auth.role === 'passenger') filter.driver = { $exists: true };
  const ride = await Ride.findOne(filter);
  if (!ride) throw new HttpError(404, 'Ride not found');
  return ride;
}

router.get('/rides/:id/messages', either, async (req, res) => {
  const ride = await chatRide(req);
  res.json(await RideMessage.find({ ride: ride._id }).sort({ sentAt: 1 }).limit(200));
});

router.post('/rides/:id/messages', either, async (req, res) => {
  const ride = await chatRide(req);
  if (!DRIVER_BUSY_STATUSES.includes(ride.status)) throw new HttpError(409, 'Chat is open only during an active trip');
  const { message } = validate(req.body, { message: { required: true, max: 500 } });
  const msg = await RideMessage.create({ ride: ride._id, sender: req.auth.role, message });
  emit('passenger', ride.user, 'chat:message', msg);
  emit('driver', ride.driver, 'chat:message', msg);
  res.status(201).json(msg);
});

export default router;
