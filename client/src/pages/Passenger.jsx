import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, Icon, inr, PageHead, Stars, StarInput, Stat, Toggle } from '../components/ui.jsx';
import { MapView } from '../components/MapView.jsx';
import { Messages } from '../components/Chat.jsx';
import { fmtDate, geocode, localEmit, request, setSessionName, TICKET_CATEGORIES, TIER_NAME, useApi, useLive, useOnce } from '../api.js';
import { RIDE_STATES, SAFETY_TIPS, STATE_LABEL } from '../constants.js';

const RIDE_EVENTS = ['ride:update'];
const pos = (p) => [p.lat, p.lng];

// Pins (+ live car) and the planned road route (OSRM) for a ride or a pending search.
// Falls back to a straight line only if the server could not get a road route.
function tripMap(pickup, drop, car, path) {
  const markers = [];
  if (pickup) markers.push({ pos: pos(pickup), kind: 'pickup', label: `Pickup: ${pickup.address}` });
  if (drop) markers.push({ pos: pos(drop), kind: 'drop', label: `Drop: ${drop.address}` });
  if (car?.lat != null) markers.push({ pos: pos(car), kind: car.deviated ? 'sos' : 'car', label: car.deviated ? 'Driver — off route' : 'Driver' });
  return { markers, route: path?.length > 1 ? path : pickup && drop ? [pos(pickup), pos(drop)] : undefined };
}

// Active ride + the driver's live position (WebSocket `driver:location`).
function useActiveRide() {
  const active = useApi('/rides/active', { on: RIDE_EVENTS });
  const [car, setCar] = useState(null);
  const ride = active.data;
  useLive(({ type, data }) => {
    if (type === 'driver:location' && ride && data.rideId === ride._id) setCar(data);
    if (type === 'deviation:alert' && ride && data.rideId === ride._id) active.reload();
  });
  const live = car && ride && car.rideId === ride._id ? car : ride?.driver?.location?.lat != null ? { ...ride.driver.location, deviated: ride.deviated } : null;
  return { ...active, ride, car: live };
}

async function cancelRide(ride, onDone) {
  if (!window.confirm('Cancel this ride?')) return;
  try {
    await request(`/rides/${ride._id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by passenger' } });
    onDone();
  } catch (err) {
    alert(err.message);
  }
}

function LiveRideCard({ ride, onChange }) {
  if (!ride) {
    return (
      <Card title="Live ride status">
        <p className="muted" style={{ margin: 0 }}>No active ride. Book one to see your driver, safety OTP and trip status here.</p>
      </Card>
    );
  }
  const d = ride.driver;
  const showOtp = ['requested', 'driver_assigned'].includes(ride.status);
  return (
    <Card title="Live ride status" action={<Badge value={ride.deviated ? 'deviation' : ride.status} label={ride.deviated ? 'Off route' : STATE_LABEL[ride.status]} />}>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <div className="avatar">{d ? d.name[0] : <Icon name="car" size={18} />}</div>
        <div className="grow">
          {d ? <><strong>{d.name}</strong> {d.rating ? <span className="muted small">★ {d.rating}</span> : null}<div className="muted small">{d.vehicleModel} · {d.vehiclePlate}</div></>
            : <><strong>Finding a verified driver…</strong><div className="muted small">Only approved women drivers see your request.</div></>}
        </div>
      </div>
      <div className="grid g2" style={{ gap: '.75rem' }}>
        <div><div className="stat-label">Safety OTP</div>{showOtp ? <div className="otp">{ride.otp}</div> : <div className="stat-value" style={{ color: 'var(--ok)' }}>Verified</div>}</div>
        <div><div className="stat-label">Fare · {ride.km} km{ride.durationMin ? ` · ~${ride.durationMin} min` : ''}</div><div className="stat-value">{inr(ride.fare)}</div></div>
      </div>
      <p className="muted small" style={{ marginTop: '.8rem' }}>{ride.pickup.address} → {ride.drop.address}</p>
      {showOtp && (
        <div className="row spread wrap">
          <span className="muted small">Share the OTP only once you are inside the car.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => cancelRide(ride, onChange)}>Cancel ride</button>
        </div>
      )}
    </Card>
  );
}

// Typed text → saved place (has coordinates) or an OpenStreetMap lookup.
const resolvePlace = async (text, saved) => {
  const hit = saved.find((a) => a.address.toLowerCase() === text.toLowerCase() || a.label.toLowerCase() === text.toLowerCase());
  return hit ? { address: hit.address, lat: hit.lat, lng: hit.lng } : geocode(text);
};

// Text box with the passenger's saved places as a styled suggestion list (a native <datalist> can't be styled).
// Follows the ARIA combobox pattern: arrow keys move, Enter picks, Escape closes; typing filters by label or address.
function PlaceInput({ id, value, onChange, saved, ...props }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = value.trim().toLowerCase();
  const matches = saved.filter((a) => !q || a.label.toLowerCase().includes(q) || a.address.toLowerCase().includes(q));
  const exact = matches.length === 1 && matches[0].label.toLowerCase() === q; // already picked: nothing left to suggest
  const shown = open && matches.length > 0 && !exact;
  const pick = (a) => { onChange(a.label); setOpen(false); setActive(-1); };
  const onKeyDown = (e) => {
    if (!shown) { if (e.key === 'ArrowDown' && matches.length) { setOpen(true); setActive(0); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown') { setActive((i) => (i + 1) % matches.length); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((i) => (i <= 0 ? matches.length - 1 : i - 1)); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(matches[active]); e.preventDefault(); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  };
  return (
    <div className="combo">
      <input id={id} value={value} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={`${id}-list`}
        aria-activedescendant={shown && active >= 0 ? `${id}-opt-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} {...props} />
      {shown && (
        <ul id={`${id}-list`} className="suggest" role="listbox" aria-label="Saved places">
          {matches.map((a, i) => (
            <li key={a._id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(a)}>
              <Icon name="pin" size={16} />
              <span className="grow"><strong>{a.label}</strong><span className="muted small">{a.address}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Dashboard() {
  const meApi = useApi('/me', { on: RIDE_EVENTS });
  const stats = useApi('/me/stats', { on: RIDE_EVENTS });
  const history = useApi('/rides', { on: RIDE_EVENTS });
  const { ride, car, reload } = useActiveRide();
  const user = meApi.data?.user;
  const saved = user?.savedAddresses || [];

  const [pickupText, setPickupText] = useState('');
  const [dropText, setDropText] = useState('');
  const [trip, setTrip] = useState(null); // { pickup, drop, km, fares }
  const [tier, setTier] = useState('lite');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [once] = useOnce();

  const search = (e) => { e.preventDefault(); once(doSearch); };
  const doSearch = async () => {
    setBusy('search');
    setError('');
    try {
      const [pickup, drop] = await Promise.all([resolvePlace(pickupText.trim(), saved), resolvePlace(dropText.trim(), saved)]);
      const est = await request('/rides/estimate', { method: 'POST', body: { pickup, drop } });
      setTrip({ ...est, pickup, drop });
    } catch (err) {
      setTrip(null);
      setError(err.message);
    }
    setBusy('');
  };

  const book = () => once(doBook);
  const doBook = async () => {
    setBusy('book');
    setError('');
    try {
      await request('/rides', { method: 'POST', body: { pickup: trip.pickup, drop: trip.drop, tier } });
      setTrip(null);
      setPickupText('');
      setDropText('');
      reload();
      meApi.reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy('');
  };

  const edit = (setter) => (text) => { setter(text); setTrip(null); };
  const shown = ride ? tripMap(ride.pickup, ride.drop, car, ride.route) : trip ? tripMap(trip.pickup, trip.drop, null, trip.route) : { markers: [] };
  const s = stats.data;

  return (
    <>
      <PageHead title={`Hi, ${(user?.name || '').split(' ')[0] || 'there'}`} sub="Where are you heading today?" />
      <div className="grid g4" style={{ marginBottom: '1.1rem' }}>
        <Stat icon="wallet" label="Wallet balance" value={user ? inr(user.walletBalance) : '…'} />
        <Stat icon="check" label="Rides completed" value={s ? s.ridesCompleted : '…'} />
        <Stat icon="shield" label="Safety score" value={s ? `${s.safetyScore}%` : '…'} />
        <Stat icon="clock" label="Avg wait" value={s ? (s.avgWaitMin != null ? `${s.avgWaitMin} min` : '—') : '…'} />
      </div>
      <div className="grid g3">
        <Card title="Book a ride">
          {ride ? (
            <>
              <p className="muted">You have an active ride. You can book again once it ends.</p>
              <Link className="btn btn-primary btn-block" to="/app/tracking">Open live tracking</Link>
            </>
          ) : (
            <form onSubmit={search}>
              {error && <div className="error" role="alert">{error}{/wallet/i.test(error) && <> <Link to="/app/wallet">Top up</Link></>}</div>}
              <div className="field"><label htmlFor="pickup">Pickup</label><PlaceInput id="pickup" saved={saved} value={pickupText} onChange={edit(setPickupText)} placeholder="e.g. CG Road, Navrangpura, Ahmedabad" required maxLength={200} /></div>
              <div className="field"><label htmlFor="drop">Destination</label><PlaceInput id="drop" saved={saved} value={dropText} onChange={edit(setDropText)} placeholder="Where to?" required maxLength={200} /></div>
              {trip && (
                <>
                  <div className="tiers">
                    {trip.fares.map((t) => (
                      <button type="button" key={t.id} className={`tier ${tier === t.id ? 'active' : ''}`} onClick={() => setTier(t.id)} aria-pressed={tier === t.id}>
                        <Icon name="car" />
                        <div><strong>{t.name}</strong><div className="muted small">{t.desc}</div></div>
                        <span className="tier-price">{inr(t.fare)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="muted small">{trip.km} km by road · ~{trip.durationMin} min · fare = base + per-km · no surge · paid from wallet</p>
                </>
              )}
              {trip
                ? <button type="button" className="btn btn-primary btn-block" onClick={book} disabled={!!busy}>{busy === 'book' ? 'Booking…' : 'Confirm booking'}</button>
                : <button className="btn btn-primary btn-block" disabled={!!busy}>{busy === 'search' ? 'Finding fares…' : 'Search rides'}</button>}
            </form>
          )}
        </Card>
        <Card title="Map" className="span2" action={ride && <Badge value={ride.status} />}>
          <MapView height={420} markers={shown.markers} route={shown.route} />
        </Card>
      </div>
      <div className="grid g2" style={{ marginTop: '1.1rem' }}>
        <LiveRideCard ride={ride} onChange={reload} />
        <Card title="Recent rides" action={<Link className="small" to="/app/history">See all</Link>}>
          {!history.data?.length ? <Empty loading={history.loading} error={history.error}>No past rides yet.</Empty> : (
            <ul className="list">
              {history.data.slice(0, 3).map((r) => (
                <li key={r._id}>
                  <div className="stat-icon"><Icon name="car" /></div>
                  <div className="grow"><strong>{r.pickup.address} → {r.drop.address}</strong><div className="muted small">{fmtDate(r.createdAt)}</div></div>
                  {r.status === 'completed' ? <span>{inr(r.fare)}</span> : <Badge value={r.status} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export function LiveTracking() {
  const { ride, car, loading, error, reload } = useActiveRide();
  const me = useApi('/me');
  const config = useApi('/safety/config');
  const user = me.data?.user;
  const sharing = user?.preferences?.shareTrips !== false;
  const contacts = user?.emergencyContacts?.length || 0;

  const setSharing = async (on) => {
    try {
      me.setData(await request('/me', { method: 'PUT', body: { preferences: { shareTrips: on } } }));
    } catch (err) {
      alert(err.message);
    }
  };

  if (!ride) {
    return (
      <>
        <PageHead title="Live tracking" />
        <Card><Empty loading={loading} error={error}>No active ride right now.</Empty><Link className="btn btn-primary" style={{ marginTop: '1rem' }} to="/app">Book a ride</Link></Card>
      </>
    );
  }
  const current = RIDE_STATES.indexOf(ride.status);
  const { markers, route } = tripMap(ride.pickup, ride.drop, car, ride.route);
  const deviated = car?.deviated ?? ride.deviated;
  return (
    <>
      <PageHead title="Live tracking" sub={`${ride.pickup.address} → ${ride.drop.address}`} />
      {deviated && (
        <div className="card row alert-card" style={{ marginBottom: '1.1rem' }} role="alert">
          <div className="stat-icon" style={{ background: 'rgba(229,56,59,.2)', color: 'var(--sos)' }}><Icon name="alert" /></div>
          <div className="grow"><strong>Your car is off the planned route</strong><div className="muted small">The control room has been notified. Press SOS if you feel unsafe.</div></div>
        </div>
      )}
      <div className="grid g3">
        <Card className="span2"><MapView height={480} markers={markers} route={route} /></Card>
        <div className="grid">
          <LiveRideCard ride={ride} onChange={reload} />
          <Card title="Trip timeline">
            <ol className="timeline">
              {RIDE_STATES.map((s, i) => (
                <li key={s} className={i < current ? 'done' : i === current ? 'done now' : ''}>{STATE_LABEL[s]}</li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      <Card title="Safety controls" style={{ marginTop: '1.1rem' }}>
        <div className="grid g3">
          <div className="row">
            <Toggle on={sharing} onChange={setSharing} label="Live trip sharing" />
            <div><strong>Live trip sharing</strong><div className="muted small">{sharing ? `Emailing updates to ${contacts} contact${contacts === 1 ? '' : 's'}` : 'Off'}</div></div>
          </div>
          <div className="row">
            <div className="stat-icon" style={deviated ? { color: 'var(--sos)' } : undefined}><Icon name="route" /></div>
            <div><strong>Deviation radar</strong><div className="muted small">{deviated ? 'Off route — alert sent' : `On · alerts if > ${config.data?.deviationM ?? 500} m off route`}</div></div>
          </div>
          <div className="row">
            <div className="stat-icon"><Icon name={ride.startTime ? 'check' : 'shield'} /></div>
            <div><strong>{ride.startTime ? 'OTP verified' : 'OTP pending'}</strong><div className="muted small">{ride.startTime ? `Ride started ${fmtDate(ride.startTime)}` : 'Driver enters it to start the ride'}</div></div>
          </div>
        </div>
      </Card>
    </>
  );
}

// Rate a completed ride or report a problem with it.
function RideFeedback({ ride, onDone, onClose }) {
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [complaint, setComplaint] = useState('');
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    setMsg({ error: '', ok: '' });
    try {
      await fn();
      setMsg({ error: '', ok });
      onDone();
      return true;
    } catch (err) {
      setMsg({ error: err.message, ok: '' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const rate = (e) => {
    e.preventDefault();
    if (stars) run(() => request(`/rides/${ride._id}/rate`, { method: 'POST', body: { stars, feedback } }), 'Thanks for rating your driver!');
  };
  const report = async (e) => {
    e.preventDefault();
    if (await run(() => request('/complaints', { method: 'POST', body: { ride: ride._id, description: complaint } }), 'Complaint sent to the SheRides team.')) setComplaint('');
  };
  const canRate = ride.status === 'completed' && !ride.myRating;
  return (
    <Card title={`${ride.pickup.address} → ${ride.drop.address}`} action={<button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>} style={{ marginBottom: '1.1rem' }}>
      {msg.error && <div className="error" role="alert">{msg.error}</div>}
      {msg.ok && <p className="small" role="status" style={{ color: 'var(--ok)' }}>{msg.ok}</p>}
      <div className="grid g2">
        {canRate ? (
          <form onSubmit={rate}>
            <label>Rate {ride.driver?.name}</label>
            <StarInput value={stars} onChange={setStars} />
            <textarea aria-label="Feedback" rows={2} maxLength={300} placeholder="Anything to add? (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} style={{ marginTop: '.5rem' }} />
            <button className="btn btn-primary btn-sm" style={{ marginTop: '.6rem' }} disabled={!stars || busy}>Submit rating</button>
          </form>
        ) : <p className="muted small">{ride.myRating ? <>You rated this ride <Stars n={ride.myRating} /></> : 'Only completed rides can be rated.'}</p>}
        <form onSubmit={report}>
          <label htmlFor="cmp">Report a problem</label>
          <textarea id="cmp" rows={3} required maxLength={1000} placeholder="What went wrong?" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '.6rem' }} disabled={busy || !complaint.trim()}>Send complaint</button>
        </form>
      </div>
    </Card>
  );
}

export function History() {
  const { data, loading, error, reload } = useApi('/rides', { on: RIDE_EVENTS });
  const [sel, setSel] = useState(null);
  const selected = data?.find((r) => r._id === sel);
  return (
    <>
      <PageHead title="Ride history" sub="Completed and cancelled trips" />
      {selected && <RideFeedback key={selected._id} ride={selected} onDone={reload} onClose={() => setSel(null)} />}
      <Card>
        {!data?.length ? <Empty loading={loading} error={error}>No past rides yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Route</th><th>Driver</th><th>Tier</th><th>Fare</th><th>Status</th><th>Rating</th><th /></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r._id}>
                    <td>{fmtDate(r.createdAt)}</td><td>{r.pickup.address} → {r.drop.address}</td><td>{r.driver?.name || '—'}</td>
                    <td>{TIER_NAME[r.tier]}</td><td>{r.status === 'completed' ? inr(r.fare) : '—'}</td>
                    <td><Badge value={r.status} />{r.cancel?.by && <div className="muted small">by {r.cancel.by}</div>}</td>
                    <td>{r.myRating ? <Stars n={r.myRating} /> : '—'}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => setSel(r._id)}>{r.status === 'completed' && !r.myRating ? 'Rate / report' : 'Report'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export function Wallet() {
  const { data, loading, error, setData } = useApi('/wallet', { on: RIDE_EVENTS });
  const [amount, setAmount] = useState(500);
  const [msg, setMsg] = useState('');
  const [once, busy] = useOnce();
  const topUp = (e) => {
    e.preventDefault();
    once(async () => {
      setMsg('');
      try {
        const { balance, payment } = await request('/wallet', { method: 'POST', body: { amount: Number(amount) } });
        setData((d) => ({ balance, payments: [payment, ...(d?.payments || [])] }));
      } catch (err) {
        setMsg(err.message);
      }
    });
  };
  return (
    <>
      <PageHead title="Wallet & payments" sub="Fares are auto-debited from your wallet when a trip completes" />
      <div className="grid g3">
        <Card title="Balance">
          <div className="stat-value grad-text" style={{ fontSize: '2.4rem' }}>{data ? inr(data.balance) : '…'}</div>
          {/* ponytail: mock top-up — money appears instantly. Upgrade: Razorpay checkout. */}
          <form onSubmit={topUp} style={{ marginTop: '1rem' }}>
            {msg && <div className="error" role="alert">{msg}</div>}
            <label htmlFor="amt">Top-up amount (₹50 – ₹10,000)</label>
            <div className="row">
              <input id="amt" type="number" min="50" max="10000" step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button className="btn btn-primary" disabled={busy}><Icon name="plus" /> Add</button>
            </div>
            <div className="row wrap" style={{ marginTop: '.7rem' }}>
              {[200, 500, 1000].map((v) => <button type="button" key={v} className="btn btn-ghost btn-sm" onClick={() => setAmount(v)}>₹{v}</button>)}
            </div>
            <p className="muted small" style={{ marginTop: '.8rem' }}>Demo payments — no real money moves.</p>
          </form>
        </Card>
        <Card title="Transaction history" className="span2">
          {!data?.payments.length ? <Empty loading={loading} error={error}>No transactions yet.</Empty> : (
            <ul className="list">
              {data.payments.map((p) => {
                const credit = p.method === 'topup';
                return (
                  <li key={p._id}>
                    <div className="stat-icon"><Icon name={credit ? 'plus' : 'car'} /></div>
                    <div className="grow"><strong>{credit ? 'Wallet top-up' : 'Ride fare'}</strong><div className="muted small">{fmtDate(p.createdAt)}{p.status === 'failed' && ' · payment failed'}</div></div>
                    <strong style={{ color: credit ? 'var(--ok)' : p.status === 'failed' ? '#ff7b7d' : 'var(--cream)' }}>{credit ? '+' : '−'}{inr(p.amount)}</strong>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export function Safety() {
  const me = useApi('/me');
  const config = useApi('/safety/config');
  const user = me.data?.user;
  const list = user?.emergencyContacts || [];
  const blank = { name: '', relation: '', phone: '', email: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [once, adding] = useOnce();
  const save = async (fn) => {
    setError('');
    try {
      me.setData(await fn());
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };
  const add = async (e) => {
    e.preventDefault();
    await once(async () => { if (await save(() => request('/me/contacts', { method: 'POST', body: form }))) setForm(blank); });
  };
  const field = (k, props) => (
    <input aria-label={props.placeholder} required value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />
  );
  const cfg = config.data;
  const prefs = user?.preferences || {};
  const safeguards = [
    ['Verified women drivers only', 'KYC documents + admin approval', true],
    ['Safety OTP', 'Ride starts only with your 6-digit code', true],
    ['Route deviation radar', `Alerts you + control room above ${cfg?.deviationM ?? 500} m`, true],
    ['Geo-fence', `Every ride, all day · pickup and drop within ${cfg?.serviceArea.radiusKm ?? 35} km of ${cfg?.serviceArea.name ?? 'the city'}`, true],
    ['Live trip sharing', prefs.shareTrips !== false ? 'Contacts get email updates' : 'Turned off in Settings', prefs.shareTrips !== false],
    ['Masked chat & calls', 'Your number is never shared', true],
  ];
  return (
    <>
      <PageHead title="Safety centre" sub="People and protections that travel with you" />
      <div className="grid g2">
        <Card title="Emergency contacts" action={<span className="muted small">{list.length}/5</span>}>
          {error && <div className="error" role="alert">{error}</div>}
          {!list.length ? <Empty loading={me.loading} error={me.error}>Add people who should hear about your trips and SOS alerts.</Empty> : (
            <ul className="list">
              {list.map((c) => (
                <li key={c._id}>
                  <div className="avatar">{c.name[0]}</div>
                  <div className="grow"><strong>{c.name}</strong><div className="muted small">{c.relation} · {c.phone}</div><div className="muted small">{c.email}</div></div>
                  <button className="btn btn-ghost btn-sm" aria-label={`Remove ${c.name}`} onClick={() => window.confirm(`Remove ${c.name}?`) && save(() => request(`/me/contacts/${c._id}`, { method: 'DELETE' }))}><Icon name="x" size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          {/* SOS and trip updates reach contacts by email (SMTP); phone is kept for reference. */}
          <form onSubmit={add} className="grid g2" style={{ gap: '.5rem', marginTop: '1rem' }}>
            {field('name', { placeholder: 'Name', maxLength: 60 })}
            {field('relation', { placeholder: 'Relation', maxLength: 30 })}
            {field('phone', { placeholder: 'Phone', type: 'tel', pattern: '[0-9+ ]{10,15}' })}
            {field('email', { placeholder: 'Email', type: 'email', maxLength: 120 })}
            <button className="btn btn-primary" style={{ gridColumn: '1 / -1' }} disabled={adding || list.length >= 5}><Icon name="plus" /> Add contact</button>
          </form>
        </Card>
        <div className="grid">
          <Card title="Active safeguards">
            <ul className="list">
              {safeguards.map(([t, d, on]) => (
                <li key={t}><div className="stat-icon"><Icon name="shield" /></div><div className="grow"><strong>{t}</strong><div className="muted small">{d}</div></div><Badge value={on ? 'active' : 'pending'} label={on ? 'On' : 'Off'} /></li>
              ))}
            </ul>
          </Card>
          <Card title="Safety tips">
            <ul className="list">{SAFETY_TIPS.map((t) => <li key={t}><Icon name="check" /> {t}</li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}

export function Notifications() {
  const { data, loading, error, setData } = useApi('/notifications', { on: ['notification'] });
  const markRead = async () => {
    try {
      await request('/notifications/read', { method: 'PUT' });
      setData((list) => list.map((n) => ({ ...n, isRead: true })));
      localEmit('notifications:read');
    } catch (err) {
      alert(err.message);
    }
  };
  return (
    <>
      <PageHead title="Notifications">
        <button className="btn btn-ghost btn-sm" onClick={markRead} disabled={!data?.some((n) => !n.isRead)}>Mark all read</button>
      </PageHead>
      <Card>
        {!data?.length ? <Empty loading={loading} error={error}>You're all caught up.</Empty> : (
          <ul className="list">
            {data.map((n) => (
              <li key={n._id} style={{ opacity: n.isRead ? 0.6 : 1 }}>
                <div className="stat-icon"><Icon name="bell" /></div>
                <div className="grow">{n.message}<div className="muted small">{fmtDate(n.createdAt)}</div></div>
                {!n.isRead && <span className="badge pink">New</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function Profile() {
  const me = useApi('/me');
  const user = me.data?.user;
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const [place, setPlace] = useState({ label: '', address: '' });
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    setMsg({ error: '', ok: '' });
    try {
      me.setData(await fn());
      setMsg({ error: '', ok });
      return true;
    } catch (err) {
      setMsg({ error: err.message, ok: '' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveProfile = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    run(async () => {
      const data = await request('/me', { method: 'PUT', body: f });
      setSessionName(data.user.name);
      return data;
    }, 'Profile saved.');
  };
  const addPlace = async (e) => {
    e.preventDefault();
    const label = place.label.trim();
    const ok = await run(async () => {
      const at = await geocode(place.address.trim());
      return request('/me/addresses', { method: 'POST', body: { label, ...at } });
    }, `${label} saved.`);
    if (ok) setPlace({ label: '', address: '' });
  };

  if (!user) return <><PageHead title="Profile" /><Card><Empty loading={me.loading} error={me.error} /></Card></>;
  return (
    <>
      <PageHead title="Profile" />
      {msg.error && <div className="error" role="alert">{msg.error}</div>}
      {msg.ok && <p className="small" role="status" style={{ color: 'var(--ok)' }}>{msg.ok}</p>}
      <div className="grid g2">
        <Card title="Personal details">
          <form onSubmit={saveProfile}>
            <div className="row" style={{ marginBottom: '1rem' }}><div className="avatar" style={{ width: 64, height: 64, fontSize: '1.5rem' }}>{user.name[0]}</div><Badge value="approved" label="Verified woman rider" /></div>
            <div className="field"><label htmlFor="pn">Name</label><input id="pn" name="name" defaultValue={user.name} required maxLength={80} /></div>
            <div className="field"><label htmlFor="pe">Email</label><input id="pe" type="email" value={user.email} readOnly disabled /></div>
            <div className="field"><label htmlFor="pp">Phone</label><input id="pp" name="phone" type="tel" defaultValue={user.phone} required pattern="[0-9+ ]{10,15}" /></div>
            <button className="btn btn-primary" disabled={busy}>Save changes</button>
          </form>
        </Card>
        <Card title="Saved places" action={<span className="muted small">{user.savedAddresses.length}/10</span>}>
          {!user.savedAddresses.length ? <p className="muted">Save places like Home and Work to book faster.</p> : (
            <ul className="list">
              {user.savedAddresses.map((a) => (
                <li key={a._id}>
                  <div className="stat-icon"><Icon name="pin" /></div>
                  <div className="grow"><strong>{a.label}</strong><div className="muted small">{a.address}</div></div>
                  <button className="btn btn-ghost btn-sm" aria-label={`Remove ${a.label}`} disabled={busy} onClick={() => run(() => request(`/me/addresses/${a._id}`, { method: 'DELETE' }), `${a.label} removed.`)}><Icon name="x" size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addPlace} className="grid g2" style={{ gap: '.5rem', marginTop: '1rem' }}>
            <input aria-label="Label" placeholder="Label (e.g. Gym)" required maxLength={30} value={place.label} onChange={(e) => setPlace({ ...place, label: e.target.value })} />
            <input aria-label="Address" placeholder="Address" required maxLength={200} value={place.address} onChange={(e) => setPlace({ ...place, address: e.target.value })} />
            <button className="btn btn-primary" style={{ gridColumn: '1 / -1' }} disabled={busy || user.savedAddresses.length >= 10}><Icon name="plus" /> Save place</button>
          </form>
        </Card>
      </div>
    </>
  );
}

export function Settings() {
  const me = useApi('/me');
  const prefs = me.data?.user?.preferences || {};
  const [error, setError] = useState('');
  const set = async (key, value) => {
    setError('');
    try {
      me.setData(await request('/me', { method: 'PUT', body: { preferences: { [key]: value } } }));
    } catch (err) {
      setError(err.message);
    }
  };
  const items = [
    ['shareTrips', 'Live trip sharing', 'Email my emergency contacts when a driver is assigned, the ride starts and ends'],
    ['emailUpdates', 'Email ride updates', 'Email me when a driver is assigned, when a trip completes (receipt) or is cancelled'],
  ];
  return (
    <>
      <PageHead title="Settings" />
      <Card>
        {error && <div className="error" role="alert">{error}</div>}
        {!me.data ? <Empty loading={me.loading} error={me.error} /> : (
          <ul className="list">
            {items.map(([k, label, desc]) => (
              <li key={k}><div className="grow"><strong>{label}</strong><div className="muted small">{desc}</div></div><Toggle on={prefs[k] !== false} onChange={(v) => set(k, v)} label={label} /></li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// Tickets for passengers and drivers (same page, same API).
export function SupportTickets() {
  const { data, loading, error, setData } = useApi('/tickets', { on: ['notification', 'ticket:update'] });
  const blank = { subject: '', category: 'Ride', message: '' };
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState('');
  const [once, sending] = useOnce();
  const submit = (e) => {
    e.preventDefault();
    once(async () => {
      setMsg('');
      try {
        const t = await request('/tickets', { method: 'POST', body: form });
        setData((list) => (list?.some((x) => x._id === t._id) ? list : [t, ...(list || [])]));
        setForm(blank);
      } catch (err) {
        setMsg(err.message);
      }
    });
  };
  return (
    <>
      <PageHead title="Help & support" sub="Our support team usually replies within a few hours" />
      <div className="grid g2">
        <Card title="Raise a ticket">
          <form onSubmit={submit}>
            {msg && <div className="error" role="alert">{msg}</div>}
            <div className="field"><label htmlFor="ts">Subject</label><input id="ts" required maxLength={120} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div className="field"><label htmlFor="tc">Category</label><select id="tc" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{TICKET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field"><label htmlFor="tm">Message</label><textarea id="tm" rows={4} required maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
            <button className="btn btn-primary" disabled={sending}>{sending ? 'Submitting…' : 'Submit'}</button>
          </form>
        </Card>
        <Card title="My tickets">
          {!data?.length ? <Empty loading={loading} error={error}>No tickets yet.</Empty> : (
            <ul className="list">
              {data.map((t) => (
                <li key={t._id}>
                  <div className="grow"><strong>{t.subject}</strong><div className="muted small">{t.category} · {fmtDate(t.createdAt)}</div>{t.response && <div className="small" style={{ marginTop: '.3rem' }}><span className="pink">Support:</span> {t.response}</div>}</div>
                  <Badge value={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

// Unread notifications badge for the sidebar.
export function usePassengerCounts() {
  const n = useApi('/notifications', { on: ['notification', 'notifications:read'] });
  return { unread: n.data?.filter((x) => !x.isRead).length || 0 };
}

export const passengerMenu = [
  { to: '', label: 'Dashboard', icon: 'home' },
  { to: 'tracking', label: 'Live tracking', icon: 'pin' },
  { to: 'history', label: 'Ride history', icon: 'clock' },
  { to: 'messages', label: 'Messages', icon: 'chat' },
  { to: 'wallet', label: 'Wallet & payments', icon: 'wallet' },
  { to: 'safety', label: 'Safety centre', icon: 'shield' },
  { to: 'notifications', label: 'Notifications', icon: 'bell', count: 'unread' },
  { to: 'support', label: 'Help & support', icon: 'ticket' },
  { to: 'profile', label: 'Profile', icon: 'user' },
  { to: 'settings', label: 'Settings', icon: 'gear' },
];

export const passengerRoutes = [
  ['', Dashboard], ['tracking', LiveTracking], ['history', History], ['messages', () => <Messages role="passenger" />],
  ['wallet', Wallet], ['safety', Safety], ['notifications', Notifications], ['support', SupportTickets], ['profile', Profile], ['settings', Settings],
];
