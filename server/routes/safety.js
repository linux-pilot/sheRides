// SOS and safety settings.
//   GET  /safety/config            public           geo-fence + deviation settings (shown in the UI)
//   POST /sos            { lat?, lng? }  passenger|driver   raise SOS (one active per person)
//   GET  /sos/active                passenger|driver   my active SOS, if any
//   POST /sos/:id/resolve           owner ("I am safe") or admin
import { Router } from 'express';
import mongoose from 'mongoose';
import { Driver, Ride, SosAlert, User } from '../models.js';
import { HttpError, requireRole, validate } from '../middleware.js';
import { emitRole } from '../realtime.js';
import { sendMail } from '../mailer.js';
import { mapLink, notifyUser } from '../notify.js';
import { DEVIATION_M, DRIVER_BUSY_STATUSES, SERVICE_AREA } from '../rideRules.js';

const router = Router();
const POINT = { lat: { type: 'number', range: [-90, 90] }, lng: { type: 'number', range: [-180, 180] } };
const ownFilter = ({ role, id }) => (role === 'passenger' ? { user: id, raisedBy: 'passenger' } : { driver: id, raisedBy: 'driver' });

router.get('/safety/config', (req, res) => res.json({ deviationM: DEVIATION_M, serviceArea: SERVICE_AREA }));

router.post('/sos', requireRole('passenger', 'driver'), async (req, res) => {
  const { role, id } = req.auth;
  const point = validate(req.body, POINT);
  const existing = await SosAlert.findOne({ ...ownFilter(req.auth), status: 'active' });
  if (existing) return res.json(existing); // a second tap must not spam contacts

  const ride = await Ride.findOne({ [role === 'passenger' ? 'user' : 'driver']: id, status: { $in: ['requested', ...DRIVER_BUSY_STATUSES] } })
    .populate({ path: 'driver', select: 'name vehicleModel vehiclePlate phone location' });
  const location = point.lat != null && point.lng != null ? point : ride?.driver?.location?.lat != null ? ride.driver.location : undefined;
  const userId = role === 'passenger' ? id : ride?.user;

  let sos;
  try {
    sos = await SosAlert.create({ ...ownFilter(req.auth), user: userId, driver: role === 'driver' ? id : ride?.driver?._id, ride: ride?._id, location });
  } catch (err) {
    if (err.code === 11000) return res.json(await SosAlert.findOne({ ...ownFilter(req.auth), status: 'active' }));
    throw err;
  }

  const raiser = role === 'passenger' ? await User.findById(id) : await Driver.findById(id);
  const passenger = role === 'passenger' ? raiser : userId && (await User.findById(userId));
  emitRole('admin', 'sos:alert', { id: String(sos._id), status: 'active', name: raiser.name, raisedBy: role, location });

  // Email the passenger's emergency contacts with live location, driver and vehicle.
  // ponytail: police control room call is mocked; upgrade path is Twilio.
  if (passenger) {
    const d = ride?.driver;
    // Not awaited: the reply must not wait on a slow mail server (sendMail never throws).
    sendMail(passenger.emergencyContacts.map((c) => c.email), `URGENT: SOS from ${passenger.name} on SheRides`, [
      `${passenger.name} has pressed SOS${role === 'driver' ? ` (raised by the driver ${raiser.name})` : ''}.`,
      `Location: ${mapLink(location)}`,
      ride ? `Trip: ${ride.pickup.address} → ${ride.drop.address}` : 'Not on a SheRides trip right now.',
      d ? `Driver: ${d.name} · ${d.vehicleModel} · ${d.vehiclePlate}` : '',
      '',
      'The SheRides control room has been alerted. If you cannot reach her, call 112.',
    ].filter(Boolean).join('\n'));
    await notifyUser(passenger._id, 'SOS sent. Your emergency contacts and the SheRides control room have been alerted.');
  }
  res.status(201).json(sos);
});

router.get('/sos/active', requireRole('passenger', 'driver'), async (req, res) => {
  res.json(await SosAlert.findOne({ ...ownFilter(req.auth), status: 'active' }));
});

router.post('/sos/:id/resolve', requireRole('passenger', 'driver', 'admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'SOS not found');
  const filter = { _id: req.params.id, status: 'active', ...(req.auth.role === 'admin' ? {} : ownFilter(req.auth)) };
  const sos = await SosAlert.findOneAndUpdate(filter, { status: 'resolved', resolvedAt: new Date() }, { new: true });
  if (!sos) throw new HttpError(404, 'No active SOS to resolve');
  emitRole('admin', 'sos:alert', { id: String(sos._id), status: 'resolved' });

  const passenger = sos.user && (await User.findById(sos.user));
  if (passenger) {
    const bySelf = req.auth.role !== 'admin';
    sendMail(passenger.emergencyContacts.map((c) => c.email), `Update:${passenger.name} is safe`,
      `${passenger.name}'s SOS has been ${bySelf ? 'stood down — she marked herself safe' : 'resolved by the SheRides control room'}.`);
    await notifyUser(passenger._id, bySelf ? 'SOS stood down. Glad you are safe.' : 'Your SOS was resolved by the control room.');
  }
  res.json(sos);
});

export default router;
