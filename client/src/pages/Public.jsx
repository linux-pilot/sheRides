import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, Logo } from '../components/ui.jsx';
import { login, register, ROLE_HOME, uploadDocument, uploadError, useApi } from '../api.js';

function PublicNav() {
  return (
    <header className="public-nav">
      <Logo />
      <nav className="row">
        <Link to="/signin" className="btn btn-ghost btn-sm">Sign in</Link>
        <Link to="/signup" className="btn btn-primary btn-sm">Get started</Link>
      </nav>
    </header>
  );
}

const FEATURES = [
  { icon: 'users', title: 'Women-only, verified', text: 'Every passenger and driver is a verified woman. Drivers pass KYC and admin approval before their first trip.' },
  { icon: 'shield', title: 'Safety OTP', text: 'Your ride only starts when the driver enters the 6-digit OTP you share inside the car.' },
  { icon: 'route', title: 'Route deviation radar', text: 'If the car drifts 500 m off the planned route, you and our control room are alerted instantly.' },
  { icon: 'alert', title: 'One-tap SOS', text: 'Live location, driver and vehicle details go to your trusted contacts and our control room in one tap.' },
  { icon: 'clock', title: 'Night Guardian', text: 'Between 22:00 and 06:00, rides are geo-fenced and live-monitored by our safety team.' },
  { icon: 'chat', title: 'Masked chat & calls', text: 'Talk to your driver without ever sharing your real phone number.' },
];

export function Home() {
  const tiers = useApi('/tiers').data || []; // prices come from the server's single fare table
  return (
    <>
      <PublicNav />
      <section className="hero">
        <div>
          <span className="badge pink">For women, by women</span>
          <h1 style={{ marginTop: '1rem' }}>Rides where <span className="grad-text">safety</span> is the default setting.</h1>
          <p>SheRides connects verified women passengers with verified women drivers, with SOS, live trip sharing and route monitoring built into every trip.</p>
          <div className="row wrap hero-cta">
            <Link to="/signup" className="btn btn-primary">Book your first ride</Link>
            <Link to="/signup?role=driver" className="btn btn-ghost">Drive with SheRides</Link>
          </div>
        </div>
      </section>

      <section className="section cream">
        <h2>Safety, built into every kilometre</h2>
        <p className="muted">Not an add-on. Every SheRides trip ships with these safeguards switched on.</p>
        <div className="grid g3" style={{ marginTop: '1.5rem' }}>
          {FEATURES.map((f) => (
            <div className="card lift" key={f.title}>
              <div className="feature-icon"><Icon name={f.icon} /></div>
              <h3>{f.title}</h3>
              <p className="muted" style={{ margin: 0 }}>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Pick your ride</h2>
        <p className="muted">Simple fares in ₹: base fare + per km. No surge pricing.</p>
        <div className="grid g3" style={{ marginTop: '1.5rem' }}>
          {tiers.map((t) => (
            <div className="card lift" key={t.id}>
              <div className="feature-icon" style={{ background: 'var(--pink-soft)', color: 'var(--pink)' }}><Icon name={t.id === 'night' ? 'shield' : 'car'} /></div>
              <h3>{t.name}</h3>
              <p className="muted">{t.desc}</p>
              <div className="stat-value">₹{t.base} <span className="muted small">+ ₹{t.perKm}/km</span></div>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer muted small">
        <span>© 2026 SheRides</span>
        <span>Emergency? Call 112</span>
      </footer>
    </>
  );
}

function AuthLayout({ children, title, sub }) {
  return (
    <div className="auth-wrap">
      <div className="auth-side">
        <Logo />
        <div>
          <h1 style={{ fontSize: '2.6rem' }}>{title}</h1>
          <p style={{ fontSize: '1.05rem', opacity: .8 }}>{sub}</p>
        </div>
        <p className="small" style={{ opacity: .7 }}>Every account is verified. SheRides is open to women only.</p>
      </div>
      <div className="auth-form">{children}</div>
    </div>
  );
}

function RoleTabs({ roles, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {roles.map((r) => (
        <button type="button" role="tab" aria-selected={value === r} key={r} className={value === r ? 'active' : ''} onClick={() => onChange(r)}>{r}</button>
      ))}
    </div>
  );
}

export function SignIn() {
  const nav = useNavigate();
  const [role, setRole] = useState('passenger');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    setBusy(true);
    setError('');
    try {
      nav(ROLE_HOME[await login(role, form.get('email'), form.get('password'))]);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Welcome back." sub="Sign in to book, drive or keep SheRides safe.">
      <form onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="muted">Choose your account type.</p>
        <RoleTabs roles={['passenger', 'driver', 'admin', 'support']} value={role} onChange={(r) => { setRole(r); setError(''); }} />
        {error && <div className="error" role="alert">{error}</div>}
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" name="password" type="password" required autoComplete="current-password" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small" style={{ marginTop: '1rem', textAlign: 'center' }}>New here? <Link to="/signup">Get started</Link></p>
      </form>
    </AuthLayout>
  );
}

export function GetStarted() {
  const nav = useNavigate();
  const [role, setRole] = useState(new URLSearchParams(location.search).get('role') === 'driver' ? 'driver' : 'passenger');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const checkFile = (e) => {
    const problem = uploadError(e.target.files[0]);
    setError(problem);
    if (problem) e.target.value = '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target));
    if (form.gender !== 'female') {
      setError('SheRides is a women-only platform. We are unable to create this account.');
      return;
    }
    const { licensePhoto, ...fields } = form;
    setBusy(true);
    setError('');
    try {
      await register(role, fields);
    } catch (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    if (role === 'driver') {
      // Account exists now; if the licence upload fails, the KYC page lets her retry.
      if (licensePhoto?.size) await uploadDocument('Driving licence', licensePhoto).catch(() => {});
      nav('/driver/profile');
    } else nav(ROLE_HOME[role]);
  };

  return (
    <AuthLayout title="Join SheRides." sub={role === 'driver' ? 'Drive with flexible hours and passengers you can trust.' : 'Safe rides, verified drivers, trusted contacts in the loop.'}>
      <form onSubmit={submit}>
        <h2>Create account</h2>
        <RoleTabs roles={['passenger', 'driver']} value={role} onChange={(r) => { setRole(r); setError(''); }} />
        {error && <div className="error" role="alert">{error}</div>}
        <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" required /></div>
        <div className="grid g2" style={{ gap: '.75rem' }}>
          <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /></div>
          <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" type="tel" required pattern="[0-9+ ]{10,15}" /></div>
        </div>
        <div className="field">
          <label htmlFor="gender">Gender</label>
          <select id="gender" name="gender" required defaultValue="">
            <option value="" disabled>Select</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </div>
        {role === 'driver' && (
          <>
            <div className="grid g2" style={{ gap: '.75rem' }}>
              <div className="field"><label htmlFor="lic">Licence number</label><input id="lic" name="licenseNumber" required /></div>
              <div className="field"><label htmlFor="plate">Vehicle plate</label><input id="plate" name="vehiclePlate" required placeholder="KA 01 AB 1234" /></div>
            </div>
            <div className="field"><label htmlFor="model">Vehicle model</label><input id="model" name="vehicleModel" required /></div>
            <div className="field"><label htmlFor="licPhoto">Licence photo (JPG/PNG/PDF, max 2 MB)</label><input id="licPhoto" name="licensePhoto" type="file" accept=".jpg,.jpeg,.png,.pdf" required onChange={checkFile} /></div>
            <p className="muted small">Your documents are reviewed by our admin team before you can go online.</p>
          </>
        )}
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p className="muted small" style={{ marginTop: '1rem', textAlign: 'center' }}>Already have an account? <Link to="/signin">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}
