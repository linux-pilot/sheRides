// Demo data. Run: docker compose run --rm server node seed.js --yes
// WIPES every SheRides collection, then inserts one account per role plus sample drivers.
// Without --yes it only says which database it would wipe, so a stray run cannot destroy real data.
// All demo accounts share the password below (test values only, never real credentials).
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as M from './models.js';
import { removeUpload, UPLOAD_DIR } from './uploads.js';
import { distanceKm, fareFor, makeOtp } from './rideRules.js';

const DEMO_PASSWORD = 'SheRides@123';

if (!process.argv.includes('--yes')) {
  const db = (process.env.MONGO_URL || '').replace(/\/\/[^@/]*@/, '//***@'); // never print credentials
  console.error(`seed.js WIPES every account, ride and upload in ${db || '(MONGO_URL not set)'} and replaces them with demo data.\nNothing was changed. To go ahead: node seed.js --yes`);
  process.exit(2);
}

await mongoose.connect(process.env.MONGO_URL);
await Promise.all(Object.values(M).filter((m) => m?.deleteMany).map((m) => m.deleteMany({})));
await Promise.all(Object.values(M).filter((m) => m?.syncIndexes).map((m) => m.syncIndexes()));

for (const f of await readdir(UPLOAD_DIR)) await removeUpload(f);

const password = await bcrypt.hash(DEMO_PASSWORD, 10);

// One-page placeholder PDF so seeded KYC documents open in the admin review screen.
async function samplePdf(title) {
  const text = title.replace(/[()\\]/g, '');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 16 Tf 30 120 Td (${text}) Tj 0 -30 Td /F1 11 Tf (SheRides demo document - not a real ID) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const name = `${randomBytes(16).toString('hex')}.pdf`;
  await writeFile(path.join(UPLOAD_DIR, name), pdf, 'latin1');
  return name;
}

await M.Admin.create({ name: 'Admin', email: 'admin@sherides.test', password, phone: '+91 80000 00001' });
await M.SupportTeam.create([
  { name: 'Asha', email: 'asha@sherides.test', password },
  { name: 'Nisha', email: 'nisha@sherides.test', password },
  { name: 'Rupa', email: 'rupa@sherides.test', password },
]);

const ananya = await M.User.create({
  name: 'Ananya Rao', email: 'ananya@sherides.test', password, phone: '+91 98450 12345', gender: 'female', walletBalance: 1240,
  emergencyContacts: [
    { name: 'Kavya Rao', relation: 'Sister', phone: '+91 98861 11122', email: 'kavya@sherides.test' },
    { name: 'Sunita Rao', relation: 'Mother', phone: '+91 94480 33344', email: 'sunita@sherides.test' },
  ],
  savedAddresses: [
    { label: 'Home', address: 'CG Road, Navrangpura', lat: 23.0365, lng: 72.5611 },
    { label: 'Work', address: 'Corporate Road, Prahlad Nagar', lat: 23.012, lng: 72.5108 },
  ],
});

const driver = async (name, email, plate, vehicleModel, verificationStatus, docTypes) => {
  const documents = [];
  for (const type of docTypes) {
    documents.push({ type, path: await samplePdf(`${type} - ${name}`), status: verificationStatus === 'approved' ? 'approved' : 'pending' });
  }
  return {
    name, email, password, phone: '+91 99000 ' + plate.slice(-5).replace(' ', '0'), licenseNumber: 'KA01' + plate.replace(/\D/g, '').padEnd(11, '0'),
    vehicleModel, vehiclePlate: plate, verificationStatus, rating: verificationStatus === 'approved' ? 4.9 : 0,
    licensePhoto: documents.find((d) => d.type === 'Driving licence')?.path, documents,
  };
};
const ALL = ['Driving licence', 'Vehicle RC', 'Aadhaar (KYC)'];
const [priya] = await M.Driver.create([
  await driver('Priya Sharma', 'priya@sherides.test', 'KA 01 MX 4821', 'Maruti Swift', 'approved', ALL),
  await driver('Neha Verma', 'neha@sherides.test', 'KA 03 AB 1290', 'Hyundai i20', 'pending', ALL),
  await driver('Pooja Iyer', 'pooja@sherides.test', 'KA 05 MN 7781', 'Honda City', 'pending', ['Driving licence', 'Vehicle RC']),
  // No licence yet: shows that approval is blocked until one is uploaded.
  await driver('Rekha Das', 'rekha@sherides.test', 'KA 51 ZZ 4410', 'Tata Tiago', 'pending', []),
]);

const sneha = await M.User.create({ name: 'Sneha Thomas', email: 'sneha@sherides.test', password, phone: '+91 98450 22222', gender: 'female', walletBalance: 600 });
await M.User.create({ name: 'Farah Qureshi', email: 'farah@sherides.test', password, phone: '+91 98450 33333', gender: 'female', walletBalance: 0, status: 'blocked' });

// Past trips so history, wallet, earnings, ratings and reports have something to show.
const PLACES = {
  kal: { address: 'Kalupur Railway Station', lat: 23.0276, lng: 72.6006 },
  nav: { address: 'CG Road, Navrangpura', lat: 23.0365, lng: 72.5611 },
  vas: { address: 'Vastrapur Lake', lat: 23.0396, lng: 72.5293 },
  man: { address: 'Maninagar', lat: 22.9962, lng: 72.6034 },
  sat: { address: 'Shivranjani, Satellite', lat: 23.0223, lng: 72.53 },
};
const ago = (days, hour = 18) => { const d = new Date(Date.now() - days * 86400000); d.setHours(hour, 15, 0, 0); return d; };
const past = [
  [ananya, 'vas', 'man', 'lite', 1, 5, 'Very safe and polite. Waited patiently.'],
  [ananya, 'sat', 'nav', 'prime', 3, 5, 'Clean car, smooth drive.'],
  [sneha, 'kal', 'nav', 'lite', 4, 4, 'Good ride, slight delay at pickup.'],
  [ananya, 'nav', 'kal', 'prime', 9, null, null],
  [ananya, 'kal', 'vas', 'lite', 40, 5, null],
  [sneha, 'man', 'sat', 'prime', 75, 5, null],
];
for (const [user, from, to, tier, days, stars, feedback] of past) {
  const pickup = PLACES[from]; const drop = PLACES[to];
  const km = distanceKm(pickup, drop); const fare = fareFor(tier, km); const at = ago(days);
  const [ride] = await M.Ride.insertMany([{ user: user._id, driver: priya._id, pickup, drop, tier, km, fare, otp: makeOtp(), status: 'completed',
    acceptedAt: new Date(at.getTime() + 3 * 60000), startTime: new Date(at.getTime() + 9 * 60000), endTime: new Date(at.getTime() + 30 * 60000), createdAt: at, updatedAt: at }]);
  await M.Payment.insertMany([{ user: user._id, ride: ride._id, amount: fare, method: 'wallet', status: 'success', createdAt: ride.endTime }]);
  if (stars) await M.Rating.create({ ride: ride._id, ratedBy: 'passenger', stars, feedback });
}
await M.Ride.insertMany([{ user: ananya._id, pickup: PLACES.sat, drop: PLACES.vas, tier: 'lite', km: 6.1, fare: fareFor('lite', 6.1), otp: makeOtp(),
  status: 'cancelled', cancel: { by: 'passenger', reason: 'Plans changed', at: ago(6) }, createdAt: ago(6), updatedAt: ago(6) }]);
await M.Payment.insertMany([{ user: ananya._id, amount: 1000, method: 'topup', status: 'success', createdAt: ago(5) }]);
const earned = (await M.Ride.find({ driver: priya._id, status: 'completed' })).reduce((sum, r) => sum + r.fare, 0);
await M.Driver.updateOne({ _id: priya._id }, { rating: 4.8, walletBalance: earned });

const lastRide = await M.Ride.findOne({ user: ananya._id, status: 'completed' }).sort({ createdAt: -1 });
await M.SosAlert.create({ ride: lastRide._id, user: ananya._id, driver: priya._id, raisedBy: 'passenger', location: PLACES.vas, status: 'resolved', triggeredAt: ago(1, 18), resolvedAt: ago(1, 18) });
await M.Complaint.create({ ride: lastRide._id, raisedBy: 'passenger', description: 'Driver took a slightly longer route than shown.', status: 'open' });
await M.Notification.create([
  { user: ananya._id, message: '₹1,000 added to your wallet.', isRead: true },
  { user: ananya._id, message: 'Trip completed. Rate your driver in Ride history.' },
]);
const [asha] = await M.SupportTeam.find({ email: 'asha@sherides.test' });
await M.SupportTicket.create([
  { user: ananya._id, subject: 'Refund for cancelled ride', category: 'Payment', message: 'I was charged for a ride I cancelled.', status: 'open', assignedTo: asha._id },
  { driver: priya._id, subject: 'Insurance doc upload', category: 'KYC', message: 'How do I upload my insurance renewal?', status: 'in_progress', response: 'Use Profile & KYC → Insurance.' },
  { user: sneha._id, subject: 'Lost item — umbrella', category: 'Lost & found', message: 'Left a blue umbrella in my last ride.', status: 'open' },
  { user: ananya._id, subject: 'Wallet top-up delay', category: 'Payment', message: 'Top-up took a minute to show.', status: 'resolved', response: 'Resolved — balance updated.' },
]);

console.log(`Seeded. Every demo account uses password: ${DEMO_PASSWORD}
  passenger  ananya@sherides.test   sneha@sherides.test   (farah@ is blocked)
  driver     priya@sherides.test   (approved)   neha@ / pooja@ / rekha@sherides.test (pending; rekha has no licence yet)
  admin      admin@sherides.test
  support    asha@sherides.test`);
await mongoose.disconnect();
