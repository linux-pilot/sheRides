// SOS and safety settings.
//   GET  /safety/config            public           geo-fence + deviation settings (shown in the UI)
//   POST /sos            { lat?, lng? }  passenger|driver   raise SOS (one active per person)
//   GET  /sos/active                passenger|driver   my active SOS, if any
//   POST /sos/:id/resolve           owner ("I am safe") or admin
//   GET  /admin/sos?status=         admin
//   WS   sos:location {lat, lng}    passenger|driver   live location while an SOS is active → admin `sos:location`
// Admins receive `sos:alert` when an SOS is raised ({ id, status: 'active', name, raisedBy, location }) or resolved
// ({ id, status: 'resolved' }).
import { Router } from 'express';
import { ACCOUNT_MODEL, OWNER_FIELD, Ride, SosAlert, User } from '../models.js';
import { HttpError, idParam, POINT, requireRole, validate } from '../middleware.js';
import { emitRole } from '../realtime.js';
import { driverLine, mailContacts, mapLink, notifyUser } from '../notify.js';
import { ACTIVE_STATUSES, DEVIATION_M, SERVICE_AREA } from '../rideRules.js';

const router = Router();
// Safety never stops at a blocked account.
const raiser = requireRole('passenger', 'driver', { blockedOk: true });
const ownSos = ({ role, id }) => ({ [OWNER_FIELD[role]]: id, raisedBy: role });

router.get('/safety/config', (req, res) => res.json({ deviationM: DEVIATION_M, serviceArea: SERVICE_AREA }));

router.post('/sos', raiser, async (req, res) => {
  const { role, id } = req.auth;
  // Location is optional: SOS must go out even when the browser cannot locate her.
  const p = validate(req.body, { lat: { ...POINT.lat, required: false }, lng: { ...POINT.lng, required: false } });
  const point = p.lat != null && p.lng != null ? p : null;
  const existing = await SosAlert.findOne({ ...ownSos(req.auth), status: 'active' });
  if (existing) return res.json(existing); // a second tap must not spam contacts

  const ride = await Ride.findOne({ [OWNER_FIELD[role]]: id, status: { $in: ACTIVE_STATUSES } })
    .populate({ path: 'driver', select: 'name vehicleModel vehiclePlate location' });
  const location = point || (ride?.driver?.location?.lat != null ? ride.driver.location : undefined);
  const userId = role === 'passenger' ? id : ride?.user;

  let sos;
  try {
    sos = await SosAlert.create({ ...ownSos(req.auth), user: userId, driver: role === 'driver' ? id : ride?.driver?._id, ride: ride?._id, location });
  } catch (err) {
    if (err.code === 11000) return res.json(await SosAlert.findOne({ ...ownSos(req.auth), status: 'active' }));
    throw err;
  }

  const who = await ACCOUNT_MODEL[role].findById(id);
  const passenger = role === 'passenger' ? who : userId && (await User.findById(userId));
  emitRole('admin', 'sos:alert', { id: String(sos._id), status: 'active', name: who.name, raisedBy: role, location });

  // Email the passenger's emergency contacts with live location, driver and vehicle.
  // ponytail: police control room call is mocked; upgrade path is Twilio.
  if (passenger) {
    const d = ride?.driver;
    // Not awaited: the reply must not wait on a slow mail server.
    mailContacts(passenger, `URGENT: SOS from ${passenger.name} on SheRides`, [
      `${passenger.name} has pressed SOS${role === 'driver' ? ` (raised by the driver ${who.name})` : ''}.`,
      `Location: ${mapLink(location)}`,
      ride ? `Trip: ${ride.pickup.address} → ${ride.drop.address}` : 'Not on a SheRides trip right now.',
      d ? driverLine(d) : '',
      '',
      'The SheRides control room has been alerted. If you cannot reach her, call 112.',
    ].filter(Boolean).join('\n'));
    await notifyUser(passenger._id, 'SOS sent. Your emergency contacts and the SheRides control room have been alerted.');
  }
  res.status(201).json(sos);
});

router.get('/sos/active', raiser, async (req, res) => {
  res.json(await SosAlert.findOne({ ...ownSos(req.auth), status: 'active' }));
});

router.post('/sos/:id/resolve', requireRole('passenger', 'driver', 'admin', { blockedOk: true }), async (req, res) => {
  const filter = { _id: idParam(req.params.id, 'SOS'), status: 'active', ...(req.auth.role === 'admin' ? {} : ownSos(req.auth)) };
  const sos = await SosAlert.findOneAndUpdate(filter, { status: 'resolved', resolvedAt: new Date() }, { new: true });
  if (!sos) throw new HttpError(404, 'No active SOS to resolve');
  emitRole('admin', 'sos:alert', { id: String(sos._id), status: 'resolved' });

  const passenger = sos.user && (await User.findById(sos.user));
  if (passenger) {
    const bySelf = req.auth.role !== 'admin';
    mailContacts(passenger, `Update: ${passenger.name} is safe`,
      `${passenger.name}'s SOS has been ${bySelf ? 'stood down — she marked herself safe' : 'resolved by the SheRides control room'}.`);
    await notifyUser(passenger._id, bySelf ? 'SOS stood down. Glad you are safe.' : 'Your SOS was resolved by the control room.');
  }
  res.json(sos);
});

router.get('/admin/sos', requireRole('admin'), async (req, res) => {
  const { status = 'all' } = validate(req.query, { status: { oneOf: ['active', 'resolved', 'all'] } });
  res.json(await SosAlert.find(status === 'all' ? {} : { status })
    .populate([{ path: 'user', select: 'name phone' }, { path: 'driver', select: 'name vehicleModel vehiclePlate phone' }, { path: 'ride', select: 'pickup drop status' }])
    .sort({ status: 1, triggeredAt: -1 }).limit(200));
});

// WebSocket `sos:location`: keep the active SOS's location current for the control room. If the SOS went out without
// a location (browser too slow, not on a ride), the first fix is also emailed to the passenger's emergency contacts.
export async function sosLocation(auth, data) {
  if (!OWNER_FIELD[auth.role]) throw new HttpError(403, 'Only passengers and drivers raise SOS');
  const location = validate(data, POINT);
  // Returns the alert as it was BEFORE this update, so exactly one update sees "no location yet".
  const before = await SosAlert.findOneAndUpdate({ ...ownSos(auth), status: 'active' }, { location });
  if (!before) return;
  emitRole('admin', 'sos:location', { id: String(before._id), location });
  const passenger = before.location?.lat == null && before.user && (await User.findById(before.user));
  if (passenger) {
    mailContacts(passenger, `URGENT: location for ${passenger.name}'s SOS`, [
      `${passenger.name}'s SOS is still active. Her location is now known:`,
      mapLink(location),
      '',
      'The SheRides control room has been alerted. If you cannot reach her, call 112.',
    ].join('\n'));
  }
}

export default router;
