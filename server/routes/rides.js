// Booking, fare estimate, safety OTP, ride lifecycle, live driver location + deviation, ratings and masked chat.
//   GET  /tiers                          public
//   POST /rides/estimate                 passenger    { pickup, drop } → { km, durationMin, route, fares }
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
//   GET  /admin/rides                    admin        active rides with live driver location
//   POST /admin/rides/:id/cancel         admin        { reason? }  (any active status)
//   WS   driver:location {lat, lng}      driver       live GPS, relayed to passenger + admin, checked for deviation
// The OTP is only ever sent to the passenger; drivers must hear it in the car.
import { Router } from 'express';
import { CHAT_MAX, Driver, OWNER_FIELD, Payment, Rating, Ride, RideMessage, User } from '../models.js';
import { HttpError, idParam, POINT, requireRole, validate } from '../middleware.js';
import { emit, emitRole } from '../realtime.js';
import { inr, notifyUser, rideChanged } from '../notify.js';
import { roadRoute } from '../routing.js';
import {
  ACTIVE_STATUSES, CANCELLABLE, DEVIATION_M, distanceKm, distanceToPathM, DRIVER_BUSY_STATUSES, fareFor,
  insideServiceArea, makeOtp, MAX_OTP_ATTEMPTS, MIN_KM, MONITORED_STATUSES, NEXT_STATUS, otpMatches,
  PAST_STATUSES, SERVICE_AREA, TIER_IDS, TIERS,
} from '../rideRules.js';

const router = Router();
const passenger = requireRole('passenger');
const driver = requireRole('driver');
const either = requireRole('passenger', 'driver');
const eitherBlockedOk = requireRole('passenger', 'driver', { blockedOk: true }); // finishing a ride already under way
const admin = requireRole('admin');

const PLACE = { address: { required: true, max: 200 }, ...POINT };
// Validates both places and the geo-fence, then plans the route: the road route, or a straight line if the router
// is unavailable (fare distance follows the same choice).
async function readTrip(body) {
  const pickup = validate(body?.pickup, PLACE, 'pickup.');
  const drop = validate(body?.drop, PLACE, 'drop.');
  const straight = distanceKm(pickup, drop);
  if (straight < MIN_KM) throw new HttpError(400, 'Pickup and destination are too close together');
  const outside = [['Pickup', pickup], ['Destination', drop]].filter(([, p]) => !insideServiceArea(p)).map(([name]) => name);
  if (outside.length) {
    throw new HttpError(400, `${outside.join(' and ')} ${outside.length > 1 ? 'are' : 'is'} outside the SheRides service area. Rides must start and end within ${SERVICE_AREA.radiusKm} km of ${SERVICE_AREA.name} centre.`);
  }
  const road = await roadRoute(pickup, drop);
  return road
    ? { pickup, drop, km: road.km, durationMin: road.durationMin, route: road.path }
    : { pickup, drop, km: straight, durationMin: Math.max(1, Math.round((straight / 25) * 60)), route: [[pickup.lat, pickup.lng], [drop.lat, drop.lng]] }; // ~25 km/h city
}

// Each side sees the other's name and the vehicle, never phone numbers (masked calling).
const POPULATE = [{ path: 'driver', select: 'name vehicleModel vehiclePlate rating location' }, { path: 'user', select: 'name' }];
// Past rides: no driver location, or a former passenger could keep following a driver after the trip.
const POPULATE_PAST = [{ path: 'driver', select: 'name vehicleModel vehiclePlate rating' }, { path: 'user', select: 'name' }];
const findRide = (filter, role) => {
  const q = Ride.findOne(filter).populate(POPULATE);
  return role === 'passenger' ? q.select('+otp') : q;
};
// E11000 on a unique index (one active ride per person, one rating per side) → 409 with `message`.
const busy = (message) => (err) => { throw err.code === 11000 ? new HttpError(409, message) : err; };

// Auto-debit the fare from the passenger's wallet and credit the driver. The conditional update means the balance
// can never go negative; a failed debit is recorded as a failed payment.
// ponytail: completion, wallet debit, payment record and driver credit are separate writes (standalone Mongo has no
// transactions), so a failure between them is logged with the ride id for a manual check; the trip still ends and
// both sides are told. Upgrade: run Mongo as a replica set and wrap this in session.withTransaction().
async function settleFare(ride) {
  try {
    const { modifiedCount } = await User.updateOne({ _id: ride.user, walletBalance: { $gte: ride.fare } }, { $inc: { walletBalance: -ride.fare } });
    const paid = modifiedCount === 1;
    await Payment.create({ user: ride.user, ride: ride._id, amount: ride.fare, method: 'wallet', status: paid ? 'success' : 'failed' });
    if (paid) await Driver.updateOne({ _id: ride.driver }, { $inc: { walletBalance: ride.fare } });
  } catch (err) {
    console.error(`[settleFare] ride ${ride._id} completed but payment needs a manual check`, err);
  }
}

// Every status change after booking goes through here: one conditional update (so races have one winner), the
// deviation flag only survives while the trip is monitored, the fare is settled on completion (before anyone is
// told, so the message can say whether it was paid), and everyone concerned is told.
// Returns the updated ride, or null if `filter` missed.
async function changeRide(filter, update) {
  const deviated = MONITORED_STATUSES.includes(update.status) ? {} : { deviated: false };
  const ride = await Ride.findOneAndUpdate(filter, { ...update, ...deviated }, { new: true });
  if (!ride) return null;
  if (ride.status === 'completed') await settleFare(ride);
  rideChanged(ride._id);
  return ride;
}

// A driver who can no longer drive (rejected or blocked) must not pick anyone up: a ride she accepted but has not
// started is cancelled so the passenger can rebook at once. A ride already under way continues (admin can cancel it).
export const releaseAcceptedRide = (driverId) => changeRide(
  { driver: driverId, status: 'driver_assigned' },
  { status: 'cancelled', cancel: { by: 'admin', reason: 'your driver is no longer available', at: new Date() } },
);

router.get('/tiers', (req, res) => res.json(TIERS));

router.post('/rides/estimate', passenger, async (req, res) => {
  const trip = await readTrip(req.body);
  res.json({ km: trip.km, durationMin: trip.durationMin, route: trip.route, fares: TIERS.map((t) => ({ ...t, fare: fareFor(t.id, trip.km) })) });
});

router.post('/rides', passenger, async (req, res) => {
  const trip = await readTrip(req.body);
  const { tier } = validate(req.body, { tier: { required: true, oneOf: TIER_IDS } });
  const fare = fareFor(tier, trip.km);
  const user = await User.findById(req.auth.id);
  if (user.walletBalance < fare) throw new HttpError(402, `Wallet balance is ${inr(user.walletBalance)}. Top up at least ${inr(fare - user.walletBalance)} to book this ride.`);

  const ride = await Ride.create({ ...trip, tier, user: req.auth.id, fare, otp: makeOtp() })
    .catch(busy('You already have an active ride'));
  rideChanged(ride._id);
  res.status(201).json(await findRide({ _id: ride._id }, 'passenger'));
});

router.get('/rides/active', eitherBlockedOk, async (req, res) => {
  const statuses = req.auth.role === 'driver' ? DRIVER_BUSY_STATUSES : ACTIVE_STATUSES;
  res.json(await findRide({ [OWNER_FIELD[req.auth.role]]: req.auth.id, status: { $in: statuses } }, req.auth.role));
});

router.get('/rides', either, async (req, res) => {
  const rides = await Ride.find({ [OWNER_FIELD[req.auth.role]]: req.auth.id, status: { $in: PAST_STATUSES } })
    .populate(POPULATE_PAST).sort({ createdAt: -1 }).limit(50).lean();
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
  res.json(await Ride.find({ status: 'requested', declinedBy: { $ne: req.auth.id } }).populate(POPULATE).sort({ createdAt: 1 }).limit(20));
});

router.post('/driver/rides/:id/accept', driver, async (req, res) => {
  const id = idParam(req.params.id, 'Ride');
  await assertCanDrive(req.auth.id);
  const ride = await changeRide(
    { _id: id, status: 'requested', declinedBy: { $ne: req.auth.id } },
    { driver: req.auth.id, status: 'driver_assigned', acceptedAt: new Date() },
  ).catch(busy('Finish your current ride before accepting another'));
  if (!ride) throw new HttpError(409, 'This ride is no longer available');
  res.json(await findRide({ _id: id }, 'driver'));
});

router.post('/driver/rides/:id/reject', driver, async (req, res) => {
  await Ride.updateOne({ _id: idParam(req.params.id, 'Ride'), status: 'requested' }, { $addToSet: { declinedBy: req.auth.id } });
  res.json({ ok: true });
});

router.post('/rides/:id/start', driver, async (req, res) => {
  const id = idParam(req.params.id, 'Ride');
  const { otp } = validate(req.body, { otp: { required: true, pattern: /^\d{6}$/ } });
  // A driver rejected after accepting must not pick the passenger up (rejecting also cancels such rides).
  if (!(await Driver.exists({ _id: req.auth.id, verificationStatus: 'approved' }))) {
    throw new HttpError(403, 'Your account is not cleared to drive right now, so this ride cannot start');
  }
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
  if (!(await changeRide({ _id: id, status: 'driver_assigned' }, { status: 'otp_verified', startTime: new Date() }))) {
    throw new HttpError(409, 'This ride is not waiting for an OTP');
  }
  res.json(await findRide({ _id: id }, 'driver'));
});

router.post('/rides/:id/status', requireRole('driver', { blockedOk: true }), async (req, res) => {
  const id = idParam(req.params.id, 'Ride');
  const { status } = validate(req.body, { status: { required: true, oneOf: Object.values(NEXT_STATUS) } });
  const from = Object.keys(NEXT_STATUS).find((s) => NEXT_STATUS[s] === status);
  const ride = await changeRide(
    { _id: id, driver: req.auth.id, status: from },
    { status, ...(status === 'completed' ? { endTime: new Date() } : {}) },
  );
  if (!ride) throw new HttpError(409, `Ride must be "${from.replace('_', ' ')}" to move to "${status.replace('_', ' ')}"`);
  res.json(await findRide({ _id: id }, 'driver'));
});

router.post('/rides/:id/cancel', eitherBlockedOk, async (req, res) => {
  const id = idParam(req.params.id, 'Ride');
  const { role } = req.auth;
  const { reason } = validate(req.body, { reason: { max: 200 } });
  const ride = await changeRide(
    { _id: id, [OWNER_FIELD[role]]: req.auth.id, status: { $in: CANCELLABLE[role] } },
    { status: 'cancelled', cancel: { by: role, reason, at: new Date() } },
  );
  if (!ride) throw new HttpError(409, 'This ride can no longer be cancelled');
  res.json(await findRide({ _id: id }, role));
});

async function refreshDriverRating(driverId) {
  const rides = await Ride.find({ driver: driverId, status: 'completed' }).distinct('_id');
  const [agg] = await Rating.aggregate([{ $match: { ride: { $in: rides }, ratedBy: 'passenger' } }, { $group: { _id: null, avg: { $avg: '$stars' } } }]);
  await Driver.updateOne({ _id: driverId }, { rating: agg ? Math.round(agg.avg * 10) / 10 : 0 });
}

router.post('/rides/:id/rate', either, async (req, res) => {
  const id = idParam(req.params.id, 'Ride');
  const { stars, feedback } = validate(req.body, { stars: { required: true, type: 'integer', range: [1, 5] }, feedback: { max: 300 } });
  const ride = await Ride.findOne({ _id: id, [OWNER_FIELD[req.auth.role]]: req.auth.id, status: 'completed' });
  if (!ride) throw new HttpError(404, 'Only your completed rides can be rated');
  const rating = await Rating.create({ ride: id, ratedBy: req.auth.role, stars, feedback })
    .catch(busy('You have already rated this ride'));
  if (req.auth.role === 'passenger') await refreshDriverRating(ride.driver);
  res.status(201).json(rating);
});

async function chatRide(req) {
  // For a driver the ownership key IS `driver`, so the "has a driver" condition must not share that key
  // (a duplicate key in one object literal would overwrite the ownership check).
  const filter = { _id: idParam(req.params.id, 'Ride'), [OWNER_FIELD[req.auth.role]]: req.auth.id };
  if (req.auth.role === 'passenger') filter.driver = { $exists: true };
  const ride = await Ride.findOne(filter);
  if (!ride) throw new HttpError(404, 'Ride not found');
  return ride;
}

router.get('/rides/:id/messages', eitherBlockedOk, async (req, res) => {
  const ride = await chatRide(req);
  res.json(await RideMessage.find({ ride: ride._id }).sort({ sentAt: 1 }).limit(200));
});

router.post('/rides/:id/messages', eitherBlockedOk, async (req, res) => {
  const ride = await chatRide(req);
  if (!DRIVER_BUSY_STATUSES.includes(ride.status)) throw new HttpError(409, 'Chat is open only during an active trip');
  const { message } = validate(req.body, { message: { required: true, max: CHAT_MAX } });
  const msg = await RideMessage.create({ ride: ride._id, sender: req.auth.role, message });
  emit('passenger', ride.user, 'chat:message', msg);
  emit('driver', ride.driver, 'chat:message', msg);
  res.status(201).json(msg);
});

router.get('/admin/rides', admin, async (req, res) => {
  res.json(await Ride.find({ status: { $in: ACTIVE_STATUSES } })
    .populate([{ path: 'driver', select: 'name vehicleModel vehiclePlate location' }, { path: 'user', select: 'name' }])
    .sort({ createdAt: -1 }).limit(200));
});

// Control-room cancel for a ride nobody else can end (e.g. the driver vanished mid-trip): passengers and drivers
// cannot cancel after the OTP, and the one-active-ride index would otherwise lock both out of new rides.
// No fare is charged: payment only happens on `completed`.
router.post('/admin/rides/:id/cancel', admin, async (req, res) => {
  const id = idParam(req.params.id, 'Ride');
  const { reason } = validate(req.body, { reason: { max: 200 } });
  const ride = await changeRide(
    { _id: id, status: { $in: ACTIVE_STATUSES } },
    { status: 'cancelled', cancel: { by: 'admin', reason, at: new Date() } },
  );
  if (!ride) throw new HttpError(409, 'This ride is no longer active');
  res.json(ride);
});

// WebSocket `driver:location`: store the position, relay it, and while the passenger is on board raise one alert
// each time the car leaves or rejoins the planned route.
export async function driverLocation(auth, data) {
  if (auth.role !== 'driver') throw new HttpError(403, 'Only drivers send location');
  const loc = validate(data, POINT);
  await Driver.updateOne({ _id: auth.id }, { location: loc });
  const ride = await Ride.findOne({ driver: auth.id, status: { $in: DRIVER_BUSY_STATUSES } });
  if (!ride) return;

  let { deviated } = ride;
  let offM = 0;
  let flipped = false;
  if (MONITORED_STATUSES.includes(ride.status)) {
    offM = Math.round(distanceToPathM(loc, ride.route));
    deviated = offM > DEVIATION_M;
    // Flip the flag atomically so a burst of GPS points raises exactly one alert.
    flipped = deviated !== ride.deviated
      && (await Ride.updateOne({ _id: ride._id, deviated: !deviated }, { deviated })).modifiedCount === 1;
  }
  const payload = { rideId: String(ride._id), ...loc, deviated };
  emit('passenger', ride.user, 'driver:location', payload);
  emitRole('admin', 'driver:location', payload);
  if (!flipped) return;

  const alert = { ...payload, offM };
  emit('passenger', ride.user, 'deviation:alert', alert);
  emit('driver', auth.id, 'deviation:alert', alert);
  emitRole('admin', 'deviation:alert', alert);
  await notifyUser(ride.user, deviated
    ? `Route alert: your car is ${offM} m off the planned route. Our control room has been notified. Use SOS if you feel unsafe.`
    : 'Your car is back on the planned route.', { alert: deviated });
}

export default router;
