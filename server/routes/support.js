// Support tickets and ride complaints.
//   POST /tickets                passenger|driver  { subject, category, message }
//   GET  /tickets?status=        passenger|driver → own;  support → all
//   PUT  /tickets/:id            support           { status?, response?, assignedTo? }  ('' unassigns)
//   GET  /support/team           support           agents for assignment
//   POST /complaints             passenger|driver  { ride, description }  (own rides only)
//   GET  /admin/complaints?status=   admin
//   PUT  /admin/complaints/:id       admin         { status?, resolutionNotes? }
import { Router } from 'express';
import mongoose from 'mongoose';
import { Complaint, COMPLAINT_STATUS, OWNER_FIELD, Ride, SupportTeam, SupportTicket, TICKET_STATUS } from '../models.js';
import { HttpError, idParam, requireRole, validate } from '../middleware.js';
import { notifyUser } from '../notify.js';
import { emit, emitRole } from '../realtime.js';

const router = Router();
const either = requireRole('passenger', 'driver');
const TICKET_CATEGORIES = ['Payment', 'Ride', 'Safety', 'KYC', 'Lost & found', 'App issue', 'Other'];

// Live refresh for every support agent's queue and the ticket owner's list.
function ticketChanged(t) {
  const event = { id: String(t._id), status: t.status };
  emitRole('support', 'ticket:update', event);
  if (t.user) emit('passenger', t.user._id || t.user, 'ticket:update', event);
  if (t.driver) emit('driver', t.driver._id || t.driver, 'ticket:update', event);
}

const POPULATE = [
  { path: 'user', select: 'name email' }, { path: 'driver', select: 'name email' }, { path: 'assignedTo', select: 'name' },
];

router.post('/tickets', either, async (req, res) => {
  const t = validate(req.body, {
    subject: { required: true, max: 120 }, category: { required: true, oneOf: TICKET_CATEGORIES }, message: { required: true, max: 1000 },
  });
  const ticket = await SupportTicket.create({ ...t, [OWNER_FIELD[req.auth.role]]: req.auth.id });
  ticketChanged(ticket);
  res.status(201).json(ticket);
});

router.get('/tickets', requireRole('passenger', 'driver', 'support'), async (req, res) => {
  const { status } = validate(req.query, { status: { oneOf: [...TICKET_STATUS, 'all'] } });
  const filter = req.auth.role === 'support' ? {} : { [OWNER_FIELD[req.auth.role]]: req.auth.id };
  if (status && status !== 'all') filter.status = status;
  res.json(await SupportTicket.find(filter).populate(POPULATE).sort({ updatedAt: -1 }).limit(200));
});

router.get('/support/team', requireRole('support'), async (req, res) => {
  res.json(await SupportTeam.find().select('name email').sort({ name: 1 }));
});

router.put('/tickets/:id', requireRole('support'), async (req, res) => {
  const id = idParam(req.params.id, 'Ticket');
  const update = validate(req.body, { status: { oneOf: TICKET_STATUS }, response: { max: 1000 }, assignedTo: { max: 24 } });
  if ('assignedTo' in update && !(mongoose.isValidObjectId(update.assignedTo) && (await SupportTeam.exists({ _id: update.assignedTo })))) {
    throw new HttpError(400, 'Unknown support agent');
  }
  if (req.body?.assignedTo === '') update.assignedTo = null;
  const before = await SupportTicket.findById(id);
  if (!before) throw new HttpError(404, 'Ticket not found');
  const ticket = await SupportTicket.findByIdAndUpdate(id, { $set: update }, { new: true }).populate(POPULATE);
  if (ticket.user && update.response && update.response !== before.response) {
    await notifyUser(ticket.user._id, `Support replied to "${ticket.subject}": ${update.response.slice(0, 140)}`);
  }
  ticketChanged(ticket);
  res.json(ticket);
});

router.post('/complaints', either, async (req, res) => {
  const { ride, description } = validate(req.body, { ride: { required: true, max: 24 }, description: { required: true, max: 1000 } });
  if (!(await Ride.exists({ _id: idParam(ride, 'Ride'), [OWNER_FIELD[req.auth.role]]: req.auth.id }))) throw new HttpError(404, 'Ride not found');
  res.status(201).json(await Complaint.create({ ride, raisedBy: req.auth.role, description }));
});

router.get('/admin/complaints', requireRole('admin'), async (req, res) => {
  const { status = 'all' } = validate(req.query, { status: { oneOf: [...COMPLAINT_STATUS, 'all'] } });
  res.json(await Complaint.find(status === 'all' ? {} : { status })
    .populate({ path: 'ride', select: 'pickup drop user driver createdAt', populate: [{ path: 'user', select: 'name' }, { path: 'driver', select: 'name' }] })
    .sort({ createdAt: -1 }).limit(200));
});

router.put('/admin/complaints/:id', requireRole('admin'), async (req, res) => {
  const update = validate(req.body, { status: { oneOf: COMPLAINT_STATUS }, resolutionNotes: { max: 1000 } });
  const c = await Complaint.findByIdAndUpdate(idParam(req.params.id, 'Complaint'), { $set: update }, { new: true });
  if (!c) throw new HttpError(404, 'Complaint not found');
  res.json(c);
});

export default router;
