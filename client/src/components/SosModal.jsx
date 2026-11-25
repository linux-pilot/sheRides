import { useEffect, useState } from 'react';
import { Badge, Icon } from './ui.jsx';
import { liveSend, request, useApi } from '../api.js';

// Browser location once, or null after `ms`. The hard timer matters: the geolocation `timeout` does not
// count time spent on an unanswered permission prompt, and SOS must never wait on that.
const currentPosition = (ms = 3000) => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  setTimeout(() => resolve(null), ms);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: ms, maximumAge: 30000 },
  );
});

// One tap raises SOS on the server, which emails emergency contacts (location, driver, vehicle) and alerts
// the admin control room. While open, the browser streams its location every 15 s.
// ponytail: police control room call is mocked; upgrade path is Twilio.
export function SosModal({ role, onClose }) {
  const me = useApi(role === 'passenger' ? '/me' : null);
  const [sos, setSos] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const loc = await currentPosition();
      try {
        const alert = await request('/sos', { method: 'POST', body: loc || {} });
        if (alive) setSos(alert);
      } catch (err) {
        if (alive) setError(`${err.message} — call 112 now.`);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!sos || !navigator.geolocation) return undefined;
    let last = 0;
    const watch = navigator.geolocation.watchPosition((p) => {
      if (Date.now() - last < 15000) return;
      last = Date.now();
      liveSend('sos:location', { lat: p.coords.latitude, lng: p.coords.longitude });
    }, () => {}, { enableHighAccuracy: true });
    return () => navigator.geolocation.clearWatch(watch);
  }, [sos]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const standDown = async () => {
    if (!sos) return onClose();
    setBusy(true);
    try {
      await request(`/sos/${sos._id}/resolve`, { method: 'POST' });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const contacts = me.data?.user?.emergencyContacts || [];
  const sent = !!sos;
  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="sos-title" aria-describedby="sos-desc">
      <div className="modal">
        <div className="sos-ring">SOS</div>
        <h2 id="sos-title" style={{ textAlign: 'center' }}>{sent ? 'SOS alert sent' : error ? 'SOS failed' : 'Sending SOS…'}</h2>
        <p id="sos-desc" className="muted small" style={{ textAlign: 'center' }}>
          {role === 'passenger'
            ? 'Your live location, driver and vehicle details go to your emergency contacts and the SheRides control room.'
            : 'Your location and trip details go to the SheRides control room.'}
        </p>
        {error && <div className="error" role="alert">{error}</div>}
        <ul className="list">
          {contacts.map((c) => (
            <li key={c._id}>
              <div className="avatar">{c.name[0]}</div>
              <div className="grow"><strong>{c.name}</strong><div className="muted small">{c.relation} · {c.email}</div></div>
              {sent ? <Badge value="completed" label="Emailed" /> : <Badge value="pending" label="Sending…" />}
            </li>
          ))}
          {role === 'passenger' && me.data && !contacts.length && <li className="muted small">No emergency contacts saved — add them in Safety centre.</li>}
          <li>
            <div className="avatar" style={{ background: 'var(--sos)', color: '#fff' }}><Icon name="shield" size={18} /></div>
            <div className="grow"><strong>SheRides control room</strong><div className="muted small">Admin team, live</div></div>
            {sent ? <Badge value="completed" label="Alerted" /> : <Badge value="pending" label="Sending…" />}
          </li>
          <li>
            <div className="avatar" style={{ background: 'var(--sos)', color: '#fff' }}><Icon name="phone" size={18} /></div>
            <div className="grow"><strong>Police control room</strong><div className="muted small">112 · demo call</div></div>
            <Badge value="cancelled" label="Calling…" />
          </li>
        </ul>
        {/* Locked while sending: closing before the alert exists would let it go out with no stand-down. */}
        <button className="btn btn-ok btn-block" style={{ marginTop: '1.2rem' }} onClick={standDown} disabled={busy || (!sos && !error)} autoFocus>
          <Icon name="check" /> I am safe — stand down
        </button>
      </div>
    </div>
  );
}
