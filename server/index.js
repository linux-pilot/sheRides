// SheRides API: Express + MongoDB + WebSocket (/ws) on one HTTP server.
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { errorHandler, requireRole } from './middleware.js';
import { attachRealtime } from './realtime.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import driverRoutes from './routes/drivers.js';
import reportRoutes from './routes/reports.js';
import rideRoutes, { driverLocation } from './routes/rides.js';
import safetyRoutes, { sosLocation } from './routes/safety.js';
import supportRoutes from './routes/support.js';

const { MONGO_URL, CLIENT_ORIGIN = 'http://localhost:3000', PORT = 5000 } = process.env;
// Comma-separated: the site's own address plus e.g. http://192.168.1.67:3000 to test from a phone on the same Wi-Fi.
const ORIGINS = CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // req.ip = the visitor's address as reported by the site's /api proxy (one hop)
app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: '100kb' }));

// dbName lets e2e.mjs refuse to run against a stack that is not on a qa/e2e database.
app.get('/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'up' : 'down', dbName: mongoose.connection.name }));
for (const r of [authRoutes, accountRoutes, driverRoutes, reportRoutes, rideRoutes, safetyRoutes, supportRoutes]) app.use(r);
app.use('/admin', requireRole('admin')); // unknown admin paths: non-admins get 401/403, never a hint of what exists
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

await mongoose.connect(MONGO_URL);
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes())); // unique/partial indexes follow models.js
console.log('Mongo connected');

const server = http.createServer(app);
attachRealtime(server, { origins: ORIGINS, handlers: { 'driver:location': driverLocation, 'sos:location': sosLocation } });
server.listen(PORT, () => console.log(`API + WebSocket listening on :${PORT}`));
