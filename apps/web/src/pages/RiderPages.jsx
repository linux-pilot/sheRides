import React, { useMemo, useState } from 'react';
import Helmet from 'react-helmet';
import { Link } from 'react-router-dom';
import { Car, Clock, Filter, MapPin, Receipt, Search, Star, Wallet } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { Btn, Chip, Empty, Field, Panel, SectionTitle, Stat, inputCls } from '@/lib/kit';
import MapPanel from '@/components/MapPanel';
import { SosButton } from '@/components/AppShell';

const tiers = [
	{ id: 'lite', name: 'SheRides Lite', seats: 4, eta: '4 min', rate: 11, note: 'Hatchbacks, best value' },
	{ id: 'prime', name: 'SheRides Prime', seats: 4, eta: '6 min', rate: 15, note: 'Sedans, extra legroom' },
	{ id: 'night', name: 'Night Guardian', seats: 4, eta: '8 min', rate: 19, note: 'Geo-fenced corridor + live monitoring' },
];

export const RiderDashboard = () => {
	const { activeRide, walletBalance, rides } = useApp();
	const [pickup, setPickup] = useState('Hiranandani Gardens, Powai');
	const [drop, setDrop] = useState('Nariman Point, Mumbai');
	const [tier, setTier] = useState('prime');
	const [searched, setSearched] = useState(false);
	const [loading, setLoading] = useState(false);

	const distance = 21.4;
	const quote = useMemo(() => {
		const t = tiers.find((x) => x.id === tier);
		const base = 42;
		return Math.round(base + distance * t.rate + 26);
	}, [tier]);

	const search = (e) => {
		e.preventDefault();
		setLoading(true);
		setTimeout(() => { setLoading(false); setSearched(true); }, 550);
	};

	return (
		<div className="space-y-6">
			<Helmet>
				<title>Rider dashboard · SheRides</title>
				<meta name="description" content="Search rides, compare fare estimates and monitor your live SheRides trip from one safety-first dashboard." />
			</Helmet>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Stat label="Wallet balance" value={`₹${walletBalance.toLocaleString('en-IN')}`} delta="Auto-debit enabled" icon={Wallet} />
				<Stat label="Rides completed" value={rides.filter((r) => r.status === 'Completed').length + 79} delta="Since Nov 2025" icon={Car} tone="info" />
				<Stat label="Safety score" value="98 / 100" delta="Trusted contacts + OTP active" icon={MapPin} tone="safe" />
				<Stat label="Avg wait time" value="4.2 min" delta="Powai · evening peak" icon={Clock} />
			</div>

			<div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
				<Panel>
					<SectionTitle title="Where are you going?" subtitle="Fares are estimated before you book — no surprises at drop-off." />
					<form className="space-y-4" onSubmit={search}>
						<Field label="Pickup"><input className={inputCls} value={pickup} onChange={(e) => setPickup(e.target.value)} /></Field>
						<Field label="Destination"><input className={inputCls} value={drop} onChange={(e) => setDrop(e.target.value)} /></Field>
						<div className="space-y-2">
							{tiers.map((t) => (
								<button
									key={t.id} type="button" onClick={() => setTier(t.id)}
									className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left transition ${tier === t.id ? 'border-[#5DD62C] bg-[#5DD62C]/10 text-foreground' : 'border-white/10 bg-black/20 hover:bg-white/[0.05]'}`}
								>
									<span>
										<span className="block text-sm font-semibold">{t.name}</span>
										<span className="block text-xs text-muted-foreground">{t.note} · {t.seats} seats · {t.eta} away</span>
									</span>
									<span className="font-display text-sm font-semibold">₹{Math.round(42 + distance * t.rate + 26)}</span>
								</button>
							))}
						</div>
						<Btn type="submit" className="w-full" disabled={loading}>
							<Search className="h-4 w-4" />{loading ? 'Finding verified drivers…' : `Search rides · ₹${quote} est.`}
						</Btn>
					</form>
					{searched && (
						<div className="mt-5 rounded-2xl border border-[#337418]/50 bg-[#337418]/20 p-4 text-sm">
							<p className="font-semibold text-[#5DD62C]">3 verified women drivers nearby</p>
							<p className="mt-1 text-muted-foreground">Estimated fare ₹{quote} for {distance} km. Safety OTP is generated the moment you confirm.</p>
							<Btn as={Link} to="/app/rider/track" className="mt-3 w-full">Confirm and track live</Btn>
						</div>
					)}
				</Panel>

				<div className="space-y-6">
					<MapPanel progress={activeRide.progress} from={activeRide.from} to={activeRide.to} safe={activeRide.safeCorridor} label={`Trip ${activeRide.id}`} />
					<Panel>
						<SectionTitle title="Live ride status" action={<Chip tone="info">{activeRide.status}</Chip>} />
						<div className="grid gap-3 sm:grid-cols-2">
							{[['Driver', `${activeRide.driver} · ${activeRide.rating}★`], ['Vehicle', activeRide.vehicle], ['Safety OTP', activeRide.otp], ['ETA', `${activeRide.eta} min`]].map(([k, v]) => (
								<div key={k} className="rounded-2xl bg-white/[0.05] px-4 py-3">
									<p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
									<p className="mt-1 text-sm font-semibold">{v}</p>
								</div>
							))}
						</div>
						<div className="mt-4 flex flex-wrap gap-3">
							<Btn as={Link} to="/app/messages" variant="soft">Message driver</Btn>
							<SosButton />
						</div>
					</Panel>
				</div>
			</div>
		</div>
	);
};

export const RideTrackingPage = () => {
	const { activeRide, setActiveRide } = useApp();
	const stages = ['Requested', 'Driver assigned', 'OTP verified', 'En route', 'Arrived'];
	const stageIndex = Math.min(4, Math.floor(activeRide.progress / 22));
	return (
		<div className="space-y-6">
			<Helmet>
				<title>Live ride tracking · SheRides</title>
				<meta name="description" content="Follow your SheRides trip in real time with route deviation alerts, safety OTP status and live trip sharing." />
			</Helmet>
			<MapPanel height="h-[380px] md:h-[460px]" progress={activeRide.progress} from={activeRide.from} to={activeRide.to} safe={activeRide.safeCorridor} label={`Trip ${activeRide.id}`} />
			<div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
				<Panel>
					<SectionTitle title="Trip timeline" subtitle="Each state change is pushed to your trusted contacts." />
					<ol className="space-y-3">
						{stages.map((s, i) => (
							<li key={s} className="flex items-center gap-3">
								<span className={`h-2.5 w-2.5 rounded-full ${i <= stageIndex ? 'bg-[#5DD62C]' : 'bg-white/15'}`} />
								<span className={`text-sm ${i <= stageIndex ? 'font-semibold' : 'text-muted-foreground'}`}>{s}</span>
								{i === stageIndex && <Chip tone="info" className="ml-auto">Now</Chip>}
							</li>
						))}
					</ol>
					<div className="mt-5 flex flex-wrap gap-3">
						<Btn variant="soft" onClick={() => setActiveRide({ ...activeRide, progress: Math.min(96, activeRide.progress + 18), status: 'En route' })}>Simulate progress</Btn>
						<Btn variant={activeRide.safeCorridor ? 'danger' : 'safe'} onClick={() => setActiveRide({ ...activeRide, safeCorridor: !activeRide.safeCorridor })}>
							{activeRide.safeCorridor ? 'Simulate route deviation' : 'Clear deviation alert'}
						</Btn>
					</div>
				</Panel>
				<Panel>
					<SectionTitle title="Safety controls" />
					<div className="space-y-3 text-sm">
						{[['Live trip sharing', 'safe', 'On · 2 contacts'], ['Route deviation radar', activeRide.safeCorridor ? 'safe' : 'danger', activeRide.safeCorridor ? 'Within corridor' : 'Deviation 620 m'], ['Safety OTP', 'safe', `Verified · ${activeRide.otp}`], ['Night geo-fence', 'info', 'Active until 06:00']].map(([k, tone, v]) => (
							<div key={k} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3">
								<span>{k}</span><Chip tone={tone}>{v}</Chip>
							</div>
						))}
					</div>
					<SosButton className="mt-5 w-full" />
				</Panel>
			</div>
		</div>
	);
};

export const RideHistoryPage = () => {
	const { rides } = useApp();
	const [q, setQ] = useState('');
	const [status, setStatus] = useState('All');
	const list = rides.filter((r) =>
		(status === 'All' || r.status === status) &&
		`${r.id} ${r.from} ${r.to} ${r.driver}`.toLowerCase().includes(q.toLowerCase()));

	return (
		<div className="space-y-6">
			<Helmet>
				<title>Ride history · SheRides</title>
				<meta name="description" content="Search and filter your complete SheRides trip history with fares, drivers and ratings." />
			</Helmet>
			<Panel>
				<SectionTitle title="Ride history" subtitle="Receipts, drivers and ratings for every trip you have taken." />
				<div className="mb-5 flex flex-wrap gap-3">
					<div className="relative min-w-[15rem] flex-1">
						<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input className={`${inputCls} pl-11`} placeholder="Search by trip ID, place or driver" value={q} onChange={(e) => setQ(e.target.value)} />
					</div>
					<div className="flex items-center gap-2">
						<Filter className="h-4 w-4 text-muted-foreground" />
						{['All', 'Completed', 'Cancelled'].map((s) => (
							<button key={s} onClick={() => setStatus(s)} className={`min-h-[40px] rounded-full px-4 text-xs font-semibold ${status === s ? 'bg-white/[0.14]' : 'bg-white/[0.05] text-muted-foreground'}`}>{s}</button>
						))}
					</div>
				</div>
				{list.length === 0 ? (
					<Empty icon={Receipt} title="No rides match that filter" body="Try clearing the search or switching the status filter." />
				) : (
					<div className="divide-y divide-white/10">
						{list.map((r) => (
							<div key={r.id} className="grid gap-2 py-4 md:grid-cols-[1fr_auto] md:items-center">
								<div>
									<p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
										{r.from} <span className="text-muted-foreground">→</span> {r.to}
										<Chip tone={r.status === 'Completed' ? 'safe' : 'danger'}>{r.status}</Chip>
									</p>
									<p className="mt-1 text-xs text-muted-foreground">{r.id} · {r.date} · {r.distance} · {r.driver}</p>
								</div>
								<div className="flex items-center gap-4">
									{r.rating && <span className="flex items-center gap-1 text-xs text-[#5DD62C]"><Star className="h-3.5 w-3.5 fill-[#5DD62C]" />{r.rating}.0</span>}
									<span className="font-display text-base font-semibold">₹{r.fare}</span>
								</div>
							</div>
						))}
					</div>
				)}
			</Panel>
		</div>
	);
};
