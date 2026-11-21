import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { MAX_MONEY } from '../models/Transaction.js';
import { createWallet, deleteWallet, getWallet, listWallets, updateWallet } from '../services/wallets.js';
import { keywordList, uiText } from './categories.js';

const router = Router();
router.use(requireAuth);

const fields = {
  name: z.string().trim().min(1).max(40),
  type: z.enum(['cash', 'bank', 'ewallet', 'credit']),
  initialBalance: z.int().min(-MAX_MONEY).max(MAX_MONEY), // whole VND, may be 0 or negative (credit)
  aliases: keywordList.optional(),
  color: uiText.optional(),
  icon: uiText.optional(),
};
const createBody = z.object(fields);
const updateBody = z.object({ ...fields, archived: z.boolean() }).partial();
const listQuery = z.object({ includeArchived: z.enum(['true', 'false']).optional() });

router.get('/', async (req, res) => {
  const { includeArchived } = listQuery.parse(req.query);
  res.json(await listWallets(req.user.id, { includeArchived: includeArchived === 'true' }));
});

router.post('/', async (req, res) => {
  res.status(201).json(await createWallet(req.user.id, createBody.parse(req.body)));
});

router.get('/:id', async (req, res) => {
  res.json(await getWallet(req.user.id, req.params.id)); // a malformed id becomes a CastError → 400
});

router.patch('/:id', async (req, res) => {
  res.json(await updateWallet(req.user.id, req.params.id, updateBody.parse(req.body)));
});

router.delete('/:id', async (req, res) => {
  await deleteWallet(req.user.id, req.params.id);
  res.sendStatus(204);
});

export default router;
