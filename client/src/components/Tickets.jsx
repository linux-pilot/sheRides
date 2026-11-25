import { useState } from 'react';
import { Badge, Card, Empty, fmtDate, PageHead } from './ui.jsx';
import { request, useAction, useApi } from '../api.js';
import { TICKET_CATEGORIES } from '../constants.js';

export function SupportTickets() {
  const { data, loading, error, setData } = useApi('/tickets', { on: ['ticket:update'] });
  const blank = { subject: '', category: 'Ride', message: '' };
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState('');
  const { run: once, busy: sending } = useAction();
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
