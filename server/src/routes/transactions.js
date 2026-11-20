import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  confirmTransaction,
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  parseTransactions,
  restoreTransaction,
  updateTransaction,
} from '../services/transactions.js';

const router = Router();
router.use(requireAuth);

const objectId = z.string().regex(/^[0-9a-f]{24}$/i, 'must be an id');
const type = z.enum(['expense', 'income']);

const fields = {
  type,
  amount: z.int().positive(), // whole VND, 1 … Number.MAX_SAFE_INTEGER: no 12.5, no "45k", no 2^53
  walletId: objectId,
  categoryId: objectId,
  occurredAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  note: z.string().trim().max(200).optional(),
};
const createBody = z.object(fields);
const updateBody = z.object(fields).partial(); // status, source and owner are not editable here

const listQuery = z.object({
  from: z.iso.date().optional(), // YYYY-MM-DD, a Vietnamese calendar day (included)
  to: z.iso.date().optional(), // YYYY-MM-DD, included
  type: type.optional(),
  walletId: objectId.optional(),
  categoryId: objectId.optional(),
  status: z.enum(['draft', 'confirmed']).optional(),
  source: z.enum(['web', 'telegram', 'zalo', 'receipt']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['-occurredAt', 'occurredAt', '-amount', 'amount']).default('-occurredAt'),
});
const parseBody = z.object({ text: z.string().trim().min(1).max(2000) });

router.get('/', async (req, res) => {
  res.json(await listTransactions(req.user.id, listQuery.parse(req.query)));
});

// Quick-add preview: registered before '/:id' routes; it only reads.
router.post('/parse', async (req, res) => {
  res.json(await parseTransactions(req.user.id, parseBody.parse(req.body).text));
});

router.post('/', async (req, res) => {
  res.status(201).json(await createTransaction(req.user.id, createBody.parse(req.body)));
});

router.get('/:id', async (req, res) => {
  res.json(await getTransaction(req.user.id, req.params.id)); // a malformed id becomes a CastError → 400
});

router.patch('/:id', async (req, res) => {
  res.json(await updateTransaction(req.user.id, req.params.id, updateBody.parse(req.body)));
});

router.delete('/:id', async (req, res) => {
  await deleteTransaction(req.user.id, req.params.id);
  res.sendStatus(204);
});

router.post('/:id/restore', async (req, res) => {
  res.json(await restoreTransaction(req.user.id, req.params.id));
});

router.post('/:id/confirm', async (req, res) => {
  res.json(await confirmTransaction(req.user.id, req.params.id));
});

export default router;
