import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Icon, PageHead } from './ui.jsx';
import { request, useApi, useLive, useOnce } from '../api.js';

// Masked chat with the other person on the current trip. Phone numbers are never exchanged.
// ponytail: "Masked call" is a demo button; upgrade path is Twilio number proxying.
export function Messages({ role }) {
  const active = useApi('/rides/active', { on: ['ride:update'] });
  const ride = active.data?.driver ? active.data : null; // chat opens once a driver is assigned
  const log = useApi(ride ? `/rides/${ride._id}/messages` : null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const end = useRef(null);
  const [once, sending] = useOnce();

  useLive(({ type, data }) => {
    if (type === 'chat:message' && ride && data.ride === ride._id) {
      log.setData((list) => (list?.some((m) => m._id === data._id) ? list : [...(list || []), data]));
    }
  });
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [log.data?.length]);

  const send = (e) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    once(async () => {
      setError('');
      try {
        const msg = await request(`/rides/${ride._id}/messages`, { method: 'POST', body: { message } });
        log.setData((list) => (list?.some((m) => m._id === msg._id) ? list : [...(list || []), msg]));
        setText('');
      } catch (err) {
        setError(err.message);
      }
    });
  };

  const other = role === 'passenger' ? ride && `${ride.driver.name} · ${ride.driver.vehiclePlate}` : ride?.user?.name;
  return (
    <>
      <PageHead title="Messages" sub="Masked chat: your number is never shared" />
      {!ride ? (
        <Card>
          <Empty loading={active.loading && !active.data} error={active.error}>Chat opens when a driver is assigned to your ride.</Empty>
          <Link className="btn btn-primary" style={{ marginTop: '1rem' }} to={role === 'passenger' ? '/app' : '/driver'}>{role === 'passenger' ? 'Book a ride' : 'Find requests'}</Link>
        </Card>
      ) : (
        <Card title={other} action={<button className="btn btn-ghost btn-sm" onClick={() => alert('Masked calling connects you through a SheRides number. (Demo — not wired to a phone provider.)')}><Icon name="phone" size={16} /> Masked call</button>}>
          <div className="chat">
            <div className="chat-log" aria-live="polite">
              {!log.data?.length && <p className="muted small" style={{ textAlign: 'center' }}>{log.loading ? 'Loading…' : 'No messages yet. Say hello!'}</p>}
              {log.data?.map((m) => (
                <div key={m._id} className={`bubble ${m.sender === role ? 'me' : 'them'}`}>
                  {m.message}<time>{new Date(m.sentAt).toTimeString().slice(0, 5)}</time>
                </div>
              ))}
              <div ref={end} />
            </div>
            {error && <div className="error" role="alert">{error}</div>}
            <form className="row" onSubmit={send}>
              <input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" maxLength={500} />
              <button className="btn btn-primary" aria-label="Send" disabled={sending || !text.trim()}><Icon name="send" /></button>
            </form>
          </div>
        </Card>
      )}
    </>
  );
}
