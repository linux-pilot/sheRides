// GET /admin/reports   admin   dashboard numbers + completed rides per month (last 6 months, IST)
import { Router } from 'express';
import { Complaint, Driver, Rating, Ride, SosAlert, User } from '../models.js';
import { requireRole } from '../middleware.js';
import { ACTIVE_STATUSES, localDate, TIME_ZONE } from '../rideRules.js';

const router = Router();

// The last six calendar months in the service area's time zone: [{ key: 'YYYY-MM', m: 'Jun' }, …].
function lastSixMonths() {
  const [y, m] = localDate(Date.now()).split('-').map(Number);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 6 + i, 1));
    return { key: d.toISOString().slice(0, 7), m: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) };
  });
}

router.get('/admin/reports', requireRole('admin'), async (req, res) => {
  const months = lastSixMonths();
  const since = new Date(Date.now() - 200 * 86400000); // a little over six months; only the listed months are read
  const [byMonth, fares, statusCounts, sos, ratings, users, drivers, pendingDrivers, openComplaints] = await Promise.all([
    Ride.aggregate([
      { $match: { createdAt: { $gte: since }, status: 'completed' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: TIME_ZONE } }, n: { $sum: 1 } } },
    ]),
    Ride.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$fare' } } }]),
    Ride.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    SosAlert.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Rating.aggregate([{ $match: { ratedBy: 'passenger' } }, { $group: { _id: null, avg: { $avg: '$stars' } } }]),
    User.countDocuments(), Driver.countDocuments({ verificationStatus: 'approved' }),
    Driver.countDocuments({ verificationStatus: 'pending' }), Complaint.countDocuments({ status: { $ne: 'resolved' } }),
  ]);
  const count = (rows, k) => rows.find((r) => r._id === k)?.n || 0;
  const sosTotal = sos.reduce((s, r) => s + r.n, 0);
  res.json({
    monthly: months.map(({ key, m }) => ({ m, n: count(byMonth, key) })),
    completed: count(statusCounts, 'completed'),
    cancelled: count(statusCounts, 'cancelled'),
    active: statusCounts.filter((r) => ACTIVE_STATUSES.includes(r._id)).reduce((s, r) => s + r.n, 0),
    grossFares: fares[0]?.total || 0,
    sosActive: count(sos, 'active'),
    sosResolvedPct: sosTotal ? Math.round((count(sos, 'resolved') / sosTotal) * 100) : 100,
    avgRating: ratings[0] ? Math.round(ratings[0].avg * 10) / 10 : null,
    users, drivers, pendingDrivers, openComplaints,
  });
});

export default router;
