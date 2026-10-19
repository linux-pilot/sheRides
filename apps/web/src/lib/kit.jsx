import React from 'react';
import { cn } from '@/lib/utils';

export const Panel = ({ className, children, ...rest }) => (
	<section className={cn('panel rounded-3xl p-5 md:p-6', className)} {...rest}>{children}</section>
);

export const SectionTitle = ({ title, subtitle, action }) => (
	<div className="mb-5 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 className="font-display text-lg font-semibold tracking-tight text-foreground md:text-xl">{title}</h2>
			{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
		</div>
		{action}
	</div>
);

const btnVariants = {
	primary: 'text-[#0F0F0F] bg-[#5DD62C] hover:bg-[#6ef034] active:bg-[#4ebb22] glow-primary',
	ghost: 'text-foreground/80 border border-white/10 hover:bg-white/5',
	danger: 'text-white bg-[#b91c1c] hover:bg-[#dc2626]',
	safe: 'text-[#F8F8F8] bg-[#337418] hover:bg-[#3d8c1d]',
	soft: 'bg-white/[0.07] text-foreground hover:bg-white/[0.12]',
};

export const Btn = ({ variant = 'primary', className, as: As = 'button', ...rest }) => (
	<As
		className={cn(
			'inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold tracking-tight transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-50',
			'min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]',
			btnVariants[variant], className,
		)}
		{...rest}
	/>
);

export const Field = ({ label, hint, children }) => (
	<label className="flex flex-col gap-2">
		<span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
		{children}
		{hint && <span className="text-xs text-muted-foreground">{hint}</span>}
	</label>
);

export const inputCls =
	'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition focus:border-[#5DD62C] focus:ring-2 focus:ring-[#5DD62C]/25';

export const Chip = ({ tone = 'neutral', children, className }) => {
	const tones = {
		neutral: 'bg-white/[0.07] text-foreground/80 border-white/10',
		safe: 'bg-[#337418]/25 text-[#5DD62C] border-[#337418]/40',
		warn: 'bg-white/10 text-foreground border-white/20',
		danger: 'bg-red-950/30 text-red-300 border-red-800/40',
		info: 'bg-[#202020] text-[#F8F8F8] border-[#337418]/30',
	};
	return (
		<span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold', tones[tone], className)}>
			{children}
		</span>
	);
};

export const Stat = ({ label, value, delta, icon: Icon, tone = 'primary' }) => (
	<div className="panel rounded-3xl p-5">
		<div className="flex items-start justify-between gap-3">
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
			{Icon && (
				<span className={cn('grid h-9 w-9 place-items-center rounded-2xl',
					tone === 'primary' && 'bg-[#5DD62C]/15 text-[#5DD62C]',
					tone === 'safe' && 'bg-[#337418]/25 text-[#5DD62C]',
					tone === 'info' && 'bg-white/10 text-foreground',
					tone === 'danger' && 'bg-red-950/30 text-red-300')}>
					<Icon className="h-4.5 w-4.5" strokeWidth={1.8} size={18} />
				</span>
			)}
		</div>
		<p className="mt-3 font-display text-2xl font-semibold tracking-tight md:text-3xl">{value}</p>
		{delta && <p className="mt-1 text-xs text-muted-foreground">{delta}</p>}
	</div>
);

export const Empty = ({ icon: Icon, title, body, action }) => (
	<div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/12 px-6 py-12 text-center">
		{Icon && <Icon className="h-7 w-7 text-muted-foreground" strokeWidth={1.6} />}
		<p className="font-display text-base font-semibold">{title}</p>
		{body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
		{action}
	</div>
);

export const Loading = ({ rows = 3 }) => (
	<div className="space-y-3">
		{Array.from({ length: rows }).map((_, i) => (
			<div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.06]" />
		))}
	</div>
);
