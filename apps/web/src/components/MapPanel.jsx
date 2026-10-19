import React from 'react';
import { Car, MapPin, Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chip } from '@/lib/kit';

const MapPanel = ({ progress = 30, from = 'Pickup', to = 'Drop', label = 'Live route', safe = true, height = 'h-[320px] md:h-[380px]', pins = [] }) => {
	const clamped = Math.max(4, Math.min(96, progress));
	return (
		<div className={cn('panel relative overflow-hidden rounded-3xl p-0', height)}>
			<div className="absolute inset-0 grid-map" />
			<div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_20%_20%,rgba(93,214,44,0.16),transparent_65%),radial-gradient(500px_300px_at_85%_80%,rgba(51,116,24,0.18),transparent_60%)]" />

			<svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
				<path d="M8 48 C 26 44, 30 22, 50 20 S 78 26, 92 10" fill="none" stroke="rgba(248, 248, 248, 0.15)" strokeWidth="1.6" strokeLinecap="round" />
				<path
					d="M8 48 C 26 44, 30 22, 50 20 S 78 26, 92 10"
					fill="none"
					stroke={safe ? '#5DD62C' : '#ef4444'}
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeDasharray="120"
					strokeDashoffset={120 - (120 * clamped) / 100}
					style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
				/>
			</svg>

			<div className="absolute left-[6%] top-[76%] -translate-y-1/2">
				<span className="relative grid h-7 w-7 place-items-center rounded-full bg-[#5DD62C] text-[#0F0F0F]">
					<MapPin className="h-4 w-4" strokeWidth={2.2} />
				</span>
			</div>
			<div className="absolute right-[6%] top-[14%]">
				<span className="grid h-7 w-7 place-items-center rounded-full bg-[#337418] text-[#F8F8F8]">
					<Navigation className="h-4 w-4" strokeWidth={2.2} />
				</span>
			</div>
			<div
				className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-out"
				style={{ left: `${6 + clamped * 0.86}%`, top: `${76 - clamped * 0.62}%` }}
			>
				<span className="relative grid h-9 w-9 place-items-center rounded-full bg-[#F8F8F8] text-[#0F0F0F] shadow-lg">
					<span className="absolute inset-0 rounded-full bg-white/50 ping-soft" />
					<Car className="relative h-4.5 w-4.5" size={18} strokeWidth={2} />
				</span>
			</div>

			{pins.map((p, i) => (
				<span key={i} className="absolute h-2.5 w-2.5 rounded-full bg-[#5DD62C] shadow-[0_0_0_4px_rgba(93,214,44,0.25)]" style={{ left: p.left, top: p.top }} title={p.label} />
			))}

			<div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
				<Chip tone="info">{label}</Chip>
				<Chip tone={safe ? 'safe' : 'danger'}>{safe ? 'Inside safe corridor' : 'Route deviation detected'}</Chip>
			</div>
			<div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-xs backdrop-blur">
				<span className="text-muted-foreground">From <span className="font-semibold text-foreground">{from}</span></span>
				<span className="text-muted-foreground">To <span className="font-semibold text-foreground">{to}</span></span>
				<span className="font-semibold text-[#5DD62C]">{clamped}% complete</span>
			</div>
		</div>
	);
};

export default MapPanel;
