import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Bars, Card, Empty, Icon, inr, PageHead, Stars, Stat, Toggle } from '../components/ui.jsx';
import { MapView } from '../components/MapView.jsx';
import { Messages } from '../components/Chat.jsx';
import { SupportTickets } from './Passenger.jsx';
import {
  fmtDate, gps, KYC_TYPES, liveSend, openFile, request, TIER_NAME, uploadDocument, uploadError, useApi, useLive, useOnce,
} from '../api.js';
import { RIDE_STATES, STATE_LABEL } from '../constants.js';

const STATUS_NOTE = {
  pending: 'Your documents are under review. You can go online once an admin approves your account.',
  rejected: 'Your verification was rejected. Re-upload clear documents to be reviewed again.',
};
const RIDE_EVENTS = ['ride:update'];
const tripMarkers = (r, car) => [
  { pos: [r.pickup.lat, r.pickup.lng], kind: 'pickup', label: `Pickup: ${r.pickup.address}` },
  { pos: [r.drop.lat, r.drop.lng], kind: 'drop', label: `Drop: ${r.drop.address}` },
  ...(car ? [{ pos: [car.lat, car.lng], kind: car.deviated ? 'sos' : 'car', label: 'You' }] : []),
];

function Dashboard() {
  const nav = useNavigate();
  const me = useApi('/me', { on: ['driver:update'] }); // admin approvals arrive live
  const user = me.data?.user;
  const online = user?.availability === 'online';
  const approved = user?.verificationStatus === 'approved';
  const current = useApi('/rides/active', { on: RIDE_EVENTS });
  const earnings = useApi('/driver/earnings', { on: RIDE_EVENTS });
  // Requests refresh live (WebSocket `ride:request`) while online, approved and free.
  const requests = useApi(online && approved && !current.data ? '/driver/requests' : null, { on: ['ride:request'] });
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [once] = useOnce();

  const setOnline = async (on) => {
    setError('');
    try {
      const { availability } = await request('/driver/availability', { method: 'PUT', body: { availability: on ? 'online' : 'offline' } });
      me.setData((d) => ({ ...d, user: { ...d.user, availability } }));
    } catch (err) {
      setError(err.message);
    }
  };
  const respond = (ride, action) => once(() => doRespond(ride, action));
  const doRespond = async (ride, action) => {
    setError('');
    setBusyId(ride._id);
    try {
      await request(`/driver/rides/${ride._id}/${action}`, { method: 'POST' });
      if (action === 'accept') { nav('/driver/trip'); return; }
      requests.setData((list) => list.filter((r) => r._id !== ride._id));
    } catch (err) {
      setError(err.message);
      requests.reload();
    }
    setBusyId(null);
  };

  const e = earnings.data;
  return (
    <>
      <PageHead title={`Hi, ${(user?.name || 'there').split(' ')[0]}`} sub={!user ? 'Loading…' : online ? 'You are online and visible to passengers' : 'You are offline'}>
        {user && <><span className="small">{online ? 'Online' : 'Offline'}</span><Toggle on={online} onChange={setOnline} label="Online status" /></>}
      </PageHead>
      {(me.error || error) && <div className="error" role="alert">{me.error || error}</div>}
      {user && !approved && (
        <div className="card row alert-card" style={{ marginBottom: '1.1rem', borderColor: 'var(--warn)' }}>
          <div className="stat-icon"><Icon name="shield" /></div>
          <div className="grow"><strong>Verification {user.verificationStatus}</strong><div className="muted small">{STATUS_NOTE[user.verificationStatus]}</div></div>
          <Link className="btn btn-primary btn-sm" to="/driver/profile">Open KYC</Link>
        </div>
      )}
      {current.data && (
        <div className="card row alert-card" style={{ marginBottom: '1.1rem', borderColor: 'var(--pink)' }}>
          <div className="stat-icon"><Icon name="car" /></div>
          <div className="grow"><strong>Trip in progress · {STATE_LABEL[current.data.status]}</strong><div className="muted small">{current.data.pickup.address} → {current.data.drop.address}</div></div>
          <Link className="btn btn-primary btn-sm" to="/driver/trip">Open trip</Link>
        </div>
      )}
      <div className="grid g3" style={{ marginBottom: '1.1rem' }}>
        <Stat icon="wallet" label="Today's earnings" value={e ? inr(e.today) : '…'} />
        <Stat icon="car" label="Completed trips" value={e ? e.totalTrips : '…'} />
        <Stat icon="star" label="Rating" value={user ? (user.rating || 'New') : '…'} />
      </div>
      <div className="grid g3">
        <Card title="Ride requests" action={online && approved && !current.data && <span className="muted small">Live</span>}>
          {!online || !approved ? <p className="muted">{approved ? 'Go online to receive requests.' : 'Requests appear once you are approved and online.'}</p>
            : current.data ? <p className="muted">Finish your current trip to see new requests.</p>
            : !requests.data?.length ? <Empty loading={requests.loading && !requests.data} error={requests.error}>Waiting for ride requests…</Empty> : (
              <ul className="list">
                {requests.data.map((r) => (
                  <li key={r._id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '.6rem' }}>
                    <div className="row">
                      <div className="avatar">{r.user?.name?.[0] || '?'}</div>
                      <div className="grow"><strong>{r.user?.name}</strong><div className="muted small">{TIER_NAME[r.tier]} · {r.km} km{r.durationMin ? ` · ~${r.durationMin} min` : ''}</div></div>
                      <strong>{inr(r.fare)}</strong>
                    </div>
                    <div className="small"><Icon name="pin" size={16} /> {r.pickup.address}<br /><Icon name="route" size={16} /> {r.drop.address}</div>
                    <div className="row">
                      <button className="btn btn-ghost btn-sm grow" disabled={busyId === r._id} onClick={() => respond(r, 'reject')}>Skip</button>
                      <button className="btn btn-primary btn-sm grow" disabled={busyId === r._id} onClick={() => respond(r, 'accept')}>Accept</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card title="Your area" className="span2">
          <MapView height={340} markers={current.data ? tripMarkers(current.data) : (requests.data || []).map((r) => ({ pos: [r.pickup.lat, r.pickup.lng], kind: 'pickup', label: r.pickup.address }))} />
        </Card>
      </div>
    </>
  );
}

// Planned road route (OSRM), or a straight line if routing was unavailable when booked.
const pathOf = (r) => (r.route?.length > 1 ? r.route : [[r.pickup.lat, r.pickup.lng], [r.drop.lat, r.drop.lng]]);

// Point at fraction t (0–1) along a path, measured by distance.
function along(path, t) {
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, left / seg[i]) : 0;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
    }
    left -= seg[i];
  }
  return path[path.length - 1];
}

// Demo GPS: drives the car along the planned route (optionally with a detour) and streams it over the
// WebSocket exactly like real GPS, so route-deviation alerts can be shown without leaving the room.
// ponytail: demo control for the viva; real trips use the phone's GPS (Shell → DriverGps).
function useSimulator(ride, setCar) {
  const [mode, setMode] = useState(null); // null | 'route' | 'detour'
  const step = useRef(0);
  useEffect(() => {
    if (!mode || !ride) return undefined;
    gps.simulating = true;
    const path = pathOf(ride);
    // Unit vector (in metres east/north) at right angles to the trip, so a detour leaves the route
    // whichever way the trip runs (a fixed "north" push would slide along a north-bound route).
    const [a, b] = [path[0], path[path.length - 1]];
    const kx = 111320 * Math.cos((a[0] * Math.PI) / 180);
    const ky = 110540;
    const dx = (b[1] - a[1]) * kx;
    const dy = (b[0] - a[0]) * ky;
    const len = Math.hypot(dx, dy) || 1;
    const tick = () => {
      step.current = Math.min(step.current + 1, 20);
      const t = step.current / 20;
      const [lat, lng] = along(path, t);
      // Detour pushes the car ~900 m sideways through the middle of the trip.
      const side = mode === 'detour' ? Math.sin(Math.PI * t) * 900 : 0;
      const point = { lat: lat + (side * dx) / len / ky, lng: lng - (side * dy) / len / kx };
      liveSend('driver:location', point);
      setCar((c) => ({ ...c, ...point }));
    };
    tick();
    const timer = setInterval(tick, 1500);
    return () => { clearInterval(timer); gps.simulating = false; };
  }, [mode, ride?._id]);
  const start = (m) => { step.current = 0; setMode(m); };
  return { mode, start, stop: () => setMode(null) };
}

const NEXT = { otp_verified: ['en_route', 'Start trip'], en_route: ['arrived', 'Mark arrived'], arrived: ['completed', 'Complete trip'] };

function Trip() {
  const active = useApi('/rides/active', { on: RIDE_EVENTS });
  const ride = active.data;
  const [car, setCar] = useState(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [once, busy] = useOnce();
  const [finished, setFinished] = useState(null);
  const sim = useSimulator(ride, setCar);

  useLive(({ type, data }) => {
    if (type === 'deviation:alert' && ride && data.rideId === ride._id) setCar((c) => ({ ...c, lat: data.lat, lng: data.lng, deviated: data.deviated }));
  });

  const act = (path, body) => once(async () => {
    setError('');
    try {
      const updated = await request(`/rides/${ride._id}/${path}`, { method: 'POST', body });
      if (['completed', 'cancelled'].includes(updated.status)) { setFinished(updated); active.setData(null); sim.stop(); } else active.setData(updated);
      setOtp('');
    } catch (err) {
      setError(err.message);
      active.reload();
    }
  });
  const verify = (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setError('Enter the 6-digit OTP the passenger shows you.'); return; }
    act('start', { otp });
  };

  if (!ride) {
    return (
      <>
        <PageHead title="Current trip" />
        <Card>
          {finished
            ? <p className="muted">{finished.status === 'completed' ? `Trip completed · ${inr(finished.fare)} added to your earnings. Well done!` : 'Trip cancelled.'}</p>
            : <Empty loading={active.loading} error={active.error}>No active trip. Accept a request from your dashboard.</Empty>}
          <Link className="btn btn-primary" style={{ marginTop: '1rem' }} to="/driver">Back to dashboard</Link>
        </Card>
      </>
    );
  }

  const idx = RIDE_STATES.indexOf(ride.status);
  const next = NEXT[ride.status];
  const monitored = ['otp_verified', 'en_route'].includes(ride.status);
  return (
    <>
      <PageHead title="Current trip" sub={`${TIER_NAME[ride.tier]} · ${ride.km} km${ride.durationMin ? ` · ~${ride.durationMin} min` : ''}`}><Badge value={car?.deviated ? 'deviation' : ride.status} label={car?.deviated ? 'Off route' : undefined} /></PageHead>
      <div className="grid g3">
        <Card className="span2"><MapView height={440} markers={tripMarkers(ride, car)} route={pathOf(ride)} /></Card>
        <div className="grid">
          <Card title="Trip details">
            <ul className="list small">
              <li><div className="avatar">{ride.user?.name?.[0]}</div><div className="grow"><strong>{ride.user?.name}</strong><div className="muted">Passenger</div></div><Link className="btn btn-ghost btn-sm" to="/driver/messages">Chat</Link></li>
              <li><Icon name="pin" /> {ride.pickup.address}</li>
              <li><Icon name="route" /> {ride.drop.address}</li>
              <li><Icon name="wallet" /> {inr(ride.fare)} · {ride.km} km</li>
            </ul>
          </Card>
          <Card title={ride.status === 'driver_assigned' ? 'Enter safety OTP' : 'Trip progress'}>
            {error && <div className="error" role="alert">{error}</div>}
            {ride.status === 'driver_assigned' ? (
              <form onSubmit={verify}>
                <input aria-label="Safety OTP" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="••••••" className="otp-input" />
                <button className="btn btn-primary btn-block" style={{ marginTop: '.8rem' }} disabled={busy}>Verify &amp; start</button>
                <p className="muted small" style={{ marginTop: '.6rem' }}>Ask the passenger for her 6-digit OTP once she is in the car.</p>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => window.confirm('Cancel this trip?') && act('cancel', { reason: 'Cancelled by driver' })}>Cancel trip</button>
              </form>
            ) : (
              <>
                <ol className="timeline">
                  {RIDE_STATES.map((s, i) => <li key={s} className={i <= idx ? 'done' : ''}>{STATE_LABEL[s]}</li>)}
                </ol>
                {next && <button className="btn btn-primary btn-block" disabled={busy} onClick={() => act('status', { status: next[0] })}>{next[1]}</button>}
              </>
            )}
          </Card>
        </div>
      </div>
      <Card title="Demo GPS" style={{ marginTop: '1.1rem' }} action={<span className="muted small">{sim.mode ? `Driving (${sim.mode})…` : 'Idle'}</span>}>
        <p className="muted small">Simulates the car's GPS along the route so the passenger and control room see it move. A detour goes ~900 m off route and triggers the deviation alert{monitored ? '' : ' (once the OTP is verified)'}.</p>
        <div className="row wrap">
          <button className="btn btn-ghost btn-sm" onClick={() => sim.start('route')}><Icon name="route" size={16} /> Drive the route</button>
          <button className="btn btn-ghost btn-sm" onClick={() => sim.start('detour')}><Icon name="alert" size={16} /> Drive with detour</button>
          {sim.mode && <button className="btn btn-ghost btn-sm" onClick={sim.stop}>Stop</button>}
        </div>
      </Card>
    </>
  );
}

function Earnings() {
  const { data, loading, error } = useApi('/driver/earnings', { on: RIDE_EVENTS });
  return (
    <>
      <PageHead title="Earnings" sub="Last 7 days" />
      <div className="grid g3" style={{ marginBottom: '1.1rem' }}>
        <Stat icon="wallet" label="Last 7 days" value={data ? inr(data.week) : '…'} />
        <Stat icon="car" label="Trips (7 days)" value={data ? data.weekTrips : '…'} />
        <Stat icon="wallet" label="Wallet balance" value={data ? inr(data.walletBalance) : '…'} />
      </div>
      <Card title="Daily earnings (₹)">
        {data ? <Bars data={data.daily} label={(d) => d.day} value={(d) => d.amount} /> : <Empty loading={loading} error={error} />}
      </Card>
    </>
  );
}

function Ratings() {
  const me = useApi('/me');
  const { data, loading, error } = useApi('/driver/ratings');
  return (
    <>
      <PageHead title="Ratings" sub={me.data ? `Average ★ ${me.data.user.rating || 'not rated yet'}` : ''} />
      <Card>
        {!data?.length ? <Empty loading={loading} error={error}>No ratings yet. Complete trips to get rated.</Empty> : (
          <ul className="list">
            {data.map((r) => (
              <li key={r._id}>
                <div className="avatar">{r.ride?.user?.name?.[0] || '?'}</div>
                <div className="grow"><strong>{r.ride?.user?.name || 'Passenger'}</strong> <Stars n={r.stars} /><div className="muted small">{r.feedback || 'No comment'}</div></div>
                <span className="muted small">{fmtDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Profile() {
  const me = useApi('/me', { on: ['driver:update'] }); // admin approvals arrive live
  const user = me.data?.user;
  const [type, setType] = useState(KYC_TYPES[0]);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const [busy, setBusy] = useState(false);

  const pick = (e) => {
    const f = e.target.files[0];
    const problem = uploadError(f);
    setMsg({ error: problem, ok: '' });
    setFile(problem ? null : f);
    if (problem) e.target.value = '';
  };
  const upload = async (e) => {
    e.preventDefault();
    if (!file) { setMsg({ error: 'Choose a file first.', ok: '' }); return; }
    const form = e.target;
    setBusy(true);
    try {
      const driver = await uploadDocument(type, file);
      me.setData((d) => ({ ...d, user: driver }));
      setMsg({ error: '', ok: `${type} uploaded — awaiting review.` });
      setFile(null);
      form.reset();
    } catch (err) {
      setMsg({ error: err.message, ok: '' });
    }
    setBusy(false);
  };

  if (!user) return <><PageHead title="Profile & KYC" /><Card><Empty loading={me.loading} error={me.error} /></Card></>;
  return (
    <>
      <PageHead title="Profile & KYC" sub="Admins review these documents before you can go online"><Badge value={user.verificationStatus} label={`Verification ${user.verificationStatus}`} /></PageHead>
      <div className="grid g2">
        <Card title="Vehicle & licence">
          <ul className="list">
            <li><Icon name="user" /><span className="grow">{user.name}</span><span className="muted small">{user.email}</span></li>
            <li><Icon name="car" /><span className="grow">{user.vehicleModel}</span><span className="muted">{user.vehiclePlate}</span></li>
            <li><Icon name="ticket" /><span className="grow">Licence</span><span className="muted">{user.licenseNumber}</span></li>
            <li><Icon name="star" /><span className="grow">Rating</span><span className="muted">{user.rating || 'Not rated yet'}</span></li>
          </ul>
        </Card>
        <Card title="Documents" action={<span className="muted small">{user.documents.length}/{KYC_TYPES.length}</span>}>
          <ul className="list">
            {KYC_TYPES.map((t) => {
              const d = user.documents.find((x) => x.type === t);
              return (
                <li key={t}>
                  <Icon name={d ? 'check' : 'plus'} /><span className="grow">{t}</span>
                  {d ? <><button className="btn btn-ghost btn-sm" onClick={() => openFile(d.path)}>View</button><Badge value={d.status} /></> : <span className="muted small">Not uploaded</span>}
                </li>
              );
            })}
          </ul>
          <form onSubmit={upload} style={{ marginTop: '1rem' }}>
            {msg.error && <div className="error" role="alert">{msg.error}</div>}
            {msg.ok && <p className="small" style={{ color: 'var(--ok)' }} role="status">{msg.ok}</p>}
            <div className="grid g2" style={{ gap: '.6rem' }}>
              <div><label htmlFor="dt">Document</label><select id="dt" value={type} onChange={(e) => setType(e.target.value)}>{KYC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div><label htmlFor="up">File (JPG/PNG/PDF, max 2 MB)</label><input id="up" type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={pick} /></div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: '.8rem' }} disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload document'}</button>
          </form>
        </Card>
      </div>
    </>
  );
}

export const driver = {
  menu: [
    { to: '', label: 'Dashboard', icon: 'home' },
    { to: 'trip', label: 'Current trip', icon: 'pin' },
    { to: 'earnings', label: 'Earnings', icon: 'wallet' },
    { to: 'ratings', label: 'Ratings', icon: 'star' },
    { to: 'messages', label: 'Messages', icon: 'chat' },
    { to: 'tickets', label: 'Support', icon: 'ticket' },
    { to: 'profile', label: 'Profile & KYC', icon: 'user' },
  ],
  routes: [
    ['', Dashboard], ['trip', Trip], ['earnings', Earnings], ['ratings', Ratings],
    ['messages', () => <Messages role="driver" />], ['tickets', SupportTickets], ['profile', Profile],
  ],
};
