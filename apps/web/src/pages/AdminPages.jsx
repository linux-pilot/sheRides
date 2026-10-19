import React, { useState } from 'react';
import Helmet from 'react-helmet';
import { AlertTriangle, IdCard, LifeBuoy, ShieldCheck, Users } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { Btn, Chip, Empty, Panel, SectionTitle, Stat, inputCls } from '@/lib/kit';
import MapPanel from '@/components/MapPanel';

export const AdminDashboard = () => {
	const { users, kyc, complaints } = useApp();
	const cities = [['Mumbai', 62], ['Pune', 21], ['Bengaluru', 11], ['Delhi NCR', 6]];
	return (
		<div className="space-y-6">
			<Helmet>
				<title>Control room · SheRides admin</title>
				<meta name="description" content="SheRides operations control room with live ride monitoring, KYC queue, complaints and platform analytics." />
			</Helmet>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Stat label="Live rides" value="1,284" delta="38 cities" icon={ShieldCheck} tone="info" />
				<Stat label="Registered users" value={`${users.length + 48216}`} delta="+412 this week" icon={Users} />
				<Stat label="KYC pending" value={kyc.filter((k) => k.status !== 'Approved').length} delta="SLA 24 hours" icon={IdCard} tone="safe" />
				<Stat label="Open complaints" value={complaints.filter((c) => c.status !== 'Resolved').length} delta="1 high priority" icon={AlertTriangle} tone="danger" />
			</div>
			<div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
				<MapPanel height="h-[360px]" progress={62} from="Powai" to="Nariman Point" label="Live fleet heat map" pins={[{ left: '30%', top: '40%' }, { left: '58%', top: '28%' }, { left: '72%', top: '62%' }, { left: '44%', top: '70%' }]} />
				<Panel>
					<SectionTitle title="Rides by city" subtitle="Share of active trips right now." />
					<div className="space-y-4">
						{cities.map(([c, pct]) => (
							<div key={c}>
								<div className="flex justify-between text-sm"><span>{c}</span><span className="text-muted-foreground">{pct}%</span></div>
								<div className="mt-2 h-2 rounded-full bg-white/10">
									<div className="h-2 rounded-full bg-[#5DD62C]" style={{ width: `${pct}%` }} />
								</div>
							</div>
						))}
					</div>
					<div className="mt-6 grid grid-cols-2 gap-3 text-sm">
						{[['SOS raised (24h)', '7'], ['Deviation alerts', '31'], ['Avg response', '2.1 s'], ['Resolved today', '19']].map(([k, v]) => (
							<div key={k} className="rounded-2xl bg-white/[0.05] px-4 py-3">
								<p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
								<p className="mt-1 font-display text-lg font-semibold">{v}</p>
							</div>
						))}
					</div>
				</Panel>
			</div>
		</div>
	);
};

export const AdminUsersPage = () => {
	const { users, setUserStatus } = useApp();
	const [q, setQ] = useState('');
	const [role, setRole] = useState('All');
	const list = users.filter((u) => (role === 'All' || u.role === role) && `${u.id} ${u.name} ${u.city}`.toLowerCase().includes(q.toLowerCase()));
	return (
		<Panel>
			<Helmet>
				<title>Users and drivers · SheRides admin</title>
				<meta name="description" content="Search, filter, suspend or reactivate SheRides passengers and verified drivers." />
			</Helmet>
			<SectionTitle title="Users and drivers" subtitle="Suspend or reactivate accounts instantly." />
			<div className="mb-5 flex flex-wrap gap-3">
				<input className={`${inputCls} min-w-[14rem] flex-1`} placeholder="Search by name, ID or city" value={q} onChange={(e) => setQ(e.target.value)} />
				{['All', 'Passenger', 'Driver'].map((r) => (
					<button key={r} onClick={() => setRole(r)} className={`min-h-[44px] rounded-full px-4 text-xs font-semibold ${role === r ? 'bg-white/[0.14]' : 'bg-white/[0.05] text-muted-foreground'}`}>{r}</button>
				))}
			</div>
			{list.length === 0 ? <Empty icon={Users} title="No accounts match" body="Try a different search term or filter." /> : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[46rem] text-sm">
						<thead className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
							<tr><th className="pb-3">Account</th><th className="pb-3">Role</th><th className="pb-3">City</th><th className="pb-3">Rides</th><th className="pb-3">Status</th><th className="pb-3" /></tr>
						</thead>
						<tbody className="divide-y divide-white/10">
							{list.map((u) => (
								<tr key={u.id}>
									<td className="py-3.5"><span className="font-semibold">{u.name}</span><span className="block text-xs text-muted-foreground">{u.id} · joined {u.joined}</span></td>
									<td>{u.role}</td><td>{u.city}</td><td>{u.rides}</td>
									<td><Chip tone={u.status === 'Active' ? 'safe' : 'danger'}>{u.status}</Chip></td>
									<td className="text-right">
										<Btn variant={u.status === 'Active' ? 'ghost' : 'safe'} className="px-4 text-xs" onClick={() => setUserStatus(u.id, u.status === 'Active' ? 'Suspended' : 'Active')}>
											{u.status === 'Active' ? 'Suspend' : 'Reactivate'}
										</Btn>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Panel>
	);
};

export const AdminRidesPage = () => {
	const live = [
		{ id: 'SR-48311', rider: 'Aarushi N.', driver: 'Meera K.', route: 'Powai → Nariman Point', status: 'En route', flag: null },
		{ id: 'SR-48309', rider: 'Sneha I.', driver: 'Jyoti P.', route: 'Baner → Kharadi', status: 'OTP verified', flag: null },
		{ id: 'SR-48302', rider: 'Divya S.', driver: 'Rukhsar S.', route: 'Kurla → Chembur', status: 'En route', flag: 'Route deviation 620 m' },
	];
	return (
		<div className="space-y-6">
			<Helmet>
				<title>Live ride monitoring · SheRides admin</title>
				<meta name="description" content="Monitor every live SheRides trip, deviation flag and safety alert from the operations console." />
			</Helmet>
			<MapPanel height="h-[340px]" progress={70} from="Kurla Depot" to="Chembur Colony" safe={false} label="Flagged trip SR-48302" />
			<Panel>
				<SectionTitle title="Live rides" subtitle="Flagged trips are escalated to the on-duty safety officer." />
				<div className="divide-y divide-white/10">
					{live.map((r) => (
						<div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<p className="text-sm font-semibold">{r.route}</p>
								<p className="mt-1 text-xs text-muted-foreground">{r.id} · {r.rider} with {r.driver}</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								{r.flag && <Chip tone="danger"><AlertTriangle className="h-3.5 w-3.5" /> {r.flag}</Chip>}
								<Chip tone="info">{r.status}</Chip>
								<Btn variant="soft" className="px-4 text-xs">Open trip</Btn>
							</div>
						</div>
					))}
				</div>
			</Panel>
		</div>
	);
};

export const AdminKycPage = () => {
	const { kyc, setKycStatus } = useApp();
	return (
		<Panel>
			<Helmet>
				<title>Driver KYC verification · SheRides admin</title>
				<meta name="description" content="Approve or reject SheRides driver KYC submissions with licence, RC and police clearance checks." />
			</Helmet>
			<SectionTitle title="Driver KYC queue" subtitle="Approve only when all five documents pass verification." />
			<div className="space-y-4">
				{kyc.map((k) => (
					<div key={k.id} className="rounded-3xl border border-white/10 bg-black/25 p-5">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p className="font-display text-base font-semibold">{k.name}</p>
								<p className="mt-1 text-xs text-muted-foreground">{k.id} · {k.vehicle} · Licence {k.licence} · submitted {k.submitted}</p>
							</div>
							<Chip tone={k.status === 'Approved' ? 'safe' : k.status === 'Rejected' ? 'danger' : 'warn'}>{k.status}</Chip>
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							{k.docs.map((d) => <Chip key={d} tone="info">{d}</Chip>)}
						</div>
						{k.status !== 'Approved' && (
							<div className="mt-4 flex flex-wrap gap-3">
								<Btn variant="safe" onClick={() => setKycStatus(k.id, 'Approved')}>Approve driver</Btn>
								<Btn variant="ghost" onClick={() => setKycStatus(k.id, 'Rejected')}>Reject</Btn>
							</div>
						)}
					</div>
				))}
			</div>
		</Panel>
	);
};

export const AdminComplaintsPage = () => {
	const { complaints, setComplaintStatus } = useApp();
	const [filter, setFilter] = useState('All');
	const list = complaints.filter((c) => filter === 'All' || c.status === filter);
	return (
		<Panel>
			<Helmet>
				<title>Complaint resolution · SheRides admin</title>
				<meta name="description" content="Triage and resolve SheRides passenger and driver complaints by priority and category." />
			</Helmet>
			<SectionTitle title="Complaint resolution" subtitle="High priority safety cases must be closed within 4 hours." />
			<div className="mb-5 flex flex-wrap gap-2">
				{['All', 'Open', 'In progress', 'Resolved'].map((f) => (
					<button key={f} onClick={() => setFilter(f)} className={`min-h-[44px] rounded-full px-4 text-xs font-semibold ${filter === f ? 'bg-white/[0.14]' : 'bg-white/[0.05] text-muted-foreground'}`}>{f}</button>
				))}
			</div>
			{list.length === 0 ? <Empty icon={LifeBuoy} title="Nothing in this queue" body="All complaints in this state have been cleared." /> : (
				<div className="space-y-4">
					{list.map((c) => (
						<div key={c.id} className="rounded-3xl border border-white/10 bg-black/25 p-5">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<p className="font-display text-sm font-semibold">{c.category} · {c.id}</p>
								<div className="flex gap-2">
									<Chip tone={c.priority === 'High' ? 'danger' : c.priority === 'Medium' ? 'warn' : 'neutral'}>{c.priority}</Chip>
									<Chip tone={c.status === 'Resolved' ? 'safe' : 'info'}>{c.status}</Chip>
								</div>
							</div>
							<p className="mt-2 text-sm text-muted-foreground">{c.detail}</p>
							<p className="mt-2 text-xs text-muted-foreground">Raised by {c.from} against {c.against} on {c.opened}</p>
							{c.status !== 'Resolved' && (
								<div className="mt-4 flex flex-wrap gap-3">
									<Btn variant="safe" onClick={() => setComplaintStatus(c.id, 'Resolved')}>Mark resolved</Btn>
									<Btn variant="soft" onClick={() => setComplaintStatus(c.id, 'In progress')}>Assign to officer</Btn>
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</Panel>
	);
};
