import React, { useState } from 'react';
import Helmet from 'react-helmet';
import { Bell, CreditCard, Lock, Phone, Plus, Send, Shield, Trash2, Wallet } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { Btn, Chip, Empty, Field, Panel, SectionTitle, Stat, inputCls } from '@/lib/kit';
import { SosButton } from '@/components/AppShell';

export const WalletPage = () => {
	const { walletBalance, transactions, topUp } = useApp();
	const [amount, setAmount] = useState('500');
	return (
		<div className="space-y-6">
			<Helmet>
				<title>Wallet and payments · SheRides</title>
				<meta name="description" content="Manage your SheRides wallet balance, payment methods, automatic fare settlement and transaction history." />
			</Helmet>
			<div className="grid gap-4 sm:grid-cols-3">
				<Stat label="Wallet balance" value={`₹${walletBalance.toLocaleString('en-IN')}`} delta="Instant fare settlement" icon={Wallet} tone="safe" />
				<Stat label="Spent this month" value="₹1,236" delta="6 rides" icon={CreditCard} tone="info" />
				<Stat label="Saved with offers" value="₹184" delta="Night Guardian cashback" icon={Shield} />
			</div>
			<div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
				<Panel>
					<SectionTitle title="Add money" subtitle="Payments are tokenised — card numbers never touch SheRides servers." />
					<Field label="Amount (INR)">
						<input className={inputCls} type="number" min="100" value={amount} onChange={(e) => setAmount(e.target.value)} />
					</Field>
					<div className="mt-3 flex gap-2">
						{[300, 500, 1000].map((a) => (
							<button key={a} onClick={() => setAmount(String(a))} className="min-h-[40px] flex-1 rounded-full bg-white/[0.06] text-xs font-semibold hover:bg-white/[0.12]">₹{a}</button>
						))}
					</div>
					<Btn className="mt-4 w-full" onClick={() => topUp(Math.max(100, Number(amount) || 0))}><Plus className="h-4 w-4" /> Top up securely</Btn>
					<div className="mt-6 space-y-3">
						{[['HDFC UPI · aarushi@hdfcbank', 'Primary'], ['Visa ·· 4412', 'Backup'], ['Cash on completion', 'Disabled']].map(([m, tag]) => (
							<div key={m} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm">
								<span>{m}</span><Chip tone={tag === 'Primary' ? 'safe' : 'neutral'}>{tag}</Chip>
							</div>
						))}
					</div>
				</Panel>
				<Panel>
					<SectionTitle title="Transaction history" />
					<div className="divide-y divide-white/10">
						{transactions.map((t) => (
							<div key={t.id} className="flex items-center justify-between gap-3 py-3.5 text-sm">
								<span><span className="font-semibold">{t.label}</span><span className="block text-xs text-muted-foreground">{t.id} · {t.date} · {t.method}</span></span>
								<span className={`font-display font-semibold ${t.type === 'credit' ? 'text-[#5DD62C]' : 'text-foreground'}`}>
									{t.type === 'credit' ? '+' : '−'}₹{t.amount}
								</span>
							</div>
						))}
					</div>
				</Panel>
			</div>
		</div>
	);
};

export const MessagesPage = () => {
	const { messages, sendMessage, activeRide } = useApp();
	const [text, setText] = useState('');
	return (
		<Panel className="flex h-[70vh] flex-col">
			<Helmet>
				<title>Masked messaging · SheRides</title>
				<meta name="description" content="Chat with your SheRides driver through masked in-app messaging that expires when the trip ends." />
			</Helmet>
			<SectionTitle
				title={`Chat with ${activeRide.driver}`}
				subtitle="Numbers are masked. This thread is deleted 24 hours after the trip."
				action={<Btn variant="soft" className="px-4"><Phone className="h-4 w-4" /> Masked call</Btn>}
			/>
			<div className="flex-1 space-y-3 overflow-y-auto pr-1">
				{messages.map((m) => (
					<div key={m.id} className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${m.from === 'me' ? 'ml-auto bg-[#5DD62C] text-[#0F0F0F] font-medium' : 'bg-white/[0.07]'}`}>
						{m.text}
						<span className="mt-1 block text-[0.65rem] opacity-70">{m.time}</span>
					</div>
				))}
			</div>
			<form
				className="mt-4 flex gap-3"
				onSubmit={(e) => { e.preventDefault(); if (text.trim()) { sendMessage(text.trim()); setText(''); } }}
			>
				<input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
				<Btn type="submit" className="px-5"><Send className="h-4 w-4" /></Btn>
			</form>
		</Panel>
	);
};

export const SafetyPage = () => {
	const { contacts, addContact, removeContact, activeRide } = useApp();
	const [form, setForm] = useState({ name: '', relation: '', phone: '' });
	return (
		<div className="space-y-6">
			<Helmet>
				<title>Safety centre · SheRides</title>
				<meta name="description" content="Manage emergency contacts, safety OTP, geo-fencing alerts and read SheRides safety guidance." />
			</Helmet>
			<Panel className="border-[hsl(353,84%,58%)]/30">
				<div className="flex flex-wrap items-center justify-between gap-5">
					<div>
						<h2 className="font-display text-xl font-semibold tracking-tight">Emergency response</h2>
						<p className="mt-1 max-w-xl text-sm text-muted-foreground">
							One tap shares your live location, driver identity and vehicle plate with trusted contacts, the SheRides control room and local police.
						</p>
					</div>
					<SosButton />
				</div>
			</Panel>
			<div className="grid gap-6 lg:grid-cols-2">
				<Panel>
					<SectionTitle title="Emergency contacts" subtitle="They receive live trip links and SOS alerts." />
					{contacts.length === 0 ? <Empty icon={Phone} title="No contacts yet" body="Add at least one trusted contact before your next ride." /> : (
						<div className="space-y-3">
							{contacts.map((c) => (
								<div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm">
									<span><span className="font-semibold">{c.name}</span><span className="block text-xs text-muted-foreground">{c.relation} · {c.phone}</span></span>
									<div className="flex items-center gap-2">
										{c.primary && <Chip tone="safe">Primary</Chip>}
										<button onClick={() => removeContact(c.id)} aria-label={`Remove ${c.name}`} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10"><Trash2 className="h-4 w-4" /></button>
									</div>
								</div>
							))}
						</div>
					)}
					<form
						className="mt-5 grid gap-3 sm:grid-cols-3"
						onSubmit={(e) => { e.preventDefault(); if (form.name && form.phone) { addContact(form); setForm({ name: '', relation: '', phone: '' }); } }}
					>
						<input className={inputCls} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
						<input className={inputCls} placeholder="Relation" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} />
						<input className={inputCls} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
						<Btn type="submit" className="sm:col-span-3"><Plus className="h-4 w-4" /> Add trusted contact</Btn>
					</form>
				</Panel>
				<div className="space-y-6">
					<Panel>
						<SectionTitle title="Active safeguards" />
						<div className="space-y-3 text-sm">
							{[['Safety OTP', 'safe', `Code ${activeRide.otp}`], ['Route deviation detection', activeRide.safeCorridor ? 'safe' : 'danger', activeRide.safeCorridor ? 'Monitoring' : 'Alert raised'], ['Night geo-fence', 'info', 'Active 22:00–06:00'], ['Masked calling', 'safe', 'Enabled']].map(([k, tone, v]) => (
								<div key={k} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3"><span>{k}</span><Chip tone={tone}>{v}</Chip></div>
							))}
						</div>
					</Panel>
					<Panel>
						<SectionTitle title="Safety tips" />
						<ul className="space-y-3 text-sm text-muted-foreground">
							{[
								'Match the vehicle plate and driver photo before you open the door.',
								'Never share your safety OTP over a phone call — only inside the car.',
								'Keep live trip sharing on for late-night rides; it costs nothing.',
								'If the route feels wrong, tap SOS first and ask questions later.',
							].map((t) => <li key={t} className="flex gap-3"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#5DD62C]" />{t}</li>)}
						</ul>
					</Panel>
				</div>
			</div>
		</div>
	);
};

export const NotificationsPage = () => {
	const { notifications, markAllRead } = useApp();
	return (
		<Panel>
			<Helmet>
				<title>Notifications · SheRides</title>
				<meta name="description" content="All SheRides safety, ride and payment notifications in one timeline." />
			</Helmet>
			<SectionTitle title="Notifications" subtitle="Safety alerts always appear at the top." action={<Btn variant="soft" onClick={markAllRead}>Mark all read</Btn>} />
			{notifications.length === 0 ? <Empty icon={Bell} title="Nothing new" body="Alerts about rides, safety and payments will appear here." /> : (
				<div className="space-y-3">
					{notifications.map((n) => (
						<div key={n.id} className={`rounded-2xl border px-4 py-3.5 ${n.read ? 'border-white/8 bg-white/[0.03]' : 'border-[#337418]/50 bg-[#337418]/15'}`}>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-sm font-semibold">{n.title}</p>
								<div className="flex items-center gap-2"><Chip tone={n.tone}>{n.tone === 'danger' ? 'Safety' : n.tone === 'safe' ? 'Confirmed' : 'Info'}</Chip><span className="text-xs text-muted-foreground">{n.time}</span></div>
							</div>
							<p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
						</div>
					))}
				</div>
			)}
		</Panel>
	);
};

export const ProfilePage = () => {
	const { session } = useApp();
	return (
		<div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
			<Helmet>
				<title>Profile · SheRides</title>
				<meta name="description" content="Manage your SheRides profile, verification status and account details." />
			</Helmet>
			<Panel>
				<SectionTitle title="Your profile" action={<Chip tone="safe">Verified</Chip>} />
				<div className="flex items-center gap-4">
					<span className="grid h-16 w-16 place-items-center rounded-3xl bg-[#5DD62C] font-display text-xl font-bold text-[#0F0F0F]">
						{session.name.slice(0, 1)}
					</span>
					<div>
						<p className="font-display text-lg font-semibold">{session.name}</p>
						<p className="text-sm text-muted-foreground">{session.email}</p>
					</div>
				</div>
				<div className="mt-6 grid gap-3 sm:grid-cols-2">
					{[['Role', session.role], ['Member since', 'Nov 2025'], ['Home city', 'Mumbai'], ['ID verification', 'Aadhaar matched']].map(([k, v]) => (
						<div key={k} className="rounded-2xl bg-white/[0.05] px-4 py-3">
							<p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
							<p className="mt-1 text-sm font-semibold capitalize">{v}</p>
						</div>
					))}
				</div>
			</Panel>
			<Panel>
				<SectionTitle title="Edit details" subtitle="Changes to phone or ID require re-verification." />
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Full name"><input className={inputCls} defaultValue={session.name} /></Field>
					<Field label="Phone"><input className={inputCls} defaultValue="+91 98200 00000" /></Field>
					<Field label="Email"><input className={inputCls} defaultValue={session.email} /></Field>
					<Field label="Home city"><input className={inputCls} defaultValue="Mumbai" /></Field>
				</div>
				<Btn className="mt-5">Save changes</Btn>
			</Panel>
		</div>
	);
};

export const SettingsPage = () => {
	const [prefs, setPrefs] = useState({
		share: true, deviation: true, geofence: true, otp: true, promos: false, biometric: true,
	});
	const rows = [
		['share', 'Automatic live trip sharing', 'Send every trip link to your primary contact.'],
		['deviation', 'Route deviation alerts', 'Notify me if the car leaves the mapped corridor.'],
		['geofence', 'Night geo-fencing', 'Restrict late rides to monitored corridors.'],
		['otp', 'Mandatory safety OTP', 'Trip cannot start until the OTP is entered.'],
		['biometric', 'Biometric app lock', 'Require Face ID or fingerprint to open SheRides.'],
		['promos', 'Promotional notifications', 'Offers, cashback and referral news.'],
	];
	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<Helmet>
				<title>Settings · SheRides</title>
				<meta name="description" content="Control SheRides safety defaults, notification preferences and account security settings." />
			</Helmet>
			<Panel>
				<SectionTitle title="Safety and notifications" subtitle="Safety defaults stay on unless you turn them off." />
				<div className="space-y-3">
					{rows.map(([key, title, body]) => (
						<button key={key} onClick={() => setPrefs((p) => ({ ...p, [key]: !p[key] }))} className="flex w-full items-center justify-between gap-4 rounded-2xl bg-white/[0.05] px-4 py-3.5 text-left hover:bg-white/[0.08]">
							<span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{body}</span></span>
							<span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${prefs[key] ? 'bg-[#5DD62C]' : 'bg-white/15'}`}>
								<span className={`absolute top-0.5 h-5 w-5 rounded-full ${prefs[key] ? 'translate-x-[1.4rem] bg-[#0F0F0F]' : 'translate-x-0.5 bg-white'} transition-transform`} />
							</span>
						</button>
					))}
				</div>
			</Panel>
			<Panel>
				<SectionTitle title="Account security" subtitle="JWT sessions rotate every 15 minutes." />
				<div className="grid gap-4">
					<Field label="Current password"><input className={inputCls} type="password" placeholder="••••••••" /></Field>
					<Field label="New password" hint="At least 10 characters with a number and symbol."><input className={inputCls} type="password" placeholder="••••••••" /></Field>
					<Field label="Confirm new password"><input className={inputCls} type="password" placeholder="••••••••" /></Field>
				</div>
				<Btn className="mt-5">Update password</Btn>
				<div className="mt-6 space-y-3 text-sm">
					{[['Active sessions', '2 devices'], ['Two-factor authentication', 'SMS + app'], ['Data export', 'Available on request']].map(([k, v]) => (
						<div key={k} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3"><span>{k}</span><Chip tone="info">{v}</Chip></div>
					))}
				</div>
			</Panel>
		</div>
	);
};
