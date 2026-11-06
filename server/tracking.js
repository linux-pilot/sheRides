// WebSocket messages from clients: live driver GPS (with route-deviation check) and SOS location stream.
import { Driver, Ride, SosAlert } from './models.js';
import { HttpError, validate } from './middleware.js';
import { emit, emitRole } from './realtime.js';
import { notifyUser } from './notify.js';
import { DEVIATION_M, distanceToPathM, DRIVER_BUSY_STATUSES } from './rideRules.js';

const POINT = { lat: { required: true, type: 'number', range: [-90, 90] }, lng: { required: true, type: 'number', range: [-180, 180] } };
const MONITORED = ['otp_verified', 'en_route']; // deviation is only meaningful while the passenger is on board

async function driverLocation(auth, data) {
  if (auth.role !== 'driver') throw new HttpError(403, 'Only drivers send location');
  const loc = validate(data, POINT);
  await Driver.updateOne({ _id: auth.id }, { location: loc });

  const ride = await Ride.findOne({ driver: auth.id, status: { $in: DRIVER_BUSY_STATUSES } });
  if (!ride) return;
  const payload = { rideId: String(ride._id), ...loc, deviated: ride.deviated };
  if (!MONITORED.includes(ride.status)) {
    emit('passenger', ride.user, 'driver:location', payload);
    emitRole('admin', 'driver:location', payload);
    return;
  }

  const path = ride.route?.length > 1 ? ride.route : [[ride.pickup.lat, ride.pickup.lng], [ride.drop.lat, ride.drop.lng]];
  const offM = Math.round(distanceToPathM(loc, path));
  const deviated = offM > DEVIATION_M;
  // Flip the flag atomically so a burst of GPS points raises exactly one alert.
  const flipped = deviated !== ride.deviated
    && (await Ride.updateOne({ _id: ride._id, deviated: !deviated }, { deviated })).modifiedCount === 1;
  payload.deviated = deviated;
  emit('passenger', ride.user, 'driver:location', payload);
  emitRole('admin', 'driver:location', payload);

  if (flipped) {
    const alert = { rideId: String(ride._id), deviated, offM, ...loc };
    emit('passenger', ride.user, 'deviation:alert', alert);
    emit('driver', auth.id, 'deviation:alert', alert);
    emitRole('admin', 'deviation:alert', alert);
    await notifyUser(ride.user, deviated
      ? `Route alert: your car is ${offM} m off the planned route. Our control room has been notified. Use SOS if you feel unsafe.`
      : 'Your car is back on the planned route.', { alert: deviated });
  }
}

async function sosLocation(auth, data) {
  if (!['passenger', 'driver'].includes(auth.role)) return;
  const loc = validate(data, POINT);
  const who = auth.role === 'passenger' ? { user: auth.id, raisedBy: 'passenger' } : { driver: auth.id, raisedBy: 'driver' };
  const sos = await SosAlert.findOneAndUpdate({ ...who, status: 'active' }, { location: loc }, { new: true });
  if (sos) emitRole('admin', 'sos:alert', { id: String(sos._id), status: sos.status, location: loc });
}

const HANDLERS = { 'driver:location': driverLocation, 'sos:location': sosLocation };
export const handleLive = (auth, type, data) => HANDLERS[type]?.(auth, data);
