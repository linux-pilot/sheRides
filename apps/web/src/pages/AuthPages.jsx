import React, { useState } from 'react';
import Helmet from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, Car, Check, Eye, EyeOff, FileCheck2, KeyRound, Shield, Upload } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { Btn, Chip, Field, Panel, inputCls } from '@/lib/kit';
import { cn } from '@/lib/utils';

const home = { passenger: '/app/rider', driver: '/app/driver', admin: '/app/admin' };

const AuthFrame = ({ title, lede, children, footer }) => (
	<div className="app-gradient min-h-[100dvh] px-4 py-10 md:py-16">
		<div className="mx-auto w-full max-w-xl">
			<Link to="/" className="mb-8 inline-flex items-center gap-2.5">
				<span className="grid h-9 w-9 place-items-center rounded-2xl bg-[#5DD62C] text-[#0F0F0F] shadow-[0_0_20px_rgba(93,214,44,0.35)]">
					<Shield className="h-4.5 w-4.5" size={18} strokeWidth={2.2} />
				</span>
				<span className="font-display text-lg font-semibold tracking-tight">SheRides</span>
			</Link>
			<Panel className="p-6 md:p-8">
				<h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
				<p className="mt-2 text-sm text-muted-foreground">{lede}</p>
				<div className="mt-7">{children}</div>
			</Panel>
			{footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
		</div>
	</div>
);

const RoleTabs = ({ role, setRole }) => (
	<div className="grid grid-cols-3 gap-2 rounded-2xl bg-black/25 p-1.5">
		{['passenger', 'driver', 'admin'].map((r) => (
			<button
				key={r} type="button" onClick={() => setRole(r)}
				className={cn('min-h-[44px] rounded-xl text-sm font-semibold capitalize transition-all duration-200',
					role === r ? 'bg-[#5DD62C] text-[#0F0F0F]' : 'text-muted-foreground hover:text-foreground')}
			>{r}</button>
		))}
	</div>
);

export const LoginPage = () => {
	const { login } = useApp();
	const navigate = useNavigate();
	const [role, setRole] = useState('passenger');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [show, setShow] = useState(false);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	const submit = (e) => {
		e.preventDefault();
		if (!email.includes('@') || password.length < 6) {
			setError('Enter a valid email and a password of at least 6 characters.');
			return;
		}
		setError(''); setBusy(true);
		setTimeout(() => { login(role, email); navigate(home[role]); }, 650);
	};

	return (
		<AuthFrame
			title="Welcome back"
			lede="Sign in to your SheRides workspace. Sessions are protected with short-lived JWT access tokens and refresh rotation."
			footer={<>New here? <Link to="/register" className="font-semibold text-[#5DD62C] hover:underline">Create an account</Link></>}
		>
			<Helmet>
				<title>Sign in · SheRides safety-first ride hailing</title>
				<meta name="description" content="Sign in to SheRides as a passenger, verified woman driver, or operations admin to manage safe rides." />
			</Helmet>
			<form className="space-y-5" onSubmit={submit}>
				<RoleTabs role={role} setRole={setRole} />
				<Field label="Email address">
					<input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
				</Field>
				<Field label="Password" hint="Minimum 6 characters. Stored as a salted bcrypt hash on the server.">
					<div className="relative">
						<input className={inputCls} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
						<button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={show ? 'Hide password' : 'Show password'}>
							{show ? <EyeOff className="h-4.5 w-4.5" size={18} /> : <Eye className="h-4.5 w-4.5" size={18} />}
						</button>
					</div>
				</Field>
				{error && <p className="rounded-2xl border border-[hsl(353,84%,58%)]/30 bg-[hsl(353,84%,58%)]/12 px-4 py-3 text-sm text-[hsl(353,90%,80%)]">{error}</p>}
				<Btn type="submit" className="w-full" disabled={busy}>
					<KeyRound className="h-4 w-4" />{busy ? 'Verifying credentials…' : 'Sign in securely'}
				</Btn>
				<p className="text-center text-xs text-muted-foreground">
					Any email with a 6+ character password opens the selected demo workspace.
				</p>
			</form>
		</AuthFrame>
	);
};

const passengerSteps = ['Account', 'Verification', 'Trusted contacts'];
const driverSteps = ['Account', 'Vehicle', 'KYC documents'];

export const RegisterPage = () => {
	const { login } = useApp();
	const navigate = useNavigate();
	const [role, setRole] = useState('passenger');
	const [step, setStep] = useState(0);
	const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', vehicle: '', plate: '', licence: '', contact: '' });
	const [error, setError] = useState('');
	const steps = role === 'driver' ? driverSteps : passengerSteps;
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

	const next = () => {
		if (step === 0 && (!form.name || !form.email.includes('@') || form.password.length < 6)) {
			setError('Name, a valid email and a 6+ character password are required.');
			return;
		}
		setError('');
		if (step < 2) { setStep(step + 1); return; }
		login(role === 'admin' ? 'admin' : role, form.email);
		navigate(home[role === 'admin' ? 'admin' : role]);
	};

	return (
		<AuthFrame
			title="Create your SheRides account"
			lede="Passengers ride in minutes. Drivers pass a women-only KYC review before their first trip."
			footer={<>Already registered? <Link to="/login" className="font-semibold text-[#5DD62C] hover:underline">Sign in</Link></>}
		>
			<Helmet>
				<title>Register · SheRides passenger and driver onboarding</title>
				<meta name="description" content="Register as a SheRides passenger or complete the driver KYC verification workflow with licence, RC and police clearance checks." />
			</Helmet>
			<div className="space-y-6">
				<RoleTabs role={role} setRole={(r) => { setRole(r); setStep(0); }} />

				<ol className="flex items-center gap-2">
					{steps.map((s, i) => (
						<li key={s} className="flex flex-1 items-center gap-2">
							<span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold',
								i <= step ? 'bg-[#5DD62C] text-[#0F0F0F]' : 'bg-white/[0.08] text-muted-foreground')}>
								{i < step ? <Check className="h-4 w-4" /> : i + 1}
							</span>
							<span className={cn('hidden text-xs font-semibold sm:block', i <= step ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
							{i < steps.length - 1 && <span className="h-px flex-1 bg-white/10" />}
						</li>
					))}
				</ol>

				{step === 0 && (
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Full name"><input className={inputCls} value={form.name} onChange={set('name')} placeholder="Aarushi Nandy" /></Field>
						<Field label="Mobile number"><input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="+91 98200 00000" /></Field>
						<Field label="Email"><input className={inputCls} type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" /></Field>
						<Field label="Password"><input className={inputCls} type="password" value={form.password} onChange={set('password')} placeholder="••••••••" /></Field>
					</div>
				)}

				{step === 1 && role !== 'driver' && (
					<div className="space-y-4">
						<div className="rounded-2xl border border-white/10 bg-black/25 p-5">
							<p className="flex items-center gap-2 font-display text-sm font-semibold"><BadgeCheck className="h-4.5 w-4.5 text-[#5DD62C]" size={18} /> Identity check</p>
							<p className="mt-2 text-sm text-muted-foreground">We send a 6-digit OTP to your mobile and match a live selfie against your government ID. Only verified riders can book.</p>
							<div className="mt-4 flex gap-2">
								{[4, 1, 9, 2, 7, 3].map((d, i) => (
									<span key={i} className="grid h-12 w-10 place-items-center rounded-xl border border-white/10 bg-black/30 font-display text-lg font-semibold">{d}</span>
								))}
							</div>
						</div>
						<Chip tone="safe"><Check className="h-3.5 w-3.5" /> OTP verified</Chip>
					</div>
				)}

				{step === 1 && role === 'driver' && (
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Vehicle model"><input className={inputCls} value={form.vehicle} onChange={set('vehicle')} placeholder="Tata Tiago XZ" /></Field>
						<Field label="Registration plate"><input className={inputCls} value={form.plate} onChange={set('plate')} placeholder="MH 02 QR 4417" /></Field>
						<Field label="Driving licence number"><input className={inputCls} value={form.licence} onChange={set('licence')} placeholder="MH0220250041782" /></Field>
						<Field label="Seating capacity"><input className={inputCls} defaultValue="4" /></Field>
					</div>
				)}

				{step === 2 && role === 'driver' && (
					<div className="space-y-3">
						{['Driving licence', 'Vehicle RC book', 'Insurance certificate', 'Police clearance', 'Live selfie match'].map((doc, i) => (
							<div key={doc} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
								<span className="flex items-center gap-2.5 text-sm">
									<FileCheck2 className="h-4.5 w-4.5 text-[#5DD62C]" size={18} />{doc}
								</span>
								<Chip tone={i < 3 ? 'safe' : 'warn'}>{i < 3 ? 'Uploaded' : 'Pending upload'}</Chip>
							</div>
						))}
						<Btn variant="soft" className="w-full" type="button"><Upload className="h-4 w-4" /> Upload remaining documents</Btn>
						<p className="text-xs text-muted-foreground">Admin review usually completes within 24 hours. You can explore your dashboard while KYC is pending.</p>
					</div>
				)}

				{step === 2 && role !== 'driver' && (
					<div className="space-y-4">
						<Field label="Trusted contact" hint="They receive your live trip link and SOS alerts.">
							<input className={inputCls} value={form.contact} onChange={set('contact')} placeholder="Ritu Nandy · +91 98200 41120" />
						</Field>
						<div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-muted-foreground">
							Safety defaults switched on: live trip sharing, route deviation alerts, safety OTP before boarding, and masked calling.
						</div>
					</div>
				)}

				{error && <p className="rounded-2xl border border-[hsl(353,84%,58%)]/30 bg-[hsl(353,84%,58%)]/12 px-4 py-3 text-sm text-[hsl(353,90%,80%)]">{error}</p>}

				<div className="flex gap-3">
					{step > 0 && <Btn variant="ghost" type="button" onClick={() => setStep(step - 1)}>Back</Btn>}
					<Btn type="button" className="flex-1" onClick={next}>
						{step < 2 ? 'Continue' : role === 'driver' ? 'Submit for KYC review' : 'Finish and start riding'}
						{role === 'driver' && step === 2 && <Car className="h-4 w-4" />}
					</Btn>
				</div>
			</div>
		</AuthFrame>
	);
};
