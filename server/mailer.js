// Email over SMTP (nodemailer). In Docker dev, SMTP points at Mailpit: open http://localhost:8025 to read mail.
// ponytail: no SMTP_HOST → emails are logged instead of sent.
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT = '1025', SMTP_USER, SMTP_PASS, MAIL_FROM = 'SheRides Safety <safety@sherides.test>' } = process.env;
const transport = SMTP_HOST
  ? nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  })
  : null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Mailpit (dev inbox) accepts any address, so demo `.test` emails stay visible there.
const isLocalSmtp = SMTP_HOST === 'mailpit';

// Never throws: a mail problem must not break a ride or an SOS.
export async function sendMail(to, subject, text) {
  const valid = [...new Set([].concat(to).filter((a) => typeof a === 'string' && EMAIL.test(a)))];
  // `.test` is a reserved, undeliverable domain (RFC 2606) used by the demo accounts: log instead of bouncing.
  const recipients = isLocalSmtp ? valid : valid.filter((a) => !/\.test$/i.test(a));
  const skipped = valid.filter((a) => !recipients.includes(a));
  if (skipped.length) console.log(`[mail skipped: demo address] to=${skipped.join(',')} subject=${subject}`);
  if (!recipients.length) return;
  if (!transport) {
    console.log(`[mail disabled] to=${recipients.join(',')} subject=${subject}`);
    return;
  }
  try {
    // Several recipients (emergency contacts) go in Bcc so no contact sees the others' addresses.
    await transport.sendMail({ from: MAIL_FROM, ...(recipients.length > 1 ? { bcc: recipients } : { to: recipients }), subject, text });
  } catch (err) {
    console.error('[mail failed]', subject, err.message);
  }
}
