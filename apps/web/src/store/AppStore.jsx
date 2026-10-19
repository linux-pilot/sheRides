import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const AppContext = createContext(null);

const fakeJwt = (payload) =>
	['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', btoa(JSON.stringify(payload)).replace(/=/g, ''), 'sheRidesDemoSignature'].join('.');

const seedRides = [
	{ id: 'SR-48210', date: '2026 Mar 02 · 18:40', from: 'Bandra Kurla Complex', to: 'Juhu Beach Road', driver: 'Meera Kulkarni', fare: 342, status: 'Completed', rating: 5, distance: '8.4 km' },
	{ id: 'SR-48096', date: '2026 Feb 28 · 09:15', from: 'Powai Lake Gate 2', to: 'Andheri East Metro', driver: 'Rukhsar Sheikh', fare: 218, status: 'Completed', rating: 4, distance: '5.1 km' },
	{ id: 'SR-47934', date: '2026 Feb 24 · 22:05', from: 'Lower Parel Offices', to: 'Worli Sea Face', driver: 'Anita D\u2019Souza', fare: 176, status: 'Completed', rating: 5, distance: '3.9 km' },
	{ id: 'SR-47810', date: '2026 Feb 19 · 07:30', from: 'Dadar Station West', to: 'Fort Heritage Lane', driver: 'Priyanka Rane', fare: 264, status: 'Cancelled', rating: null, distance: '6.8 km' },
];

const seedTrips = [
	{ id: 'TR-9921', date: '2026 Mar 02 · 18:40', rider: 'Aarushi N.', pickup: 'BKC Gate 4', drop: 'Juhu Beach Road', payout: 289, status: 'Completed' },
	{ id: 'TR-9918', date: '2026 Mar 02 · 15:02', rider: 'Fatima R.', pickup: 'Santacruz East', drop: 'Vile Parle Market', payout: 143, status: 'Completed' },
	{ id: 'TR-9914', date: '2026 Mar 01 · 21:44', rider: 'Divya S.', pickup: 'Kurla Depot', drop: 'Chembur Colony', payout: 198, status: 'Completed' },
];

const seedRequests = [
	{ id: 'RQ-3391', rider: 'Sneha Iyer', rating: 4.9, pickup: 'Hiranandani Gardens', drop: 'Sakinaka Junction', eta: '4 min away', fare: 236, distance: '6.2 km', verified: true },
	{ id: 'RQ-3392', rider: 'Tanvi Bhatt', rating: 4.7, pickup: 'Chandivali Studio', drop: 'Marol Naka', fare: 154, eta: '7 min away', distance: '3.4 km', verified: true },
];

const seedUsers = [
	{ id: 'U-1042', name: 'Aarushi Nandy', role: 'Passenger', city: 'Mumbai', joined: '2025 Nov 12', status: 'Active', rides: 84 },
	{ id: 'U-1088', name: 'Sneha Iyer', role: 'Passenger', city: 'Pune', joined: '2025 Dec 04', status: 'Active', rides: 31 },
	{ id: 'D-2201', name: 'Meera Kulkarni', role: 'Driver', city: 'Mumbai', joined: '2025 Aug 21', status: 'Active', rides: 1180 },
	{ id: 'D-2244', name: 'Rukhsar Sheikh', role: 'Driver', city: 'Mumbai', joined: '2026 Jan 09', status: 'Suspended', rides: 212 },
];

const seedKyc = [
	{ id: 'KYC-771', name: 'Jasleen Kaur', vehicle: 'Tata Tiago · MH 02 QR 4417', licence: 'MH0220250041782', submitted: '2026 Mar 01', status: 'Pending', docs: ['Licence', 'RC book', 'Police clearance', 'Selfie match'] },
	{ id: 'KYC-768', name: 'Nivedita Rao', vehicle: 'Maruti Dzire · MH 12 KP 8890', licence: 'MH1220240092210', submitted: '2026 Feb 27', status: 'In review', docs: ['Licence', 'RC book', 'Insurance'] },
	{ id: 'KYC-760', name: 'Farheen Qureshi', vehicle: 'Hyundai Aura · MH 04 DD 2201', licence: 'MH0420230017754', submitted: '2026 Feb 22', status: 'Approved', docs: ['Licence', 'RC book', 'Police clearance'] },
];

const seedComplaints = [
	{ id: 'CMP-518', from: 'Aarushi Nandy', against: 'Driver D-2244', category: 'Route deviation', priority: 'High', status: 'Open', opened: '2026 Mar 02', detail: 'Driver left the mapped route near Kurla for 1.6 km without informing me.' },
	{ id: 'CMP-511', from: 'Sneha Iyer', against: 'Driver D-2210', category: 'Late arrival', priority: 'Medium', status: 'In progress', opened: '2026 Feb 28', detail: 'Waited 14 minutes past the promised pickup window at Hiranandani Gardens.' },
	{ id: 'CMP-504', from: 'Divya Shetty', against: 'Passenger U-1088', category: 'Payment failure', priority: 'Low', status: 'Resolved', opened: '2026 Feb 21', detail: 'Wallet debit failed twice; fare settled manually by support.' },
];

const seedTx = [
	{ id: 'TX-88301', label: 'Ride SR-48210 · BKC to Juhu', type: 'debit', amount: 342, date: '2026 Mar 02', method: 'SheRides Wallet' },
	{ id: 'TX-88254', label: 'Wallet top-up', type: 'credit', amount: 1500, date: '2026 Mar 01', method: 'HDFC UPI' },
	{ id: 'TX-88192', label: 'Ride SR-48096 · Powai to Andheri', type: 'debit', amount: 218, date: '2026 Feb 28', method: 'SheRides Wallet' },
	{ id: 'TX-88110', label: 'Safety Plus subscription', type: 'debit', amount: 149, date: '2026 Feb 25', method: 'Visa ·· 4412' },
];

export const AppProvider = ({ children }) => {
	const [session, setSession] = useState(null);
	const [rides] = useState(seedRides);
	const [trips] = useState(seedTrips);
	const [requests, setRequests] = useState(seedRequests);
	const [users, setUsers] = useState(seedUsers);
	const [kyc, setKyc] = useState(seedKyc);
	const [complaints, setComplaints] = useState(seedComplaints);
	const [transactions, setTransactions] = useState(seedTx);
	const [walletBalance, setWalletBalance] = useState(2860);
	const [notifications, setNotifications] = useState([
		{ id: 'n1', title: 'Safety OTP ready', body: 'Share code 4192 with your driver before starting.', tone: 'info', time: '2 min ago', read: false },
		{ id: 'n2', title: 'Trusted contact added', body: 'Ritu Nandy will receive live trip links.', tone: 'safe', time: '1 hr ago', read: false },
		{ id: 'n3', title: 'Geo-fence alert cleared', body: 'Your ride re-entered the safe corridor.', tone: 'warn', time: 'Yesterday', read: true },
	]);
	const [contacts, setContacts] = useState([
		{ id: 'c1', name: 'Ritu Nandy', relation: 'Mother', phone: '+91 98200 41120', primary: true },
		{ id: 'c2', name: 'Kavya Menon', relation: 'Flatmate', phone: '+91 99301 88214', primary: false },
	]);
	const [messages, setMessages] = useState([
		{ id: 'm1', from: 'driver', text: 'I am at Gate 4, near the blue kiosk.', time: '18:32' },
		{ id: 'm2', from: 'me', text: 'Coming out now, wearing a yellow kurta.', time: '18:33' },
		{ id: 'm3', from: 'driver', text: 'Noted. Please share your safety OTP when you sit.', time: '18:34' },
	]);
	const [sosActive, setSosActive] = useState(false);
	const [activeRide, setActiveRide] = useState({
		id: 'SR-48311',
		status: 'Driver arriving',
		driver: 'Meera Kulkarni',
		rating: 4.96,
		vehicle: 'Tata Tiago · MH 02 QR 4417',
		otp: '4192',
		from: 'Hiranandani Gardens, Powai',
		to: 'Nariman Point, Mumbai',
		fare: 486,
		eta: 4,
		progress: 22,
		safeCorridor: true,
	});

	const login = useCallback((role, email) => {
		const names = { passenger: 'Aarushi Nandy', driver: 'Meera Kulkarni', admin: 'Control Room · Ops' };
		const s = {
			role,
			email: email || `${role}@sherides.app`,
			name: names[role],
			verified: true,
			token: fakeJwt({ sub: email || role, role, iat: Date.now() }),
		};
		setSession(s);
		return s;
	}, []);

	const logout = useCallback(() => setSession(null), []);

	const pushNotification = useCallback((n) => {
		setNotifications((prev) => [{ id: `n${Date.now()}`, time: 'Just now', read: false, tone: 'info', ...n }, ...prev]);
	}, []);

	const markAllRead = useCallback(() => setNotifications((p) => p.map((n) => ({ ...n, read: true }))), []);

	const triggerSos = useCallback(() => {
		setSosActive(true);
		pushNotification({ title: 'SOS dispatched', body: 'Live location shared with trusted contacts and the SheRides control room.', tone: 'danger' });
	}, [pushNotification]);

	const cancelSos = useCallback(() => setSosActive(false), []);

	const value = useMemo(() => ({
		session, login, logout,
		rides, trips, requests, users, kyc, complaints, transactions, walletBalance,
		notifications, contacts, messages, sosActive, activeRide,
		setActiveRide,
		respondRequest: (id, accept) => {
			setRequests((p) => p.filter((r) => r.id !== id));
			pushNotification({ title: accept ? 'Ride accepted' : 'Request declined', body: `Request ${id} was ${accept ? 'accepted' : 'declined'}.`, tone: accept ? 'safe' : 'warn' });
		},
		setUserStatus: (id, status) => setUsers((p) => p.map((u) => (u.id === id ? { ...u, status } : u))),
		setKycStatus: (id, status) => setKyc((p) => p.map((k) => (k.id === id ? { ...k, status } : k))),
		setComplaintStatus: (id, status) => setComplaints((p) => p.map((c) => (c.id === id ? { ...c, status } : c))),
		addContact: (c) => setContacts((p) => [...p, { ...c, id: `c${Date.now()}`, primary: false }]),
		removeContact: (id) => setContacts((p) => p.filter((c) => c.id !== id)),
		sendMessage: (text) => setMessages((p) => [...p, { id: `m${Date.now()}`, from: 'me', text, time: 'now' }]),
		topUp: (amount) => {
			setWalletBalance((b) => b + amount);
			setTransactions((p) => [{ id: `TX-${Math.floor(Math.random() * 90000 + 10000)}`, label: 'Wallet top-up', type: 'credit', amount, date: 'Today', method: 'HDFC UPI' }, ...p]);
		},
		pushNotification, markAllRead, triggerSos, cancelSos,
	}), [session, login, logout, rides, trips, requests, users, kyc, complaints, transactions, walletBalance, notifications, contacts, messages, sosActive, activeRide, pushNotification, markAllRead, triggerSos, cancelSos]);

	return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
	const ctx = useContext(AppContext);
	if (!ctx) throw new Error('useApp must be used inside AppProvider');
	return ctx;
};
