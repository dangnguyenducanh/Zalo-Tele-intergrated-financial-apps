import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { byCategory, daily, monthSummary } from '../services/stats.js';
import { monthQuery } from './budgets.js';

const router = Router();
router.use(requireAuth);

const byCategoryQuery = monthQuery.extend({ type: z.enum(['expense', 'income']).default('expense') });

router.get('/summary', async (req, res) => {
  res.json(await monthSummary(req.user.id, monthQuery.parse(req.query).month));
});

router.get('/by-category', async (req, res) => {
  const { month, type } = byCategoryQuery.parse(req.query);
  res.json(await byCategory(req.user.id, month, type));
});

router.get('/daily', async (req, res) => {
  res.json(await daily(req.user.id, monthQuery.parse(req.query).month));
});

export default router;
