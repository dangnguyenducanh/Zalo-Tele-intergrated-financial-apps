import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { MAX_MONEY } from '../models/Transaction.js';
import { copyBudgets, createBudget, deleteBudget, listBudgets, updateBudget } from '../services/budgets.js';
import { monthKey } from '../utils/vnTime.js';

const router = Router();
router.use(requireAuth);

// 'YYYY-MM', a Vietnamese calendar month. In a query it defaults to the current month. Stats use it too.
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');
export const monthQuery = z.object({ month: month.default(() => monthKey(new Date())) });

const limit = z.int().positive().max(MAX_MONEY); // whole VND, 1 … 10^13
const createBody = z.object({
  month,
  categoryId: z.string().regex(/^[0-9a-f]{24}$/i, 'must be an id').nullable(), // null = overall budget; must be sent
  limit,
});
const copyBody = z.object({ from: month, to: month });
const updateBody = z.object({ limit }); // month and category are fixed; other keys are dropped

router.get('/', async (req, res) => {
  res.json(await listBudgets(req.user.id, monthQuery.parse(req.query).month));
});

router.post('/', async (req, res) => {
  res.status(201).json(await createBudget(req.user.id, createBody.parse(req.body)));
});

router.post('/copy', async (req, res) => {
  res.status(201).json(await copyBudgets(req.user.id, copyBody.parse(req.body)));
});

router.patch('/:id', async (req, res) => {
  res.json(await updateBudget(req.user.id, req.params.id, updateBody.parse(req.body))); // malformed id → CastError → 400
});

router.delete('/:id', async (req, res) => {
  await deleteBudget(req.user.id, req.params.id);
  res.sendStatus(204);
});

export default router;
