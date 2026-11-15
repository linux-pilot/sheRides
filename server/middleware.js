// The API boundary: who may call a route, input validation and the error format.
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ACCOUNT_MODEL } from './models.js';

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) throw new Error('JWT_SECRET missing or too short — set it in .env');

export const signToken = (account, role) => jwt.sign({ sub: String(account._id), role }, SECRET, { expiresIn: '7d' });

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const BLOCKED_MESSAGE = 'This account is blocked. Contact support.';

// Returns { id, role } for a valid token, otherwise null. Shared by HTTP and WebSocket auth.
export function verifyToken(token) {
  try {
    const { sub, role } = jwt.verify(token, SECRET);
    return typeof sub === 'string' && typeof role === 'string' ? { id: sub, role } : null;
  } catch {
    return null;
  }
}

// `Authorization: Bearer <jwt>` → { id, role } if the role is one of `roles`, else throws 401/403. No DB access.
export function authorize(header, roles) {
  const [scheme, token] = (header || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Sign in required');
  const auth = verifyToken(token);
  if (!auth) throw new HttpError(401, 'Session expired — sign in again');
  if (!roles.includes(auth.role)) throw new HttpError(403, 'Not allowed for this account type');
  return auth;
}

// requireRole('admin'), requireRole('passenger', 'driver'), or with a trailing { blockedOk: true }.
// A token outlives changes to its account, so the account is re-checked on every request: a deleted account is signed out and
// a blocked one is refused, except on routes marked blockedOk — what safety needs (SOS, finishing a ride under way).
export function requireRole(...args) {
  const { blockedOk = false } = typeof args.at(-1) === 'object' ? args.pop() : {};
  return async (req, res, next) => {
    req.auth = authorize(req.headers.authorization, args);
    const account = await ACCOUNT_MODEL[req.auth.role].findById(req.auth.id).select('status').lean();
    if (!account) throw new HttpError(401, 'Account no longer exists');
    if (account.status === 'blocked' && !blockedOk) throw new HttpError(403, BLOCKED_MESSAGE);
    next();
  };
}

// 404 unless `value` is a valid document id.
export function idParam(value, what) {
  if (!mongoose.isValidObjectId(value)) throw new HttpError(404, `${what} not found`);
  return value;
}

// Tiny schema check: returns cleaned values or throws 400 listing every problem. `path` prefixes field names
// for nested objects ("pickup.lat is required").
// rules: { field: { required, type: 'string'|'email'|'phone'|'number'|'integer'|'boolean', min, max, oneOf, pattern, range: [lo, hi] } }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+ ]{10,15}$/;
export function validate(body, rules, path = '') {
  const out = {};
  const errors = [];
  for (const [key, r] of Object.entries(rules)) {
    const field = path + key;
    let v = body?.[key];
    if (typeof v === 'string') v = v.trim();
    if (v === undefined || v === null || v === '') {
      if (r.required) errors.push(`${field} is required`);
      continue;
    }
    if (r.type === 'boolean') {
      if (typeof v !== 'boolean') errors.push(`${field} must be true or false`);
      else out[key] = v;
      continue;
    }
    if (r.type === 'number' || r.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${field} must be a number`);
      else if (r.type === 'integer' && !Number.isInteger(v)) errors.push(`${field} must be a whole number`);
      else if (r.range && (v < r.range[0] || v > r.range[1])) errors.push(`${field} is out of range`);
      else out[key] = v;
      continue;
    }
    if (typeof v !== 'string') { errors.push(`${field} must be text`); continue; }
    if (r.min && v.length < r.min) errors.push(`${field} must be at least ${r.min} characters`);
    if (v.length > (r.max || 200)) errors.push(`${field} is too long`);
    if (r.type === 'email' && !EMAIL.test(v)) errors.push(`${field} must be a valid email`);
    if (r.type === 'phone' && !PHONE.test(v)) errors.push(`${field} must be a valid phone number`);
    if (r.pattern && !r.pattern.test(v)) errors.push(`${field} is invalid`);
    if (r.oneOf && !r.oneOf.includes(v)) errors.push(`${field} must be one of: ${r.oneOf.join(', ')}`);
    out[key] = r.type === 'email' ? v.toLowerCase() : v;
  }
  if (errors.length) throw new HttpError(400, errors.join('; '));
  return out;
}

// Account fields shared by registration, sign-in, profile edits and emergency contacts.
export const FIELD = {
  name: { max: 80 },
  email: { type: 'email', max: 120 },
  phone: { type: 'phone' },
};
export const required = (rule) => ({ ...rule, required: true });

export const POINT = {
  lat: { required: true, type: 'number', range: [-90, 90] },
  lng: { required: true, type: 'number', range: [-180, 180] },
};

// Known HttpErrors keep their status; duplicates become 409; the rest are 500s.
export function errorHandler(err, req, res, next) {
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ error: `That ${field} is already registered` });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
}
