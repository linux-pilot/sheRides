// Values the server also defines (server/rideRules.js, models.js, uploads.js, routes/support.js). The client is a
// separate bundle, so a change there must be copied here. Prices and safety thresholds come from the API instead.

export const RIDE_STATES = ['requested', 'driver_assigned', 'otp_verified', 'en_route', 'arrived', 'completed'];
export const STATE_LABEL = {
  requested: 'Finding a driver',
  driver_assigned: 'Driver assigned',
  otp_verified: 'Safety OTP verified',
  en_route: 'On the way',
  arrived: 'Arrived at destination',
  completed: 'Trip completed',
  cancelled: 'Cancelled',
};
// Before the driver enters the OTP: the passenger sees her code and may still cancel.
export const OTP_PENDING = ['requested', 'driver_assigned'];
// Route deviation is checked in these states.
export const MONITORED = ['otp_verified', 'en_route'];
export const PAST = ['completed', 'cancelled'];
// After OTP verification the driver moves the trip forward one step at a time.
export const NEXT_STATUS = { otp_verified: 'en_route', en_route: 'arrived', arrived: 'completed' };
export const REVIEW_FILTERS = ['pending', 'approved', 'rejected', 'all'];
export const TICKET_STATUS = ['open', 'in_progress', 'resolved'];
export const COMPLAINT_STATUS = ['open', 'investigating', 'resolved'];

// `night` is a retired tier: it can no longer be booked, the name is kept so old ride history still reads correctly.
export const TIER_NAME = { lite: 'SheRides Lite', prime: 'SheRides Prime', night: 'Night Guardian' };
export const TICKET_CATEGORIES = ['Payment', 'Ride', 'Safety', 'KYC', 'Lost & found', 'App issue', 'Other'];
export const KYC_TYPES = ['Driving licence', 'Vehicle RC', 'Aadhaar (KYC)', 'Insurance'];
export const MAX_CONTACTS = 5;
export const MAX_PLACES = 10;
export const PHONE_PATTERN = '[0-9+ ]{10,15}';

// KYC uploads: same limits the server enforces (it re-checks by file content).
export const UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.pdf';
export const UPLOAD_HINT = 'JPG/PNG/PDF, max 2 MB';
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const uploadError = (file) =>
  file && (!UPLOAD_TYPES.includes(file.type) || file.size > 2 * 1024 * 1024) ? 'Upload a JPG, PNG or PDF of 2 MB or less.' : '';
