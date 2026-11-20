import express, { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createReceiptDraft } from '../services/receipts.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
router.use(requireAuth);

// The browser shrinks the photo first (≤ 1600 px JPEG), and Vercel refuses bodies over 4.5 MB anyway: more → 413.
const multipartBody = express.raw({ type: 'multipart/form-data', limit: '4.5mb' });

// POST /api/receipts with the photo in multipart field "image" → 201 { transaction } (a draft, source "receipt").
// KIE takes about 20 s; its failures answer 502 KIE_UNAVAILABLE, 504 KIE_TIMEOUT or 422 RECEIPT_UNREADABLE.
router.post('/', multipartBody, async (req, res) => {
  const transaction = await createReceiptDraft(req.user.id, await imageField(req));
  res.status(201).json({ transaction });
});

// The bytes of the "image" part, read with the FormData parser built into Node (no upload library needed).
async function imageField(req) {
  const form = Buffer.isBuffer(req.body)
    ? await new Response(req.body, { headers: { 'content-type': req.get('content-type') } }).formData().catch(() => null)
    : null;
  const file = form?.get('image');
  if (!(file instanceof File)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Send the photo as multipart/form-data field "image"', [{ path: 'image', issue: 'required' }]);
  }
  return Buffer.from(await file.arrayBuffer());
}

export default router;
