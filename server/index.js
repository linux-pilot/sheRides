// SheRides API: Express + MongoDB + WebSocket (/ws) on one HTTP server.
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { errorHandler } from './middleware.js';
import { attachRealtime } from './realtime.js';
import { handleLive } from './tracking.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import rideRoutes from './routes/rides.js';
import safetyRoutes from './routes/safety.js';
import supportRoutes from './routes/support.js';

const { MONGO_URL, CLIENT_ORIGIN = 'http://localhost:3000', PORT = 5000 } = process.env;
// Comma-separated: the site's own address plus e.g. http://192.168.1.67:3000 to test from a phone on the same Wi-Fi.
const ORIGINS = CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'up' : 'down' }));
for (const r of [authRoutes, accountRoutes, driverRoutes, adminRoutes, rideRoutes, safetyRoutes, supportRoutes]) app.use(r);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

await mongoose.connect(MONGO_URL);
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes())); // keep unique/partial indexes in step with models.js
console.log('Mongo connected');

const server = http.createServer(app);
attachRealtime(server, { origins: ORIGINS, onMessage: handleLive });
server.listen(PORT, () => console.log(`API + WebSocket listening on :${PORT}`));
