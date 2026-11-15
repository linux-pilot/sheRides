// Talking to the SheRides API (HTTP + live WebSocket) and remembering who is signed in.
import { useCallback, useEffect, useRef, useState } from 'react';

// Default (VITE_API_URL empty): this site's own /api path, forwarded by Vite with the WebSocket, so localhost, a phone
// on the Wi-Fi and HTTPS addresses all work the same, with no CORS and no https page calling an http API.
const API = import.meta.env.VITE_API_URL || `${location.origin}/api`;
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
  disconnect();
  if (!inAppArea()) return;
  const s = getSession();
  location.assign(s ? ROLE_HOME[s.role] : '/signin');
});

export async function request(path, { method = 'GET', body } = {}) {
  const session = getSession();
  const form = body instanceof FormData; // sets its own multipart Content-Type
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: form ? body : body ? JSON.stringify(body) : undefined,
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
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

const startSession = ({ token, role, user }) => {
  disconnect();
  saveSession({ token, role, id: user._id, name: user.name });
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
  if (socket && socket.token !== session?.token) disconnect(); // never reuse another account's socket
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

// Broadcast a local event to useLive/useApi subscribers (e.g. after marking notifications read).
export const localEmit = (type, data) => dispatch({ type, data });

export function setSessionName(name) {
  const s = getSession();
  if (!s || !name || s.name === name) return;
  saveSession({ ...s, name });
  dispatch({ type: 'session:changed' });
}

export function liveSend(type, data) {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type, data }));
}

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
  useLive(({ type }) => { if (path && (type === 'ws:open' || on.includes(type))) reload(); });
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

// One async action with a busy flag and an { error, ok } message. run(fn, okText) resolves to fn's result
// (true if it returned nothing), or false if it threw.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const run = useCallback(async (fn, ok = '') => {
    setBusy(true);
    setMsg({ error: '', ok: '' });
    try {
      const result = await fn();
      setMsg({ error: '', ok });
      return result ?? true;
    } catch (err) {
      setMsg({ error: err.message, ok: '' });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, msg, setMsg };
}

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
