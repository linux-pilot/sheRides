import { useEffect, useState } from 'react';
import { Badge, Card, Empty, PageHead, Stat } from '../components/ui.jsx';
import { fmtDate, getSession, request, useApi } from '../api.js';

const STATUSES = ['open', 'in_progress', 'resolved'];
const LIVE = { on: ['ticket:update'] }; // server pushes every ticket create/update
const from = (t) => (t.user ? `${t.user.name} (passenger)` : t.driver ? `${t.driver.name} (driver)` : 'Unknown');

function TicketQueue({ resolved = false }) {
  const tickets = useApi(`/tickets?status=${resolved ? 'resolved' : 'all'}`, LIVE);
  const [notice, setNotice] = useState('');
  const team = useApi('/support/team');
  const shown = (tickets.data || []).filter((t) => (t.status === 'resolved') === resolved);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const t = shown.find((x) => x._id === sel) || shown[0];
  useEffect(() => { setDraft(t?.response || ''); setMsg({ error: '', ok: '' }); }, [t?._id]);

  const update = async (patch, ok) => {
    setMsg({ error: '', ok: '' });
    setNotice('');
    try {
      const updated = await request(`/tickets/${t._id}`, { method: 'PUT', body: patch });
      tickets.setData((list) => list.map((x) => (x._id === updated._id ? updated : x)));
      setSel(updated._id);
      // A ticket that leaves this view (resolved / reopened) would vanish silently; say where it went.
      if ((updated.status === 'resolved') !== resolved) setNotice(`"${updated.subject}" moved to ${resolved ? 'the queue' : 'history'}.`);
      else if (ok) setMsg({ error: '', ok });
    } catch (err) {
      setMsg({ error: err.message, ok: '' });
    }
  };

  return (
    <>
      <PageHead title={resolved ? 'Ticket history' : 'Ticket queue'} sub={tickets.data ? `${shown.length} tickets` : ''} />
      {notice && <p className="small" role="status" style={{ color: 'var(--ok)' }}>{notice}</p>}
      <div className="grid g3">
        <Card>
          {!shown.length ? <Empty loading={tickets.loading} error={tickets.error}>{resolved ? 'No resolved tickets yet.' : 'Queue is empty. Nice work!'}</Empty> : (
            <ul className="list">
              {shown.map((x) => (
                <li key={x._id}>
                  <button type="button" className={`list-btn ${x._id === t?._id ? 'active' : ''}`} onClick={() => setSel(x._id)} aria-pressed={x._id === t?._id}>
                    <span className="grow"><strong>{x.subject}</strong><span className="muted small" style={{ display: 'block' }}>{x.category} · {from(x)}</span></span>
                    <Badge value={x.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {t && (
          <Card title={t.subject} className="span2" action={<Badge value={t.status} />}>
            <p className="muted small">{from(t)} · {t.category} · opened {fmtDate(t.createdAt)}</p>
            <p>{t.message}</p>
            {msg.error && <div className="error" role="alert">{msg.error}</div>}
            {msg.ok && <p className="small" role="status" style={{ color: 'var(--ok)' }}>{msg.ok}</p>}
            <div className="grid g2" style={{ gap: '.75rem' }}>
              <div className="field"><label htmlFor="as">Assigned to</label>
                <select id="as" value={t.assignedTo?._id || ''} onChange={(e) => update({ assignedTo: e.target.value }, 'Assignment updated.')}>
                  <option value="">Unassigned</option>{(team.data || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                </select></div>
              <div className="field"><label htmlFor="st">Status</label>
                <select id="st" value={t.status} onChange={(e) => update({ status: e.target.value }, 'Status updated.')}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select></div>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); update({ response: draft.trim(), ...(t.status === 'open' ? { status: 'in_progress' } : {}) }, 'Response sent.'); }}>
              <div className="field"><label htmlFor="rs">Response</label><textarea id="rs" rows={4} maxLength={1000} required value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
              <button className="btn btn-primary" disabled={!draft.trim() || draft.trim() === (t.response || '')}>Send response</button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

function Dashboard() {
  const { data, loading, error } = useApi('/tickets?status=all', LIVE);
  const me = getSession()?.name;
  const list = data || [];
  const open = list.filter((t) => t.status !== 'resolved');
  return (
    <>
      <PageHead title="Support desk" sub="Tickets from passengers and drivers" />
      <div className="grid g3" style={{ marginBottom: '1.1rem' }}>
        <Stat icon="ticket" label="Open tickets" value={data ? open.length : '…'} />
        <Stat icon="user" label="Assigned to you" value={data ? open.filter((t) => t.assignedTo?.name === me).length : '…'} />
        <Stat icon="check" label="Resolved" value={data ? list.length - open.length : '…'} />
      </div>
      <Card title="Needs attention">
        {!open.length ? <Empty loading={loading} error={error}>No open tickets.</Empty> : (
          <ul className="list">{open.map((t) => <li key={t._id}><div className="grow"><strong>{t.subject}</strong><div className="muted small">{from(t)} · {t.assignedTo?.name || 'Unassigned'}</div></div><Badge value={t.status} /></li>)}</ul>
        )}
      </Card>
    </>
  );
}

function useSupportCounts() {
  const t = useApi('/tickets?status=open', LIVE);
  return { open: t.data?.length || 0 };
}

export const support = {
  useCounts: useSupportCounts,
  menu: [
    { to: '', label: 'Dashboard', icon: 'home' },
    { to: 'queue', label: 'Ticket queue', icon: 'ticket', count: 'open' },
    { to: 'history', label: 'History', icon: 'clock' },
  ],
  routes: [['', Dashboard], ['queue', () => <TicketQueue />], ['history', () => <TicketQueue resolved />]],
};
