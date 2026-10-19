import React from 'react';
import Helmet from 'react-helmet';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Bell, MapPinned, MessageSquareLock, Radar, Shield, ShieldAlert, Wallet } from 'lucide-react';
import { Btn, Chip } from '@/lib/kit';

const HERO = 'https://images.hostinger.com/be2c890e-b86b-4e04-9fff-dc8391b3d8b3.png';
const DRIVER = 'https://images.hostinger.com/93c76cdf-f79f-4aa3-99ab-6ac88feb6ad6.png';

const ticker = ['Women drivers only', 'Safety OTP before boarding', 'Route deviation alerts', 'Masked calling', 'Live trip sharing', 'Geo-fenced night corridors', '24/7 control room'];

const safety = [
	{ icon: ShieldAlert, title: 'One-tap SOS', body: 'Location, driver ID and vehicle plate stream to trusted contacts, the control room and local police within two seconds.' },
	{ icon: Radar, title: 'Route deviation radar', body: 'Every trip is matched against its mapped corridor. A deviation beyond 400 m raises a live alert on both sides.' },
	{ icon: MapPinned, title: 'Geo-fenced night zones', body: 'Rides after 22:00 are routed through lit, monitored corridors with automatic check-ins every four minutes.' },
	{ icon: MessageSquareLock, title: 'Masked communication', body: 'Numbers are never exchanged. In-app chat and relay calling expire when the trip ends.' },
];

const HomePage = () => (
	<div className="app-gradient min-h-[100dvh] text-foreground">
		<Helmet>
			<title>SheRides · Secure ride-hailing and safety platform for women</title>
			<meta name="description" content="SheRides is a women-only ride-hailing platform with one-tap SOS, route deviation detection, safety OTP, verified women drivers and a 24/7 safety control room." />
		</Helmet>

		<header className="sticky top-0 z-40 border-b border-white/10 bg-[#0F0F0F]/80 backdrop-blur-xl">
			<div className="mx-auto flex w-full max-w-[80rem] items-center gap-4 px-4 py-3.5 md:px-8">
				<Link to="/" className="flex items-center gap-2.5">
					<span className="grid h-9 w-9 place-items-center rounded-2xl bg-[#5DD62C] text-[#0F0F0F] shadow-[0_0_20px_rgba(93,214,44,0.35)]">
						<Shield className="h-4.5 w-4.5" size={18} strokeWidth={2.2} />
					</span>
					<span className="font-display text-lg font-semibold tracking-tight">SheRides</span>
				</Link>
				<nav className="ml-6 hidden items-center gap-6 text-sm text-muted-foreground md:flex">
					<a href="#safety" className="hover:text-foreground">Safety</a>
					<a href="#roles" className="hover:text-foreground">For riders & drivers</a>
					<a href="#payments" className="hover:text-foreground">Payments</a>
				</nav>
				<div className="ml-auto flex items-center gap-2">
					<Btn as={Link} to="/login" variant="ghost" className="px-4">Sign in</Btn>
					<Btn as={Link} to="/register" className="px-4">Get started</Btn>
				</div>
			</div>
		</header>

		<section className="mx-auto grid w-full max-w-[80rem] items-center gap-10 px-4 pb-16 pt-12 md:grid-cols-[1.05fr_0.95fr] md:px-8 md:pb-24 md:pt-20">
			<div>
				<Chip tone="safe"><BadgeCheck className="h-3.5 w-3.5" /> 100% verified women drivers</Chip>
				<h1 className="mt-5 font-display text-[2.6rem] font-semibold leading-[1.03] tracking-tight md:text-[4.1rem]">
					Rides where safety is<br />
					<span className="text-[#5DD62C]">the default setting.</span>
				</h1>
				<p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
					SheRides pairs women passengers with KYC-verified women drivers, then watches every kilometre — safety OTP at boarding,
					deviation radar en route, and a control room that answers in seconds.
				</p>
				<div className="mt-8 flex flex-wrap items-center gap-3">
					<Btn as={Link} to="/register">Book your first ride <ArrowRight className="h-4 w-4" /></Btn>
					<Btn as={Link} to="/login" variant="ghost">Explore the demo workspaces</Btn>
				</div>
				<dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-6">
					{[['4.94', 'Average driver rating'], ['2.1 s', 'Median SOS dispatch'], ['38', 'Cities live']].map(([v, l]) => (
						<div key={l}>
							<dt className="font-display text-xl font-semibold md:text-2xl">{v}</dt>
							<dd className="mt-1 text-xs text-muted-foreground">{l}</dd>
						</div>
					))}
				</dl>
			</div>
			<div className="relative">
				<div className="absolute -inset-6 rounded-[2.5rem] bg-[#5DD62C]/15 blur-3xl" />
				<img src={HERO} alt="A woman riding safely in the back seat of a SheRides car at night in Mumbai" className="relative w-full rounded-[2rem] border border-white/12 object-cover shadow-2xl" />
				<div className="panel absolute -bottom-6 left-4 right-8 rounded-3xl p-4 md:left-8">
					<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Trip SR-48311</p>
					<div className="mt-2 flex items-center justify-between gap-3">
						<span className="font-display text-sm font-semibold">Safety OTP 4192 confirmed</span>
						<Chip tone="safe">On safe route</Chip>
					</div>
				</div>
			</div>
		</section>

		<div className="overflow-hidden border-y border-white/10 bg-black/25 py-3">
			<div className="marquee-track flex w-max gap-8 whitespace-nowrap text-sm uppercase tracking-[0.2em] text-muted-foreground">
				{[...ticker, ...ticker].map((t, i) => (
					<span key={i} className="flex items-center gap-8">{t}<span className="text-[#5DD62C]">◆</span></span>
				))}
			</div>
		</div>

		<section id="safety" className="mx-auto w-full max-w-[72rem] px-4 py-16 md:px-8 md:py-24">
			<h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">Four layers of protection running on every single trip</h2>
			<div className="mt-10 divide-y divide-white/10 border-t border-white/10">
				{safety.map(({ icon: Icon, title, body }) => (
					<div key={title} className="grid gap-3 py-7 md:grid-cols-[auto_14rem_1fr] md:items-start md:gap-8">
						<span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5DD62C]/15 text-[#5DD62C]">
							<Icon className="h-5 w-5" strokeWidth={1.8} />
						</span>
						<h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
						<p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
					</div>
				))}
			</div>
		</section>

		<section id="roles" className="mx-auto w-full max-w-[80rem] px-4 pb-16 md:px-8 md:pb-24">
			<div className="grid gap-6 md:grid-cols-[0.85fr_1.15fr] md:items-stretch">
				<img src={DRIVER} alt="A verified SheRides woman driver standing beside her car at dusk in Mumbai" className="h-full w-full rounded-[2rem] border border-white/12 object-cover" />
				<div className="panel rounded-[2rem] p-7 md:p-9">
					<h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Three workspaces, one safety spine</h2>
					<div className="mt-7 space-y-5">
						{[
							['Passenger', 'Search rides, see fare estimates before booking, track live, and keep every trip inside your safety net.', '/register'],
							['Driver', 'Complete KYC once, then manage vehicle documents, requests, earnings and payouts in one place.', '/register'],
							['Operations admin', 'Monitor live rides, verify driver KYC, resolve complaints, and read platform analytics.', '/login'],
						].map(([title, body, to]) => (
							<div key={title} className="rounded-2xl border border-white/10 bg-black/20 p-5">
								<div className="flex items-center justify-between gap-3">
									<h3 className="font-display text-base font-semibold">{title}</h3>
									<Link to={to} className="text-sm font-semibold text-[#5DD62C] hover:underline">Open</Link>
								</div>
								<p className="mt-2 text-sm text-muted-foreground">{body}</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>

		<section id="payments" className="mx-auto w-full max-w-[72rem] px-4 pb-20 md:px-8 md:pb-28">
			<div className="panel rounded-[2rem] p-7 md:p-10">
				<div className="grid gap-8 md:grid-cols-3">
					{[
						[Wallet, 'Wallet & cards', 'Top up once, ride all month. Fares are calculated automatically from distance, time and night multipliers.'],
						[Bell, 'Live status updates', 'Every state change — assigned, arriving, OTP verified, en route, completed — is pushed to you and your contacts.'],
						[Shield, 'Nothing personal shared', 'Masked numbers, masked chat, and receipts that never expose your home address to a driver.'],
					].map(([Icon, title, body]) => (
						<div key={title}>
							<Icon className="h-6 w-6 text-[#5DD62C]" strokeWidth={1.7} />
							<h3 className="mt-4 font-display text-lg font-semibold tracking-tight">{title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
						</div>
					))}
				</div>
			</div>
		</section>

		<footer className="border-t border-white/10 bg-black/25 py-9 text-sm text-muted-foreground">
			<div className="mx-auto flex w-full max-w-[80rem] flex-wrap items-center justify-between gap-4 px-4 md:px-8">
				<p className="font-display font-semibold text-foreground/90">SheRides Mobility Pvt Ltd</p>
				<nav className="flex flex-wrap gap-5">
					<Link to="/login" className="hover:text-foreground">Sign in</Link>
					<Link to="/register" className="hover:text-foreground">Register</Link>
					<a href="#safety" className="hover:text-foreground">Safety</a>
					<a href="mailto:care@sherides.app" className="hover:text-foreground">care@sherides.app</a>
				</nav>
				<p>© {new Date().getFullYear()} SheRides. Control room: 1800 200 4411.</p>
			</div>
		</footer>
	</div>
);

export default HomePage;
