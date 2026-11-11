import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary, Icon, Logo } from './ui.jsx';
import { SosModal } from './SosModal.jsx';
import { getSession, gps, liveSend, signOut, useLive } from '../api.js';

const noCounts = () => ({});

// Live toasts: notifications for passengers, route-deviation and SOS alerts for everyone who should see them.
function Toasts({ role }) {
  const [items, setItems] = useState([]);
  const push = (t) => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), t.alert ? 12000 : 6000);
  };
  useLive(({ type, data }) => {
    // Passengers get every alert as a notification (deviation included), so one toast each.
    if (type === 'notification' && role === 'passenger') push({ text: data.message, alert: data.alert });
    if (type === 'deviation:alert' && role !== 'passenger') {
      push(data.deviated
        ? { alert: true, text: `Route alert: car is ${data.offM} m off the planned route.` }
        : { text: 'Back on the planned route.' });
    }
    if (type === 'sos:alert' && role === 'admin' && data.status === 'active' && data.name) push({ alert: true, text: `SOS from ${data.name} (${data.raisedBy}). Open SOS alerts.` });
  });
  return (
    <div className="toasts" aria-live="assertive">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.alert ? 'alert' : ''}`} role={t.alert ? 'alert' : 'status'}>
          <Icon name={t.alert ? 'alert' : 'bell'} />
          <span className="grow">{t.text}</span>
          <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// Drivers share their real GPS position (every 5 s) while signed in; paused while the demo simulator drives.
function DriverGps() {
  useEffect(() => {
    if (!navigator.geolocation) return undefined;
    let last = 0;
    const watch = navigator.geolocation.watchPosition((p) => {
      if (gps.simulating || Date.now() - last < 5000) return;
      last = Date.now();
      liveSend('driver:location', { lat: p.coords.latitude, lng: p.coords.longitude });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, []);
  return null;
}

// Shared app layout for every role: sidebar (drawer on mobile) + app bar + animated page outlet.
export function Shell({ role, base, menu, sos = false, useCounts = noCounts }) {
  const [, rerender] = useState(0);
  useLive(({ type }) => { if (type === 'session:changed') rerender((n) => n + 1); });
  const user = getSession()?.name || role;
  const nav = useNavigate();
  const counts = useCounts();
  const [open, setOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sosButton = (cls) => sos && (
    <button className={cls} onClick={() => setSosOpen(true)} aria-label="Send SOS emergency alert">SOS</button>
  );

  return (
    <div className="shell">
      <aside id="sidebar" className={`sidebar ${open ? 'open' : ''}`}>
        <div className="row spread">
          <Logo to={base} />
          <button className="icon-btn drawer-close" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="x" /></button>
        </div>
        <div className="role-chip">{role}</div>
        <nav className="nav">
          {menu.map((m) => {
            const badge = m.count && counts[m.count];
            return (
              <NavLink key={m.to} to={m.to ? `${base}/${m.to}` : base} end>
                <Icon name={m.icon} /> {m.label}
                {badge ? <span className="count">{badge}</span> : null}
              </NavLink>
            );
          })}
          <Link to="/" onClick={(e) => { e.preventDefault(); if (!window.confirm('Sign out of SheRides?')) return; signOut(); nav('/', { replace: true }); }}><Icon name="logout" /> Sign out</Link>
        </nav>
        {sosButton('sos-btn')}
      </aside>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />

      <main className="main">
        <header className="appbar">
          <button className="icon-btn menu-toggle" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="sidebar"><Icon name="menu" /></button>
          <span className="appbar-logo"><Logo to={base} /></span>
          <span className="grow" />
          <div className="row small"><div className="avatar">{user[0]}</div><span className="hide-sm">{user}</span></div>
        </header>
        <div key={pathname} className="page"><ErrorBoundary><Outlet /></ErrorBoundary></div>
      </main>

      {sosButton('sos-fab')}
      {sosOpen && <SosModal role={role} onClose={() => setSosOpen(false)} />}
      <Toasts role={role} />
      {role === 'driver' && <DriverGps />}
    </div>
  );
}
