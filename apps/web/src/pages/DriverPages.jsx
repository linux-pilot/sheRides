import React, { useState } from 'react';
import Helmet from 'react-helmet';
import { BadgeCheck, Car, CircleDollarSign, Clock, FileCheck2, Route, Star } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { Btn, Chip, Empty, Panel, SectionTitle, Stat } from '@/lib/kit';
import MapPanel from '@/components/MapPanel';

export const DriverDashboard = () => {
	const { requests, respondRequest, trips } = useApp();
	const [online, setOnline] = useState(true);
	return (
		<div className="space-y-6">
			<Helmet>
				<title>Driver dashboard · SheRides</title>
				<meta name="description" content="Accept or decline SheRides requests, track your live location and follow today's earnings from the driver dashboard." />
			</Helmet>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Stat label="Today's earnings" value="₹1,842" delta="7 trips · 4h 20m online" icon={CircleDollarSign} tone="safe" />
				<Stat label="Acceptance rate" value="94%" delta="Last 30 days" icon={Route} tone="info" />
				<Stat label="Rating" value="4.96" delta="Top 5% in Mumbai" icon={Star} />
				<Stat label="Online hours" value="4h 20m" delta="Target 6h" icon={Clock} />
			</div>

			<div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
				<Panel>
					<SectionTitle
						title="Incoming requests"
						subtitle="Only verified women passengers can request your car."
						action={
							<Btn variant={online ? 'safe' : 'soft'} onClick={() => setOnline((o) => !o)}>{online ? 'Online' : 'Offline'}</Btn>
						}
					/>
					{!online ? (
						<Empty icon={Car} title="You are offline" body="Go online to start receiving ride requests in your area." action={<Btn className="mt-2" onClick={() => setOnline(true)}>Go online</Btn>} />
					) : requests.length === 0 ? (
						<Empty icon={Car} title="No live requests right now" body="Stay online — evening peak around Powai usually starts at 18:15." />
					) : (
						<div className="space-y-3">
							{requests.map((r) => (
								<div key={r.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="text-sm font-semibold">{r.rider} · {r.rating}★ {r.verified && <Chip tone="safe" className="ml-1"><BadgeCheck className="h-3 w-3" /> Verified</Chip>}</p>
										<span className="font-display text-base font-semibold">₹{r.fare}</span>
									</div>
									<p className="mt-2 text-xs text-muted-foreground">{r.pickup} → {r.drop} · {r.distance} · {r.eta}</p>
									<div className="mt-4 flex gap-3">
										<Btn variant="safe" className="flex-1" onClick={() => respondRequest(r.id, true)}>Accept</Btn>
										<Btn variant="ghost" className="flex-1" onClick={() => respondRequest(r.id, false)}>Decline</Btn>
									</div>
								</div>
							))}
						</div>
					)}
				</Panel>
				<div className="space-y-6">
					<MapPanel progress={54} from="Chandivali Studio" to="Marol Naka" label="Your live location" />
					<Panel>
						<SectionTitle title="Recent trips" />
						<div className="divide-y divide-white/10 text-sm">
							{trips.map((t) => (
								<div key={t.id} className="flex items-center justify-between gap-3 py-3">
									<span><span className="font-semibold">{t.rider}</span><span className="block text-xs text-muted-foreground">{t.pickup} → {t.drop}</span></span>
									<span className="font-display font-semibold">₹{t.payout}</span>
								</div>
							))}
						</div>
					</Panel>
				</div>
			</div>
		</div>
	);
};

export const VehiclePage = () => (
	<div className="space-y-6">
		<Helmet>
			<title>Vehicle and KYC · SheRides driver</title>
			<meta name="description" content="Manage your SheRides vehicle details, insurance validity and KYC verification documents." />
		</Helmet>
		<div className="grid gap-6 lg:grid-cols-2">
			<Panel>
				<SectionTitle title="Vehicle details" action={<Chip tone="safe">Approved</Chip>} />
				<div className="grid gap-3 sm:grid-cols-2">
					{[['Model', 'Tata Tiago XZ 2023'], ['Plate', 'MH 02 QR 4417'], ['Colour', 'Pearl white'], ['Seats', '4 passengers'], ['Insurance valid till', '2026 Nov 30'], ['Fitness certificate', '2027 Apr 12']].map(([k, v]) => (
						<div key={k} className="rounded-2xl bg-white/[0.05] px-4 py-3">
							<p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
							<p className="mt-1 text-sm font-semibold">{v}</p>
						</div>
					))}
				</div>
				<Btn variant="soft" className="mt-5 w-full">Request vehicle change</Btn>
			</Panel>
			<Panel>
				<SectionTitle title="KYC documents" subtitle="Verified annually by the SheRides operations team." />
				<div className="space-y-3">
					{[['Driving licence', 'Verified'], ['Vehicle RC book', 'Verified'], ['Insurance certificate', 'Verified'], ['Police clearance', 'Verified'], ['Live selfie match', 'Re-check due']].map(([doc, state]) => (
						<div key={doc} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm">
							<span className="flex items-center gap-2.5"><FileCheck2 className="h-4.5 w-4.5 text-[#5DD62C]" size={18} />{doc}</span>
							<Chip tone={state === 'Verified' ? 'safe' : 'warn'}>{state}</Chip>
						</div>
					))}
				</div>
			</Panel>
		</div>
	</div>
);

export const EarningsPage = () => {
	const week = [['Mon', 1420], ['Tue', 1860], ['Wed', 2140], ['Thu', 1680], ['Fri', 2480], ['Sat', 2960], ['Sun', 1842]];
	const max = Math.max(...week.map((w) => w[1]));
	return (
		<div className="space-y-6">
			<Helmet>
				<title>Earnings · SheRides driver</title>
				<meta name="description" content="Track daily and weekly SheRides earnings, incentives and payout schedule." />
			</Helmet>
			<div className="grid gap-4 sm:grid-cols-3">
				<Stat label="This week" value="₹14,382" delta="+12% vs last week" icon={CircleDollarSign} tone="safe" />
				<Stat label="Night guardian bonus" value="₹1,150" delta="9 late-night trips" icon={Route} tone="info" />
				<Stat label="Next payout" value="₹9,240" delta="Friday · HDFC ··4419" icon={Clock} />
			</div>
			<Panel>
				<SectionTitle title="Daily earnings" subtitle="Fares, tips and safety incentives combined." />
				<div className="flex h-56 items-end gap-3">
					{week.map(([d, v]) => (
						<div key={d} className="flex flex-1 flex-col items-center gap-2">
							<span className="text-xs text-muted-foreground">₹{v}</span>
							<div className="w-full rounded-t-xl bg-[#5DD62C] transition-all duration-500" style={{ height: `${(v / max) * 160}px` }} />
							<span className="text-xs font-semibold">{d}</span>
						</div>
					))}
				</div>
			</Panel>
		</div>
	);
};

export const DriverTripsPage = () => {
	const { trips } = useApp();
	const [q, setQ] = useState('');
	const list = trips.filter((t) => `${t.id} ${t.rider} ${t.pickup} ${t.drop}`.toLowerCase().includes(q.toLowerCase()));
	return (
		<Panel>
			<Helmet>
				<title>Trip history · SheRides driver</title>
				<meta name="description" content="Review every completed SheRides trip with payouts, riders and routes." />
			</Helmet>
			<SectionTitle title="Trip history" subtitle="Payout is credited within 24 hours of trip completion." />
			<input className="mb-5 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none focus:border-[#5DD62C]" placeholder="Search trips" value={q} onChange={(e) => setQ(e.target.value)} />
			{list.length === 0 ? <Empty icon={Car} title="No trips found" body="Adjust your search to see more results." /> : (
				<div className="divide-y divide-white/10">
					{list.map((t) => (
						<div key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<p className="text-sm font-semibold">{t.pickup} → {t.drop}</p>
								<p className="mt-1 text-xs text-muted-foreground">{t.id} · {t.date} · {t.rider}</p>
							</div>
							<div className="flex items-center gap-3">
								<Chip tone="safe">{t.status}</Chip>
								<span className="font-display text-base font-semibold">₹{t.payout}</span>
							</div>
						</div>
					))}
				</div>
			)}
		</Panel>
	);
};
