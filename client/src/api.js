// One place for talking to the SheRides API and remembering who is signed in.
import { useCallback, useEffect, useRef, useState } from 'react';

// Opened from another device on the same Wi-Fi (e.g. http://192.168.1.67:3000 on a phone), "localhost" would mean
// that device itself, so a localhost API address is pointed at the host this page came from instead.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const API = (() => {
  // Default (VITE_API_URL empty): the API is this site's own /api path, forwarded by Vite (WebSocket included), so
  // localhost, a phone on the Wi-Fi, OrbStack and the Caddy HTTPS proxy all work the same, with no CORS and no
  // https page calling an http API. Below: only when VITE_API_URL points at a separately hosted API.
  if (!import.meta.env.VITE_API_URL) return `${location.origin}/api`;
  const url = new URL(import.meta.env.VITE_API_URL);
  if (LOCAL.includes(url.hostname) && !LOCAL.includes(location.hostname)) {
    // OrbStack HTTPS: https://client.<project>.orb.local → API at https://server.<project>.orb.local (an https page
    // may only call an https API).
    if (location.hostname.endsWith('.orb.local')) return `${location.protocol}//${location.hostname.replace(/^client\./, 'server.')}`;
    url.hostname = location.hostname;
  }
  return url.origin;
})();
const KEY = 'sherides.session';

export const ROLE_HOME = { passenger: '/app', driver: '/driver', admin: '/admin', support: '/support' };

// ponytail: JWT kept in localStorage for the demo. Upgrade: httpOnly cookie set by the server.
export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
const saveSession = (s) => localStorage.setItem(KEY, JSON.stringify(s));
export const signOut = () => { localStorage.removeItem(KEY); disconnect(); };

const inAppArea = () => Object.values(ROLE_HOME).some((b) => location.pathname === b || location.pathname.startsWith(`${b}/`));

// The session is shared by every tab. If another tab signs in as someone else (or signs out), an open app
// page here must not keep showing one account while acting as another (e.g. SOS sent as the wrong person).
window.addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return;
  const token = (v) => { try { return JSON.parse(v)?.token; } catch { return undefined; } };
  if (e.key === KEY && token(e.oldValue) === token(e.newValue)) return; // same account (e.g. name edit)
  if (!inAppArea()) return;
  disconnect();
  const s = getSession();
  location.assign(s ? ROLE_HOME[s.role] : '/signin');
});

export async function request(path, { method = 'GET', body } = {}) {
  const session = getSession();
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        // FormData (file uploads) sets its own multipart Content-Type.
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the SheRides server. Is it running?');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session && !path.startsWith('/auth/')) {
    // Stale or expired token: leave the app for sign-in instead of showing errors on every page.
    // Not for SOS: its modal must stay up and tell her to call 112.
    signOut();
    if (inAppArea() && !path.startsWith('/sos')) location.assign('/signin');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const startSession = ({ token, role, user }) => {
  disconnect(); // drop any socket from a previous account
  saveSession({ token, role, name: user.name });
  return role;
};

export const login = (role, email, password) =>
  request(`/auth/login/${role}`, { method: 'POST', body: { email, password } }).then(startSession);

export const register = (role, fields) =>
  request(`/auth/register/${role}`, { method: 'POST', body: fields }).then(startSession);

// ---- Live updates over WebSocket (one shared connection per signed-in tab) ----
let socket = null;
let retry = 0;
let retryTimer = null;
const listeners = new Set();
const dispatch = (msg) => listeners.forEach((fn) => fn(msg));

function connect() {
  const session = getSession();
  if (socket && socket.token !== session?.token) disconnect(); // account changed: never reuse another account's socket
  if (!session || socket) return;
  clearTimeout(retryTimer);
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(session.token)}`);
  ws.token = session.token;
  socket = ws;
  ws.onopen = () => { retry = 0; dispatch({ type: 'ws:open' }); };
  ws.onmessage = (e) => { try { dispatch(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    if (e.code === 4401 || !getSession() || !listeners.size) return;
    retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++)); // back off: 1s, 2s, 4s … 30s
  };
}
function disconnect() {
  clearTimeout(retryTimer);
  const ws = socket;
  socket = null;
  ws?.close();
}

// Set while the driver demo simulator is moving the car, so real GPS doesn't fight it.
export const gps = { simulating: false };

// Broadcast a local event to useLive/useApi subscribers (e.g. after marking notifications read).
export const localEmit = (type, data) => dispatch({ type, data });

// Keep the signed-in name (shown in the app bar) in step after a profile edit.
export function setSessionName(name) {
  const s = getSession();
  if (!s || !name || s.name === name) return;
  saveSession({ ...s, name });
  dispatch({ type: 'session:changed' });
}

// Re-check the live connection against the current session (cheap; called on protected route render).
export function syncLive() {
  if (socket && socket.token !== getSession()?.token) { disconnect(); if (listeners.size) connect(); }
}

export function liveSend(type, data) {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type, data }));
}

// Subscribe a component to server events: handler({ type, data }).
export function useLive(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (msg) => ref.current(msg);
    listeners.add(fn);
    connect();
    return () => { listeners.delete(fn); };
  }, []);
}

// Load one API resource in a component: { data, error, loading, reload, setData }.
// `path` null = idle. `on`: event types that trigger a quiet re-fetch (plus every reconnect).
export function useApi(path, { on = [] } = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: !!path });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const events = on.join(',');
  useLive(({ type }) => { if (path && (type === 'ws:open' || events.split(',').includes(type))) reload(); });
  useEffect(() => {
    if (!path) { setState({ data: null, error: '', loading: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    request(path)
      .then((data) => live && setState({ data, error: '', loading: false }))
      .catch((err) => live && setState((s) => ({ ...s, error: err.message, loading: false })));
    return () => { live = false; };
  }, [path, nonce]);
  const setData = useCallback((data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })), []);
  return { ...state, reload, setData };
}

// Runs one async action at a time: a double click or double Enter is ignored instead of submitting twice.
// (A `disabled` flag alone is too late: both clicks can land before React re-renders.)
export function useOnce() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    try { return await fn(); } finally { lock.current = false; setBusy(false); }
  }, []);
  return [run, busy];
}

// Browser location once, or null after `ms`. The hard timer matters: the geolocation `timeout` does not
// count time spent on an unanswered permission prompt, and SOS must never wait on that.
export const currentPosition = (ms = 3000) => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  setTimeout(() => resolve(null), ms);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: ms, maximumAge: 30000 },
  );
});

// Address → coordinates with OpenStreetMap's free Nominatim service (light use only, no key).
// The typed address is sent to OSM; nothing else about the user is.
export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&accept-language=en&q=${encodeURIComponent(query)}`;
  let hits;
  try {
    hits = await fetch(url).then((r) => r.json());
  } catch {
    throw new Error('Address lookup is unavailable right now. Try again.');
  }
  if (!hits?.length) throw new Error(`Couldn't find "${query}". Try adding the area or city.`);
  return { address: query, lat: Number(hits[0].lat), lng: Number(hits[0].lon) };
}


// KYC uploads: same limits the server enforces (it re-checks by file content).
export const KYC_TYPES = ['Driving licence', 'Vehicle RC', 'Aadhaar (KYC)', 'Insurance'];
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const uploadError = (file) =>
  file && (!UPLOAD_TYPES.includes(file.type) || file.size > 2 * 1024 * 1024) ? 'Upload a JPG, PNG or PDF of 2 MB or less.' : '';

export function uploadDocument(type, file) {
  const form = new FormData();
  form.append('type', type);
  form.append('file', file);
  return request('/driver/documents', { method: 'POST', body: form });
}

// Private files need the auth header, so fetch them and open a temporary blob URL.
export async function openFile(name) {
  const tab = window.open('', '_blank'); // open synchronously so popup blockers allow it
  try {
    const res = await fetch(`${API}/files/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${getSession()?.token}` } });
    if (!res.ok) throw new Error('Could not open file');
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location = url; else window.location = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    alert(err.message);
  }
}

export const fmtDate = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const TIER_NAME = { lite: 'SheRides Lite', prime: 'SheRides Prime', night: 'Night Guardian' };
export const TICKET_CATEGORIES = ['Payment', 'Ride', 'Safety', 'KYC', 'Lost & found', 'App issue', 'Other'];
