// KYC uploads: type + size checked, stored under random names, never served publicly.
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { HttpError } from './middleware.js';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads'); // tests point this elsewhere
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const DOC_TYPES = ['Driving licence', 'Vehicle RC', 'Aadhaar (KYC)', 'Insurance'];
await mkdir(UPLOAD_DIR, { recursive: true });

// Identify the file by its first bytes; the browser-supplied name and MIME type are not trusted.
export function detectFileType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

const CONTENT_TYPE = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
const STORED_NAME = /^[a-f0-9]{32}\.(jpg|png|pdf)$/;

// Single file in field "file", kept in memory (max 2 MB) so it can be checked before touching disk.
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }).single('file');
export const receiveFile = (req, res, next) => parser(req, res, (err) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'File must be 2 MB or smaller'));
  if (err) return next(new HttpError(400, 'Could not read the upload'));
  next();
});

// Validates and writes req.file; returns the stored file name.
export async function saveUpload(file) {
  if (!file) throw new HttpError(400, 'Choose a file to upload');
  const ext = detectFileType(file.buffer);
  if (!ext) throw new HttpError(415, 'Upload a JPG, PNG or PDF');
  const name = `${randomBytes(16).toString('hex')}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), file.buffer, { flag: 'wx' });
  return name;
}

export async function removeUpload(name) {
  if (STORED_NAME.test(name || '')) await unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
}

// Streams a stored file. Callers must authorise first; the name is re-checked so no path can escape.
export function sendUpload(res, name) {
  if (!STORED_NAME.test(name)) throw new HttpError(404, 'File not found');
  res.set({ 'Content-Type': CONTENT_TYPE[name.split('.')[1]], 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.join(UPLOAD_DIR, name), (err) => err && !res.headersSent && res.status(404).json({ error: 'File not found' }));
}
