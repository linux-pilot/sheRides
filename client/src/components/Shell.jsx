import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary, Icon, Logo } from './ui.jsx';
import { SosModal } from './SosModal.jsx';
import { getSession, signOut, useApi, useLive } from '../api.js';

const noCounts = () => ({});

// Live toasts. The server sends `notification` only to passengers, `sos:alert` only to admins, and
// `deviation:alert` to the ride's passenger and driver and to admins.
function Toasts({ role }) {
  const [items, setItems] = useState([]);
  const push = (t) => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), t.alert ? 12000 : 6000);
  };
  useLive(({ type, data }) => {
    if (type === 'notification') push({ text: data.message, alert: data.alert });
    // Passengers already get a deviation as a notification.
    if (type === 'deviation:alert' && role !== 'passenger') {
      push(data.deviated
        ? { alert: true, text: `Route alert: car is ${data.offM} m off the planned route.` }
        : { text: 'Back on the planned route.' });
    }
    if (type === 'sos:alert' && data.status === 'active') push({ alert: true, text: `SOS from ${data.name} (${data.raisedBy}). Open SOS alerts.` });
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

// Shared app layout for every role: sidebar (drawer on mobile) + app bar + page outlet.
// `Background`: an area's always-on component (e.g. the driver's GPS sender).
export function Shell({ role, base, menu, sos = false, useCounts = noCounts, Background }) {
  const [, rerender] = useState(0);
  useLive(({ type }) => { if (type === 'session:changed') rerender((n) => n + 1); });
  const user = getSession()?.name || role;
  const nav = useNavigate();
  const counts = useCounts();
  const [open, setOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  // An SOS still active after a reload or closed tab reopens the modal (it re-attaches, no new alert) so she can stand it down.
  const activeSos = useApi(sos ? '/sos/active' : null);
  useEffect(() => { if (activeSos.data) setSosOpen(true); }, [activeSos.data]);
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
      {Background && <Background />}
    </div>
  );
}
