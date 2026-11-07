import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Bars, Card, Empty, Icon, inr, PageHead, Stat } from '../components/ui.jsx';
import { MapView } from '../components/MapView.jsx';
import { fmtDate, localEmit, openFile, request, TIER_NAME, useApi, useLive } from '../api.js';
import { STATE_LABEL } from '../constants.js';

const sosTint = { background: 'rgba(229,56,59,.2)', color: 'var(--sos)' };
const LIVE = ['ride:update', 'deviation:alert'];

// Active rides with live driver positions (WebSocket `driver:location` moves the pins without refetching).
function useLiveRides() {
  const rides = useApi('/admin/rides', { on: LIVE });
  const [pos, setPos] = useState({});
  useLive(({ type, data }) => {
    if (type === 'driver:location') setPos((p) => ({ ...p, [data.rideId]: data }));
  });
  const list = (rides.data || []).map((r) => {
    const live = pos[r._id];
    return { ...r, car: live || (r.driver?.location?.lat != null ? r.driver.location : null), deviated: live ? live.deviated : r.deviated };
  });
  return { ...rides, list };
}
const rideMarkers = (list) => list.flatMap((r) => (r.car
  ? [{ pos: [r.car.lat, r.car.lng], kind: r.deviated ? 'sos' : 'car', label: `${r.user?.name} · ${r.driver?.name}${r.deviated ? ' · OFF ROUTE' : ''}` }]
  : [{ pos: [r.pickup.lat, r.pickup.lng], kind: 'pickup', label: `${r.user?.name} · ${STATE_LABEL[r.status]}` }]));

function Dashboard() {
  const reports = useApi('/admin/reports', { on: ['ride:update', 'sos:alert'] });
  const sos = useApi('/admin/sos?status=active', { on: ['sos:alert'] });
  const rides = useLiveRides();
  const r = reports.data;
  const active = sos.data || [];
  return (
    <>
      <PageHead title="Control room" sub="Live overview of SheRides" />
      {reports.error && <div className="error" role="alert">{reports.error}</div>}
      <div className="grid g4" style={{ marginBottom: '1.1rem' }}>
        <Stat icon="car" label="Live rides" value={r ? r.active : '…'} />
        <Stat icon="users" label="Pending drivers" value={r ? r.pendingDrivers : '…'} />
        <Stat icon="alert" label="Active SOS" value={r ? r.sosActive : '…'} />
        <Stat icon="ticket" label="Open complaints" value={r ? r.openComplaints : '…'} />
      </div>
      {active.map((s) => (
        <div key={s._id} className="card row alert-card" style={{ marginBottom: '1.1rem' }} role="alert">
          <div className="stat-icon" style={sosTint}><Icon name="alert" /></div>
          <div className="grow"><strong>SOS active — {s.user?.name || s.driver?.name} ({s.raisedBy})</strong><div className="muted small">{s.driver ? `Driver ${s.driver.name} · ${s.driver.vehiclePlate} · ` : ''}{fmtDate(s.triggeredAt)}</div></div>
          <Link className="btn btn-sos btn-sm" to="/admin/sos">View</Link>
        </div>
      ))}
      <div className="grid g2">
        <Card title="Live rides" action={<Link className="small" to="/admin/rides">Open</Link>}>
          <MapView height={300} markers={rideMarkers(rides.list)} />
          {!rides.list.length && <p className="muted small" style={{ marginTop: '.6rem' }}>{rides.loading ? 'Loading…' : 'No rides in progress.'}</p>}
        </Card>
        <Card title="Completed rides per month">{r ? <Bars data={r.monthly} label={(d) => d.m} value={(d) => d.n} /> : <Empty loading={reports.loading} />}</Card>
      </div>
    </>
  );
}

const FILTERS = ['pending', 'approved', 'rejected', 'all'];

function Drivers() {
  const [filter, setFilter] = useState('pending');
  const { data: list, error: loadError, loading, setData } = useApi(`/admin/drivers?status=${filter}`);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Whole account (path '') or one document (`/documents/<id>`).
  const save = async (d, path, body) => {
    setError('');
    setBusyId(d._id);
    try {
      const updated = await request(`/admin/drivers/${d._id}${path}`, { method: 'PUT', body });
      // Still matches this tab (the "all" tab, or docs approved for an already-approved driver) → update in place.
      const stays = filter === 'all' || filter === updated.verificationStatus;
      setData(stays ? list.map((x) => (x._id === d._id ? updated : x)) : list.filter((x) => x._id !== d._id));
      localEmit('drivers:changed');
    } catch (err) {
      setError(`${d.name}: ${err.message}`);
    }
    setBusyId(null);
  };
  const decide = (d, verificationStatus) => save(d, '', { verificationStatus });
  const reviewDoc = (d, doc, status) => save(d, `/documents/${doc._id}`, { status });
  const block = (d) => {
    const status = d.status === 'blocked' ? 'active' : 'blocked';
    if (status === 'blocked' && !window.confirm(`Block ${d.name}? She goes offline and cannot sign in or take new rides. A ride she accepted but has not started is cancelled; one already under way continues (cancel it from Live rides if needed).`)) return;
    save(d, '/status', { status });
  };

  return (
    <>
      <PageHead title="Driver approvals" sub="Review KYC documents before drivers can go online" />
      <div className="tabs" role="tablist" style={{ maxWidth: 480 }}>
        {FILTERS.map((f) => <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => { setFilter(f); setError(''); }}>{f}</button>)}
      </div>
      {(error || loadError) && <div className="error" role="alert">{error || loadError}</div>}
      <Card>
        {loading && !list ? <p className="muted">Loading…</p> : !list?.length ? <p className="muted">No {filter === 'all' ? '' : filter} drivers.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Vehicle</th><th>Plate</th><th>Documents</th><th>Applied</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d._id}>
                    <td><strong>{d.name}</strong><div className="muted small">{d.email}</div></td>
                    <td>{d.vehicleModel}</td><td>{d.vehiclePlate}</td>
                    <td>
                      {d.documents.length ? (
                        <ul className="doc-list">
                          {d.documents.map((doc) => (
                            <li key={doc._id}>
                              <button className="btn btn-ghost btn-sm" onClick={() => openFile(doc.path)} title="Open document">{doc.type}</button>
                              <Badge value={doc.status} />
                              {doc.status !== 'approved' && <button className="icon-btn ok" disabled={busyId === d._id} onClick={() => reviewDoc(d, doc, 'approved')} aria-label={`Approve ${doc.type}`} title={`Approve ${doc.type}`}><Icon name="check" size={16} /></button>}
                              {doc.status !== 'rejected' && <button className="icon-btn bad" disabled={busyId === d._id} onClick={() => reviewDoc(d, doc, 'rejected')} aria-label={`Reject ${doc.type}`} title={`Reject ${doc.type}`}><Icon name="x" size={16} /></button>}
                            </li>
                          ))}
                        </ul>
                      ) : <span className="muted small">None uploaded</span>}
                    </td>
                    <td>{new Date(d.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                    <td><Badge value={d.verificationStatus} />{d.status === 'blocked' && <> <Badge value="blocked" /></>}</td>
                    <td>
                      <div className="row">
                        {/* Approving the account approves all its documents; shown again if any document still needs it. */}
                        {(d.verificationStatus !== 'approved' || d.documents.some((x) => x.status !== 'approved')) && (
                          <button className="btn btn-ok btn-sm" disabled={busyId === d._id} onClick={() => decide(d, 'approved')}>{d.verificationStatus === 'approved' ? 'Approve all docs' : 'Approve'}</button>
                        )}
                        {d.verificationStatus !== 'rejected' && <button className="btn btn-ghost btn-sm" disabled={busyId === d._id} onClick={() => decide(d, 'rejected')}>Reject</button>}
                        <button className={`btn btn-sm ${d.status === 'blocked' ? 'btn-ok' : 'btn-ghost'}`} disabled={busyId === d._id} onClick={() => block(d)}>{d.status === 'blocked' ? 'Unblock' : 'Block'}</button>
                      </div>
                    </td>
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

function Users() {
  const { data, loading, error, setData } = useApi('/admin/users');
  const [msg, setMsg] = useState('');
  const flip = async (u) => {
    const status = u.status === 'blocked' ? 'active' : 'blocked';
    if (status === 'blocked' && !window.confirm(`Block ${u.name}? She will not be able to sign in or book.`)) return;
    setMsg('');
    try {
      const updated = await request(`/admin/users/${u._id}`, { method: 'PUT', body: { status } });
      setData((list) => list.map((x) => (x._id === u._id ? { ...x, status: updated.status } : x)));
    } catch (err) {
      setMsg(err.message);
    }
  };
  return (
    <>
      <PageHead title="Users" sub="Passengers" />
      {msg && <div className="error" role="alert">{msg}</div>}
      <Card>
        {!data?.length ? <Empty loading={loading} error={error}>No passengers yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Rides</th><th>Wallet</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u._id}>
                    <td>{u.name}</td><td>{u.email}</td><td>{u.phone}</td><td>{u.rides}</td><td>{inr(u.walletBalance)}</td><td><Badge value={u.status} /></td>
                    <td><button className={`btn btn-sm ${u.status === 'blocked' ? 'btn-ok' : 'btn-ghost'}`} onClick={() => flip(u)}>{u.status === 'blocked' ? 'Unblock' : 'Block'}</button></td>
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

function Rides() {
  const rides = useLiveRides();
  const config = useApi('/safety/config');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  // For rides nobody else can end (e.g. the driver vanished after the OTP). No fare is charged.
  const cancel = async (r) => {
    const reason = window.prompt(`Cancel ${r.user?.name}'s ride? No fare is charged. Reason (optional):`, '');
    if (reason === null) return;
    setError('');
    setBusyId(r._id);
    try {
      await request(`/admin/rides/${r._id}/cancel`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} });
      rides.reload();
    } catch (err) {
      setError(err.message);
    }
    setBusyId(null);
  };
  return (
    <>
      <PageHead title="Live rides" sub={`Red pins are more than ${config.data?.deviationM ?? 500} m off the planned route`} />
      <Card style={{ marginBottom: '1.1rem' }}><MapView height={380} markers={rideMarkers(rides.list)} circle={config.data?.serviceArea} /></Card>
      {error && <div className="error" role="alert">{error}</div>}
      <Card>
        {!rides.list.length ? <Empty loading={rides.loading} error={rides.error}>No rides in progress.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Passenger</th><th>Driver</th><th>Tier</th><th>Route</th><th>Status</th><th>Safety</th><th /></tr></thead>
              <tbody>
                {rides.list.map((r) => (
                  <tr key={r._id}>
                    <td>{r.user?.name}</td><td>{r.driver ? `${r.driver.name} · ${r.driver.vehiclePlate}` : '—'}</td><td>{TIER_NAME[r.tier]}</td>
                    <td className="small">{r.pickup.address} → {r.drop.address}</td>
                    <td><Badge value={r.status} /></td>
                    <td>{r.deviated ? <Badge value="deviation" label="Off route" /> : <Badge value="active" label="On route" />}</td>
                    <td><button className="btn btn-ghost btn-sm" disabled={busyId === r._id} onClick={() => cancel(r)}>Cancel</button></td>
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

function Complaints() {
  const { data, loading, error, setData } = useApi('/admin/complaints');
  const [msg, setMsg] = useState('');
  const save = async (c, patch) => {
    setMsg('');
    try {
      const updated = await request(`/admin/complaints/${c._id}`, { method: 'PUT', body: patch });
      setData((list) => list.map((x) => (x._id === c._id ? { ...x, ...updated, ride: x.ride } : x)));
    } catch (err) {
      setMsg(err.message);
    }
  };
  return (
    <>
      <PageHead title="Complaints & disputes" />
      {msg && <div className="error" role="alert">{msg}</div>}
      <Card>
        {!data?.length ? <Empty loading={loading} error={error}>No complaints.</Empty> : (
          <ul className="list">
            {data.map((c) => (
              <li key={c._id} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <strong>{c.ride ? `${c.ride.pickup.address} → ${c.ride.drop.address}` : 'Ride'}</strong>
                  <div className="muted small">Raised by {c.raisedBy} · passenger {c.ride?.user?.name || '—'} · driver {c.ride?.driver?.name || '—'} · {fmtDate(c.createdAt)}</div>
                  <p style={{ margin: '.4rem 0' }}>{c.description}</p>
                  <input aria-label="Resolution notes" placeholder="Resolution notes" maxLength={1000} defaultValue={c.resolutionNotes || ''}
                    onBlur={(e) => e.target.value !== (c.resolutionNotes || '') && save(c, { resolutionNotes: e.target.value })} />
                </div>
                <select aria-label="Complaint status" value={c.status} className="select-sm" onChange={(e) => save(c, { status: e.target.value })}>
                  {['open', 'investigating', 'resolved'].map((s) => <option key={s}>{s}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Sos() {
  const { data, loading, error, reload } = useApi('/admin/sos', { on: ['sos:alert'] });
  const [msg, setMsg] = useState('');
  const resolve = async (s) => {
    setMsg('');
    try {
      await request(`/sos/${s._id}/resolve`, { method: 'POST' });
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  };
  const located = (data || []).filter((s) => s.status === 'active' && s.location?.lat != null);
  return (
    <>
      <PageHead title="SOS alerts" sub="Contacts were emailed automatically; resolve once the person is safe" />
      {msg && <div className="error" role="alert">{msg}</div>}
      {located.length > 0 && <Card style={{ marginBottom: '1.1rem' }}><MapView height={300} markers={located.map((s) => ({ pos: [s.location.lat, s.location.lng], kind: 'sos', label: s.user?.name || s.driver?.name }))} /></Card>}
      <Card>
        {!data?.length ? <Empty loading={loading} error={error}>No SOS alerts.</Empty> : (
          <ul className="list">
            {data.map((s) => (
              <li key={s._id}>
                <div className="stat-icon" style={sosTint}><Icon name="alert" /></div>
                <div className="grow">
                  <strong>{s.user?.name || '—'}{s.raisedBy === 'driver' ? ` · raised by driver ${s.driver?.name}` : ''}</strong>
                  <div className="muted small">
                    {s.driver ? `Driver ${s.driver.name} · ${s.driver.vehicleModel} · ${s.driver.vehiclePlate} · ` : ''}
                    {s.ride ? `${s.ride.pickup.address} → ${s.ride.drop.address} · ` : ''}{fmtDate(s.triggeredAt)}
                  </div>
                  {s.location?.lat != null && <a className="small" href={`https://www.openstreetmap.org/?mlat=${s.location.lat}&mlon=${s.location.lng}#map=17/${s.location.lat}/${s.location.lng}`} target="_blank" rel="noreferrer">Open location</a>}
                </div>
                <Badge value={s.status === 'active' ? 'sos' : 'resolved'} label={s.status === 'active' ? 'Active' : 'Resolved'} />
                {s.status === 'active' && <button className="btn btn-ok btn-sm" onClick={() => resolve(s)}>Resolve</button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Zones() {
  const { data, loading, error } = useApi('/safety/config');
  const pad = (h) => String(h).padStart(2, '0');
  return (
    <>
      <PageHead title="Safety zones & geo-fence" sub="Rules the server enforces on every booking and trip" />
      <div className="grid g2">
        <Card>{data ? <MapView height={360} circle={data.serviceArea} /> : <Empty loading={loading} error={error} />}</Card>
        <Card title="Active rules">
          {data && (
            <ul className="list">
              <li><div className="stat-icon"><Icon name="shield" /></div><div className="grow"><strong>Night geo-fence</strong><div className="muted small">{pad(data.night.startHour)}:00 – {pad(data.night.endHour)}:00 IST: pickup and drop must be within {data.serviceArea.radiusKm} km of {data.serviceArea.name} centre</div></div><Badge value="active" label="On" /></li>
              <li><div className="stat-icon"><Icon name="shield" /></div><div className="grow"><strong>Night Guardian tier</strong><div className="muted small">Always geo-fenced, at any hour, and monitored live here</div></div><Badge value="active" label="On" /></li>
              <li><div className="stat-icon"><Icon name="route" /></div><div className="grow"><strong>Route deviation</strong><div className="muted small">Alert passenger + control room when the car is more than {data.deviationM} m off the planned route</div></div><Badge value="active" label="On" /></li>
            </ul>
          )}
          {/* ponytail: one fixed service area from server config. Upgrade: admin-editable polygons stored in Mongo. */}
        </Card>
      </div>
    </>
  );
}

function Reports() {
  const { data: r, loading, error } = useApi('/admin/reports', { on: ['ride:update'] });
  if (!r) return <><PageHead title="Reports" /><Card><Empty loading={loading} error={error} /></Card></>;
  return (
    <>
      <PageHead title="Reports" sub="All time" />
      <div className="grid g4" style={{ marginBottom: '1.1rem' }}>
        <Stat icon="car" label="Completed rides" value={r.completed} />
        <Stat icon="wallet" label="Gross fares" value={inr(r.grossFares)} />
        <Stat icon="alert" label="SOS resolved" value={`${r.sosResolvedPct}%`} />
        <Stat icon="star" label="Avg driver rating" value={r.avgRating ?? '—'} />
      </div>
      <div className="grid g4" style={{ marginBottom: '1.1rem' }}>
        <Stat icon="users" label="Passengers" value={r.users} />
        <Stat icon="car" label="Approved drivers" value={r.drivers} />
        <Stat icon="x" label="Cancelled rides" value={r.cancelled} />
        <Stat icon="ticket" label="Open complaints" value={r.openComplaints} />
      </div>
      <Card title="Completed rides per month"><Bars data={r.monthly} label={(d) => d.m} value={(d) => d.n} /></Card>
    </>
  );
}

// Sidebar badges: drivers waiting for approval and active SOS alerts.
function useAdminCounts() {
  const r = useApi('/admin/reports', { on: ['sos:alert', 'ride:update', 'drivers:changed'] });
  return { pending: r.data?.pendingDrivers || 0, sos: r.data?.sosActive || 0 };
}

export const admin = {
  useCounts: useAdminCounts,
  menu: [
    { to: '', label: 'Dashboard', icon: 'chart' },
    { to: 'drivers', label: 'Driver approvals', icon: 'users', count: 'pending' },
    { to: 'users', label: 'Users', icon: 'user' },
    { to: 'rides', label: 'Live rides', icon: 'pin' },
    { to: 'complaints', label: 'Complaints', icon: 'ticket' },
    { to: 'sos', label: 'SOS alerts', icon: 'alert', count: 'sos' },
    { to: 'zones', label: 'Safety zones', icon: 'shield' },
    { to: 'reports', label: 'Reports', icon: 'chart' },
  ],
  routes: [
    ['', Dashboard], ['drivers', Drivers], ['users', Users], ['rides', Rides],
    ['complaints', Complaints], ['sos', Sos], ['zones', Zones], ['reports', Reports],
  ],
};
