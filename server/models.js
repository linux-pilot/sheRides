// Mongoose models, mapped 1:1 from the report's data dictionary.
// NoSQL embedding replaces the report's join tables: saved addresses, emergency contacts and
// ride cancellation live inside their parent document. Ride history is a query, not a table.
import mongoose from 'mongoose';
import { ACTIVE_STATUSES, DRIVER_BUSY_STATUSES, TIER_IDS } from './rideRules.js';

const { Schema, model } = mongoose;
const ref = (name, required = false) => ({ type: Schema.Types.ObjectId, ref: name, required });
const opts = { timestamps: true };
const point = { lat: Number, lng: Number };

// Passwords are bcrypt hashes and never leave the DB unless a query asks for them (`+password`).
const password = { type: String, required: true, select: false };
const email = { type: String, required: true, unique: true, lowercase: true, trim: true };

export const ROLES = ['passenger', 'driver', 'admin', 'support'];
export const RIDE_STATUS = ['requested', 'driver_assigned', 'otp_verified', 'en_route', 'arrived', 'completed', 'cancelled'];

export const Admin = model('Admin', new Schema({
  name: { type: String, required: true },
  email,
  password,
  phone: String,
  role: { type: String, default: 'admin' },
}, opts), 'admins');

export const User = model('User', new Schema({
  name: { type: String, required: true },
  email,
  password,
  phone: { type: String, required: true },
  gender: { type: String, enum: ['female'], required: true },
  profilePhoto: String,
  walletBalance: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  emergencyContacts: [{ name: String, email: String, phone: String, relation: String }],
  savedAddresses: [{ label: String, address: String, ...point }],
  // Beyond the report: sharing preferences (Settings page). Alerts go out by email (SMTP).
  preferences: {
    shareTrips: { type: Boolean, default: true },
    emailUpdates: { type: Boolean, default: true },
  },
}, opts), 'users');

// One spelling per plate so the unique index catches "KA01MX4821" vs "ka 01 mx 4821":
// uppercase, spaces only between letter/digit groups → "KA 01 MX 4821".
export const canonicalPlate = (v) => (typeof v === 'string'
  ? v.replace(/\s+/g, '').toUpperCase().replace(/([A-Z])(?=\d)/g, '$1 ').replace(/(\d)(?=[A-Z])/g, '$1 ')
  : v);

export const Driver = model('Driver', new Schema({
  name: { type: String, required: true },
  email,
  password,
  phone: { type: String, required: true },
  licenseNumber: { type: String, required: true },
  licensePhoto: String,
  vehicleModel: { type: String, required: true },
  vehiclePlate: { type: String, required: true, unique: true, set: canonicalPlate },
  verificationStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  availability: { type: String, enum: ['online', 'offline'], default: 'offline' },
  walletBalance: { type: Number, default: 0, min: 0 },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  documents: [{ type: { type: String }, path: String, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' } }],
  location: point,
}, opts), 'drivers');

// Beyond the report's columns: `tier` (fare tier booked), `km`, `otpAttempts` (brute-force cap)
// and `declinedBy` (drivers who skipped the request). Needed for booking, safety and matching.
const rideSchema = new Schema({
  user: ref('User', true),
  driver: ref('Driver'),
  pickup: { address: String, ...point },
  drop: { address: String, ...point },
  tier: { type: String, enum: TIER_IDS, required: true },
  km: Number, // road distance (OSRM), straight line only if routing was unavailable
  durationMin: Number, // estimated drive time
  route: { type: [[Number]], default: undefined }, // planned road path [[lat, lng], …]: drawn on maps, used for deviation
  fare: Number,
  otp: { type: String, match: /^\d{6}$/, select: false },
  otpAttempts: { type: Number, default: 0, select: false },
  declinedBy: { type: [ref('Driver')], select: false },
  acceptedAt: Date, // for the passenger's average wait
  deviated: { type: Boolean, default: false }, // driver currently > DEVIATION_M off the planned route
  status: { type: String, enum: RIDE_STATUS, default: 'requested', index: true },
  startTime: Date,
  endTime: Date,
  cancel: { by: { type: String, enum: ['passenger', 'driver', 'admin'] }, reason: String, at: Date },
}, opts);
rideSchema.index({ user: 1 }).index({ driver: 1 });
// The database itself guarantees one active ride per passenger and per driver, even under races.
rideSchema.index({ user: 1 }, { name: 'one_active_ride_per_user', unique: true, partialFilterExpression: { status: { $in: ACTIVE_STATUSES } } });
rideSchema.index({ driver: 1 }, { name: 'one_active_ride_per_driver', unique: true, partialFilterExpression: { status: { $in: DRIVER_BUSY_STATUSES } } });
export const Ride = model('Ride', rideSchema, 'rides');

export const SosAlert = model('SosAlert', new Schema({
  ride: ref('Ride'),
  user: ref('User'), // passenger involved (a driver can raise SOS too)
  raisedBy: { type: String, enum: ['passenger', 'driver'], required: true },
  driver: ref('Driver'),
  location: point,
  status: { type: String, enum: ['active', 'resolved'], default: 'active' },
  triggeredAt: { type: Date, default: Date.now },
  resolvedAt: Date,
}, opts)
  // At most one active SOS per passenger and per driver (repeat taps return the same alert).
  .index({ user: 1, raisedBy: 1 }, { unique: true, partialFilterExpression: { status: 'active', raisedBy: 'passenger' } })
  .index({ driver: 1, raisedBy: 1 }, { unique: true, partialFilterExpression: { status: 'active', raisedBy: 'driver' } }), 'sosalerts');

export const Notification = model('Notification', new Schema({
  user: ref('User', true),
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false },
}, opts).index({ user: 1, createdAt: -1 }), 'notifications');

export const SupportTeam = model('SupportTeam', new Schema({
  name: { type: String, required: true },
  email,
  password,
}, opts), 'supportteam');

export const SupportTicket = model('SupportTicket', new Schema({
  user: ref('User'),
  driver: ref('Driver'),
  assignedTo: ref('SupportTeam'),
  subject: { type: String, required: true },
  category: String,
  message: { type: String, required: true },
  response: String,
  status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
}, opts), 'supporttickets');

export const Rating = model('Rating', new Schema({
  ride: ref('Ride', true),
  ratedBy: { type: String, enum: ['passenger', 'driver'], required: true },
  stars: { type: Number, min: 1, max: 5, required: true },
  feedback: String,
}, opts).index({ ride: 1, ratedBy: 1 }, { unique: true }), 'ratings');

export const RideMessage = model('RideMessage', new Schema({
  ride: ref('Ride', true),
  sender: { type: String, enum: ['passenger', 'driver'], required: true },
  message: { type: String, required: true, maxlength: 500 },
  sentAt: { type: Date, default: Date.now },
}, opts), 'ridemessages');

export const Complaint = model('Complaint', new Schema({
  ride: ref('Ride', true),
  raisedBy: { type: String, enum: ['passenger', 'driver'], required: true },
  description: { type: String, required: true },
  resolutionNotes: String,
  status: { type: String, enum: ['open', 'investigating', 'resolved'], default: 'open' },
}, opts), 'complaints');

export const Payment = model('Payment', new Schema({
  user: ref('User', true),
  ride: ref('Ride'),
  amount: { type: Number, required: true },
  method: { type: String, enum: ['wallet', 'topup'], required: true },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
}, opts), 'payments');

// Which collection holds the accounts for each login role.
export const ACCOUNT_MODEL = { passenger: User, driver: Driver, admin: Admin, support: SupportTeam };
