// Auth, role checks and input validation shared by every route.
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) throw new Error('JWT_SECRET missing or too short — set it in .env');

export const signToken = (account, role) => jwt.sign({ sub: String(account._id), role }, SECRET, { expiresIn: '7d' });

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Returns { sub, role } for a valid token, otherwise null. Shared by HTTP and WebSocket auth.
export function verifyToken(token) {
  try {
    const claims = jwt.verify(token, SECRET);
    return typeof claims.sub === 'string' && typeof claims.role === 'string' ? claims : null;
  } catch {
    return null;
  }
}

// requireRole('admin') or requireRole('passenger', 'driver'). Reads `Authorization: Bearer <jwt>`.
export function requireRole(...roles) {
  return (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Sign in required'));
    const claims = verifyToken(token);
    if (!claims) return next(new HttpError(401, 'Session expired — sign in again'));
    if (!roles.includes(claims.role)) return next(new HttpError(403, 'Not allowed for this account type'));
    req.auth = { id: claims.sub, role: claims.role };
    next();
  };
}

// Tiny schema check at the API boundary: returns cleaned values or throws 400 with every problem.
// rules: { field: { required, type: 'string'|'email'|'phone'|'number', min, max, oneOf, pattern, range: [lo, hi] } }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+ ]{10,15}$/;
export function validate(body, rules) {
  const out = {};
  const errors = [];
  for (const [field, r] of Object.entries(rules)) {
    let v = body?.[field];
    if (typeof v === 'string') v = v.trim();
    if (v === undefined || v === null || v === '') {
      if (r.required) errors.push(`${field} is required`);
      continue;
    }
    if (r.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${field} must be a number`);
      else if (r.range && (v < r.range[0] || v > r.range[1])) errors.push(`${field} is out of range`);
      else out[field] = v;
      continue;
    }
    if (typeof v !== 'string') { errors.push(`${field} must be text`); continue; }
    if (r.min && v.length < r.min) errors.push(`${field} must be at least ${r.min} characters`);
    if (v.length > (r.max || 200)) errors.push(`${field} is too long`);
    if (r.type === 'email' && !EMAIL.test(v)) errors.push(`${field} must be a valid email`);
    if (r.type === 'phone' && !PHONE.test(v)) errors.push(`${field} must be a valid phone number`);
    if (r.pattern && !r.pattern.test(v)) errors.push(`${field} is invalid`);
    if (r.oneOf && !r.oneOf.includes(v)) errors.push(`${field} must be one of: ${r.oneOf.join(', ')}`);
    out[field] = r.type === 'email' ? v.toLowerCase() : v;
  }
  if (errors.length) throw new HttpError(400, errors.join('; '));
  return out;
}

// Last-stop error handler: known HttpErrors keep their status; duplicates become 409; the rest are 500s.
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
