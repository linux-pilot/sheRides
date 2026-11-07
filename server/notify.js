// Fan-out for ride and safety events: WebSocket push, in-app notifications and email (SMTP).
import { Notification, Ride } from './models.js';
import { emit, emitRole } from './realtime.js';
import { sendMail } from './mailer.js';

const mapLink = (p) => (p?.lat != null ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}` : 'not available yet');
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// In-app notification for a passenger + live push of the new item.
// `alert: true` marks it urgent for the live toast (not stored).
export async function notifyUser(userId, message, { alert = false } = {}) {
  const n = await Notification.create({ user: userId, message });
  emit('passenger', userId, 'notification', { ...n.toObject(), alert });
}

const PASSENGER_TEXT = {
  requested: () => 'Ride booked. Looking for a verified woman driver near you.',
  driver_assigned: (r) => `${r.driver.name} accepted your ride — ${r.driver.vehicleModel}, ${r.driver.vehiclePlate}. Share your OTP only inside the car.`,
  otp_verified: () => 'Safety OTP verified. Your ride has started.',
  en_route: () => 'You are on the way.',
  arrived: (r) => `You have arrived at ${r.drop.address}.`,
  completed: (r) => `Trip completed. ${inr(r.fare)} ${{ false: 'could not be debited — please top up your wallet', null: 'payment is being checked; we will contact you if anything is due' }[r.paid] || 'paid from your wallet'}. Rate your driver in Ride history.`,
  cancelled: (r) => ({
    driver: 'Ride cancelled by the driver. Please book again.',
    admin: `Ride cancelled by the SheRides control room${r.cancel.reason ? ` (${r.cancel.reason})` : ''}. Please book again if you still need a ride.`,
  })[r.cancel?.by] || 'Ride cancelled.',
};
// Trip sharing: these changes are emailed to emergency contacts when the passenger has sharing on.
const SHARED = ['driver_assigned', 'otp_verified', 'completed', 'cancelled'];
// The passenger's own emails: only the ones worth an inbox (driver & car, receipt, cancellation).
// Everything else (booked, OTP verified, on the way, arrived) stays an in-app notification.
const EMAIL_SELF = ['driver_assigned', 'completed', 'cancelled'];

function shareText(r) {
  const d = r.driver;
  return [
    `${r.user.name}'s SheRides trip update: ${r.status.replace('_', ' ')}.`,
    `From: ${r.pickup.address}`,
    `To:   ${r.drop.address}`,
    d ? `Driver: ${d.name} · ${d.vehicleModel} · ${d.vehiclePlate}` : '',
    `Driver's last known location: ${mapLink(d?.location)}`,
    '',
    'You receive this because you are listed as an emergency contact on SheRides.',
  ].filter((l) => l !== '').join('\n');
}

// Call after any ride status change (fire-and-forget; never throws to the caller).
export async function rideChanged(rideId, extra = {}) {
  try {
    const r = await Ride.findById(rideId)
      .populate({ path: 'driver', select: 'name vehicleModel vehiclePlate location' })
      .populate({ path: 'user', select: 'name email emergencyContacts preferences' });
    if (!r) return;
    const ride = Object.assign(r.toObject(), extra);
    const event = { id: String(r._id), status: r.status };

    emit('passenger', r.user._id, 'ride:update', event);
    if (r.driver) emit('driver', r.driver._id, 'ride:update', event);
    emitRole('admin', 'ride:update', event);
    // Open-request lists change when a ride is booked, taken or cancelled.
    if (['requested', 'driver_assigned', 'cancelled'].includes(r.status)) emitRole('driver', 'ride:request', event);

    const text = PASSENGER_TEXT[r.status]?.(ride);
    if (text) await notifyUser(r.user._id, text);

    const prefs = r.user.preferences || {};
    if (prefs.emailUpdates !== false && text && EMAIL_SELF.includes(r.status)) await sendMail(r.user.email, `SheRides: ${text.split(/[.—]/)[0].trim()}`, text);
    if (prefs.shareTrips !== false && SHARED.includes(r.status)) {
      await sendMail(r.user.emergencyContacts.map((c) => c.email), `SheRides trip update for ${r.user.name}`, shareText(ride));
    }
  } catch (err) {
    console.error('[rideChanged]', err);
  }
}

export { mapLink };
