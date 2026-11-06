// Small presentational building blocks shared by every page.
import { Component } from 'react';
import { Link } from 'react-router-dom';

export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const PATHS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h11v3M16 13.5h2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1',
  car: 'M5 16l1.5-5A2 2 0 0 1 8.4 9.5h7.2a2 2 0 0 1 1.9 1.5L19 16M3 16h18v3H3zM7 19v2M17 19v2',
  ticket: 'M3 9V6h18v3a3 3 0 0 0 0 6v3H3v-3a3 3 0 0 0 0-6z',
  chart: 'M4 20V10M10 20V4M16 20v-8M2 20h20',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  menu: 'M4 6h16M4 12h16M4 18h16',
  send: 'M4 12l16-8-6 16-3-7z',
  plus: 'M12 5v14M5 12h14',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
};

export function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ to = '/' }) {
  return (
    <Link to={to} className="logo">
      <span className="logo-mark"><Icon name="shield" size={18} /></span>
      SheRides
    </Link>
  );
}

export function Stat({ icon, label, value }) {
  return (
    <div className="card stat lift">
      <div className="stat-icon"><Icon name={icon} /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

export function Card({ title, action, children, className = '', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {title && <div className="card-title"><h3>{title}</h3>{action}</div>}
      {children}
    </section>
  );
}

const TONE = {
  completed: 'ok', approved: 'ok', active: 'ok', resolved: 'ok', success: 'ok', online: 'ok',
  pending: 'warn', open: 'warn', in_progress: 'warn', investigating: 'warn', driver_assigned: 'warn',
  cancelled: 'bad', rejected: 'bad', blocked: 'bad', deviation: 'bad', failed: 'bad', sos: 'bad',
  en_route: 'pink', otp_verified: 'pink', requested: 'pink', arrived: 'pink',
};
// "otp_verified" → "OTP verified", "in_progress" → "In progress" (sentence case; explicit labels shown as given).
const sentence = (v) => { const s = String(v).replace(/_/g, ' ').replace(/\botp\b/i, 'OTP'); return s[0].toUpperCase() + s.slice(1); };
export function Badge({ value, label }) {
  return <span className={`badge ${TONE[value] || ''}`}>{label || sentence(value)}</span>;
}

export function Toggle({ on, onChange, label }) {
  return <button type="button" className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Stars({ n }) {
  return <span className="pink" aria-label={`${n} of 5 stars`}>{'★'.repeat(n)}<span className="muted">{'★'.repeat(5 - n)}</span></span>;
}

// Clickable 1–5 star picker.
export function StarInput({ value, onChange }) {
  return (
    <div className="row" role="radiogroup" aria-label="Rating" style={{ gap: '.15rem' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className="star-btn" style={{ color: n <= value ? 'var(--pink)' : 'var(--muted)' }} onClick={() => onChange(n)}>★</button>
      ))}
    </div>
  );
}

// Shows a list or an empty / loading / error message.
export function Empty({ loading, error, children }) {
  if (error) return <div className="error" role="alert">{error}</div>;
  return <p className="muted" style={{ margin: 0 }}>{loading ? 'Loading…' : children}</p>;
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="topbar">
      <div><h1>{title}</h1>{sub && <p className="muted" style={{ margin: 0 }}>{sub}</p>}</div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}

export function Bars({ data, label, value }) {
  const max = Math.max(1, ...data.map(value)); // avoid 0/0 when every bar is zero
  return (
    <div className="bars" role="img" aria-label={data.map((d) => `${label(d)}: ${value(d)}`).join(', ')}>
      {data.map((d, i) => (
        <div key={label(d)}>
          <small>{value(d)}</small>
          <span style={{ height: `${(value(d) / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
          {label(d)}
        </div>
      ))}
    </div>
  );
}

// Catches a crash in part of the UI so the rest (sidebar, SOS) keeps working.
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[SheRides] page crashed:', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert" style={{ maxWidth: 520, margin: this.props.full ? '4rem auto' : '1rem 0' }}>
        <h3>Something went wrong on this page</h3>
        <p className="muted small">{this.props.full ? 'The app hit an unexpected error.' : 'The rest of SheRides still works — SOS is always available.'} Reloading usually fixes it.</p>
        <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
