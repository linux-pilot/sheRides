// WebSocket hub on /ws. Clients connect with ?token=<JWT>; each socket is filed under role + account id.
// Server → client events: ride:update, ride:request, driver:location, deviation:alert, chat:message,
// sos:alert, notification. Client → server: driver:location, sos:location (handled in tracking.js).
import { WebSocketServer } from 'ws';
import { verifyToken } from './middleware.js';

const sockets = new Map(); // "role:id" → Set<WebSocket>
const key = (role, id) => `${role}:${id}`;
const send = (ws, type, data) => ws.readyState === 1 && ws.send(JSON.stringify({ type, data }));

export function emit(role, id, type, data) {
  if (!id) return;
  for (const ws of sockets.get(key(role, String(id))) || []) send(ws, type, data);
}
export function emitRole(role, type, data) {
  for (const [k, set] of sockets) if (k.startsWith(`${role}:`)) for (const ws of set) send(ws, type, data);
}

// Blocks other websites from opening a socket with a stolen token. Allowed: no Origin (non-browser clients),
// a configured site, or the same address the request was sent to (the site's own /api proxy keeps the Host header).
function originAllowed(req, origins) {
  const { origin, host } = req.headers;
  if (!origin || origins.includes(origin)) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

// `types`: the client → server message types onMessage handles; anything else is ignored.
export function attachRealtime(server, { origins, onMessage, types }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

  wss.on('connection', (ws, req) => {
    // First, before any early return: `ws` emits 'error' for an oversized or malformed frame (and closes that socket
    // itself). With no listener that event is an uncaught exception, so one bad frame would take the whole API down.
    ws.on('error', () => {});
    // ponytail: token travels in the URL (fine on localhost). Upgrade: short-lived ticket or cookie auth.
    const claims = verifyToken(new URL(req.url, 'http://x').searchParams.get('token'));
    if (!claims || !originAllowed(req, origins)) return ws.close(4401, 'Unauthorized');

    const k = key(claims.role, claims.sub);
    if (!sockets.has(k)) sockets.set(k, new Set());
    sockets.get(k).add(ws);
    ws.auth = { id: claims.sub, role: claims.role };
    ws.alive = true;
    ws.lastMsg = new Map(); // type → time of the last accepted message

    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || !types.includes(msg.type)) return;
      // Flood guard per message type (max ~4/second each), so a driver's GPS ping never drops her SOS location.
      const now = Date.now();
      if (now - (ws.lastMsg.get(msg.type) || 0) < 250) return;
      ws.lastMsg.set(msg.type, now);
      try {
        await onMessage(ws.auth, msg.type, msg.data);
      } catch (err) {
        send(ws, 'error', { message: err.status ? err.message : 'Something went wrong' });
        if (!err.status) console.error(err);
      }
    });
    ws.on('close', () => {
      sockets.get(k)?.delete(ws);
      if (!sockets.get(k)?.size) sockets.delete(k);
    });
  });

  // Drop dead connections every 30 s.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(timer));
}
