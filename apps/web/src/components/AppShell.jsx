import React, { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AlertOctagon, Bell, Car, CreditCard, Gauge, IdCard, LayoutDashboard, LifeBuoy, LogOut, MapPin, MessageSquare, Menu, Receipt, Settings, Shield, ShieldAlert, Users, Wallet, X } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { Btn, Chip } from '@/lib/kit';
import { cn } from '@/lib/utils';

const NAV = {
	passenger: [
		{ to: '/app/rider', label: 'Dashboard', icon: LayoutDashboard },
		{ to: '/app/rider/track', label: 'Live tracking', icon: MapPin },
		{ to: '/app/rider/history', label: 'Ride history', icon: Receipt },
		{ to: '/app/messages', label: 'Messages', icon: MessageSquare },
		{ to: '/app/wallet', label: 'Wallet & payments', icon: Wallet },
		{ to: '/app/safety', label: 'Safety centre', icon: Shield },
		{ to: '/app/notifications', label: 'Notifications', icon: Bell },
		{ to: '/app/profile', label: 'Profile', icon: IdCard },
		{ to: '/app/settings', label: 'Settings', icon: Settings },
	],
	driver: [
		{ to: '/app/driver', label: 'Driver dashboard', icon: Gauge },
		{ to: '/app/driver/vehicle', label: 'Vehicle & KYC', icon: Car },
		{ to: '/app/driver/earnings', label: 'Earnings', icon: CreditCard },
		{ to: '/app/driver/trips', label: 'Trip history', icon: Receipt },
		{ to: '/app/messages', label: 'Messages', icon: MessageSquare },
		{ to: '/app/safety', label: 'Safety centre', icon: Shield },
		{ to: '/app/notifications', label: 'Notifications', icon: Bell },
		{ to: '/app/profile', label: 'Profile', icon: IdCard },
		{ to: '/app/settings', label: 'Settings', icon: Settings },
	],
	admin: [
		{ to: '/app/admin', label: 'Control room', icon: LayoutDashboard },
		{ to: '/app/admin/users', label: 'Users & drivers', icon: Users },
		{ to: '/app/admin/rides', label: 'Live rides', icon: MapPin },
		{ to: '/app/admin/kyc', label: 'KYC verification', icon: IdCard },
		{ to: '/app/admin/complaints', label: 'Complaints', icon: LifeBuoy },
		{ to: '/app/notifications', label: 'Notifications', icon: Bell },
		{ to: '/app/settings', label: 'Settings', icon: Settings },
	],
};

const SosOverlay = () => {
	const { sosActive, cancelSos, contacts } = useApp();
	if (!sosActive) return null;
	return (
		<div className="fixed inset-0 z-[70] grid place-items-center bg-[hsl(353,60%,6%)]/80 p-4 backdrop-blur-sm">
			<div className="panel w-full max-w-md rounded-3xl border-[hsl(353,84%,58%)]/40 p-7 text-center">
				<div className="relative mx-auto grid h-16 w-16 place-items-center rounded-full bg-[hsl(353,84%,56%)] text-white">
					<span className="absolute inset-0 rounded-full bg-[hsl(353,84%,56%)]/60 ping-soft" />
					<ShieldAlert className="relative h-7 w-7" />
				</div>
				<h2 className="mt-5 font-display text-xl font-semibold">Emergency response active</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					Live location, driver details and vehicle number are streaming to the SheRides control room and your trusted contacts.
				</p>
				<div className="mt-4 space-y-2 text-left">
					{contacts.map((c) => (
						<div key={c.id} className="flex items-center justify-between rounded-2xl bg-white/[0.06] px-4 py-2.5 text-sm">
							<span>{c.name} · {c.relation}</span>
							<Chip tone="safe">Notified</Chip>
						</div>
					))}
					<div className="flex items-center justify-between rounded-2xl bg-white/[0.06] px-4 py-2.5 text-sm">
						<span>Mumbai Police control room</span>
						<Chip tone="warn">Calling</Chip>
					</div>
				</div>
				<Btn variant="ghost" className="mt-6 w-full" onClick={cancelSos}>I am safe — stand down</Btn>
			</div>
		</div>
	);
};

export const SosButton = ({ className }) => {
	const { triggerSos } = useApp();
	return (
		<button
			onClick={triggerSos}
			aria-label="Trigger emergency SOS"
			className={cn(
				'group relative inline-flex min-h-[52px] items-center gap-3 rounded-full bg-gradient-to-r from-[hsl(353,84%,54%)] to-[hsl(9,88%,56%)] px-6 text-sm font-bold uppercase tracking-[0.18em] text-white transition-transform duration-200 active:scale-[0.97]',
				'shadow-[0_16px_40px_-14px_hsl(353,84%,50%,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
				className,
			)}
		>
			<span className="absolute inset-0 rounded-full bg-[hsl(353,84%,54%)]/50 ping-soft" />
			<ShieldAlert className="relative h-5 w-5" strokeWidth={2.2} />
			<span className="relative">SOS</span>
		</button>
	);
};

const AppShell = () => {
	const { session, logout, notifications } = useApp();
	const [open, setOpen] = useState(false);
	const location = useLocation();
	if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

	const nav = NAV[session.role] ?? NAV.passenger;
	const unread = notifications.filter((n) => !n.read).length;

	return (
		<div className="app-gradient min-h-[100dvh] text-foreground">
			<SosOverlay />
			<div className="mx-auto flex w-full max-w-[110rem]">
				<aside className={cn(
					'fixed inset-y-0 left-0 z-50 w-[17rem] shrink-0 border-r border-white/10 bg-[#0F0F0F]/95 p-5 transition-transform duration-300 lg:sticky lg:top-0 lg:h-[100dvh] lg:translate-x-0 lg:bg-transparent',
					open ? 'translate-x-0' : '-translate-x-full',
				)}>
					<div className="flex items-center justify-between">
						<Link to="/" className="flex items-center gap-2.5">
							<span className="grid h-9 w-9 place-items-center rounded-2xl bg-[#5DD62C] text-[#0F0F0F] shadow-[0_0_20px_rgba(93,214,44,0.35)]">
								<Shield className="h-4.5 w-4.5" size={18} strokeWidth={2.2} />
							</span>
							<span className="font-display text-lg font-semibold tracking-tight">SheRides</span>
						</Link>
						<button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
					</div>

					<p className="mt-7 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{session.role} workspace</p>
					<nav className="mt-3 space-y-1">
						{nav.map(({ to, label, icon: Icon }) => (
							<NavLink
								key={to} to={to} end={to.split('/').length === 3}
								onClick={() => setOpen(false)}
								className={({ isActive }) => cn(
									'flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm transition-colors duration-200',
									isActive ? 'bg-white/[0.10] font-semibold text-foreground shadow-[inset_0_1px_0_hsl(0,0%,100%,0.06)]' : 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground',
								)}
							>
								<Icon className="h-4.5 w-4.5" size={18} strokeWidth={1.7} />
								<span className="flex-1">{label}</span>
								{label === 'Notifications' && unread > 0 && (
									<span className="rounded-full bg-[#5DD62C] px-2 py-0.5 text-[0.65rem] font-bold text-[#0F0F0F]">{unread}</span>
								)}
							</NavLink>
						))}
					</nav>

					<div className="mt-7 rounded-3xl border border-[hsl(353,84%,58%)]/25 bg-[hsl(353,60%,18%)]/25 p-4">
						<p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(353,90%,80%)]">
							<AlertOctagon className="h-4 w-4" /> Emergency
						</p>
						<p className="mt-2 text-xs text-muted-foreground">One tap alerts trusted contacts, control room and police.</p>
						<SosButton className="mt-3 w-full" />
					</div>
				</aside>

				{open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

				<main className="min-w-0 flex-1">
					<header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-[#0F0F0F]/85 px-4 py-3.5 backdrop-blur-xl md:px-8">
						<button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
						<div className="min-w-0 flex-1">
							<p className="truncate font-display text-sm font-semibold md:text-base">{session.name}</p>
							<p className="truncate text-xs text-muted-foreground">{session.email} · JWT session active</p>
						</div>
						<Chip tone="safe" className="hidden sm:inline-flex">Verified</Chip>
						<Link to="/app/notifications" className="relative grid h-11 w-11 place-items-center rounded-full border border-white/10 hover:bg-white/5" aria-label="Notifications">
							<Bell className="h-4.5 w-4.5" size={18} />
							{unread > 0 && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[#5DD62C]" />}
						</Link>
						<Btn variant="ghost" onClick={logout} className="px-4"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></Btn>
					</header>
					<div className="px-4 py-6 md:px-8 md:py-8">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	);
};

export default AppShell;
