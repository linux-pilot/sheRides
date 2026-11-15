// Fan-out for ride and safety events: WebSocket push, in-app notifications and email (SMTP).
import { Notification, Payment, Ride } from './models.js';
import { emit, emitRole } from './realtime.js';
import { sendMail } from './mailer.js';
import { statusLabel } from './rideRules.js';

export const mapLink = (p) => (p?.lat != null ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}` : 'not available yet');
export const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
export const driverLine = (d) => `Driver: ${d.name} · ${d.vehicleModel} · ${d.vehiclePlate}`;

// Email a passenger's emergency contacts (Bcc). Never throws.
export const mailContacts = (user, subject, text) => sendMail(user.emergencyContacts.map((c) => c.email), subject, text);

// In-app notification for a passenger + live push of the new item. `alert: true` marks it urgent for the live toast.
export async function notifyUser(userId, message, { alert = false } = {}) {
  const n = await Notification.create({ user: userId, message });
  emit('passenger', userId, 'notification', { ...n.toObject(), alert });
}

const PAYMENT_TEXT = {
  success: 'paid from your wallet',
  failed: 'could not be debited — please top up your wallet',
  missing: 'payment is being checked; we will contact you if anything is due',
};
const PASSENGER_TEXT = {
  requested: () => 'Ride booked. Looking for a verified woman driver near you.',
  driver_assigned: (r) => `${r.driver.name} accepted your ride — ${r.driver.vehicleModel}, ${r.driver.vehiclePlate}. Share your OTP only inside the car.`,
  otp_verified: () => 'Safety OTP verified. Your ride has started.',
  en_route: () => 'You are on the way.',
  arrived: (r) => `You have arrived at ${r.drop.address}.`,
  completed: (r, payment) => `Trip completed. ${inr(r.fare)} ${PAYMENT_TEXT[payment?.status || 'missing']}. Rate your driver in Ride history.`,
  cancelled: (r) => ({
    driver: 'Ride cancelled by the driver. Please book again.',
    admin: `Ride cancelled by the SheRides control room${r.cancel.reason ? ` (${r.cancel.reason})` : ''}. Please book again if you still need a ride.`,
  })[r.cancel?.by] || 'Ride cancelled.',
};
// Trip sharing: these changes are emailed to emergency contacts when the passenger has sharing on.
const SHARED = ['driver_assigned', 'otp_verified', 'completed', 'cancelled'];
// The passenger's own emails, by subject: only the ones worth an inbox (driver & car, receipt, cancellation).
const EMAIL_SUBJECT = {
  driver_assigned: (r) => `${r.driver.name} accepted your ride`,
  completed: () => 'Trip completed',
  cancelled: () => 'Ride cancelled',
};
// Open-request lists change when a ride is booked, taken or cancelled.
const REQUEST_LIST_CHANGES = ['requested', 'driver_assigned', 'cancelled'];

function shareText(r) {
  const d = r.driver;
  return [
    `${r.user.name}'s SheRides trip update: ${statusLabel(r.status)}.`,
    `From: ${r.pickup.address}`,
    `To:   ${r.drop.address}`,
    d ? driverLine(d) : '',
    `Driver's last known location: ${mapLink(d?.location)}`,
    '',
    'You receive this because you are listed as an emergency contact on SheRides.',
  ].filter((l) => l !== '').join('\n');
}

// Tells everyone concerned about a ride's new status. Fire-and-forget: never throws to the caller.
export async function rideChanged(rideId) {
  try {
    const r = await Ride.findById(rideId)
      .populate({ path: 'driver', select: 'name vehicleModel vehiclePlate location' })
      .populate({ path: 'user', select: 'name email emergencyContacts preferences' });
    if (!r) return;
    const event = { id: String(r._id), status: r.status };

    emit('passenger', r.user._id, 'ride:update', event);
    if (r.driver) emit('driver', r.driver._id, 'ride:update', event);
    emitRole('admin', 'ride:update', event);
    if (REQUEST_LIST_CHANGES.includes(r.status)) emitRole('driver', 'ride:request', event);

    const payment = r.status === 'completed' ? await Payment.findOne({ ride: r._id, method: 'wallet' }).lean() : null;
    const text = PASSENGER_TEXT[r.status](r, payment);
    await notifyUser(r.user._id, text);

    const { emailUpdates, shareTrips } = r.user.preferences;
    if (emailUpdates && EMAIL_SUBJECT[r.status]) await sendMail(r.user.email, `SheRides: ${EMAIL_SUBJECT[r.status](r)}`, text);
    if (shareTrips && SHARED.includes(r.status)) {
      await mailContacts(r.user, `SheRides trip update for ${r.user.name}`, shareText(r));
    }
  } catch (err) {
    console.error('[rideChanged]', err);
  }
}
