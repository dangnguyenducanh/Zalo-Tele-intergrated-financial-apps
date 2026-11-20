import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  listUsers,
  systemStats,
  updateTemplate,
  updateUser,
} from '../services/admin.js';
import { keywordList, uiText } from './categories.js';

// /api/admin/* (docs/04 §4.4 Admin): only admins get past this line, everyone else gets 403 FORBIDDEN.
const router = Router();
router.use(requireAuth, requireRole('admin'));

const role = z.enum(['user', 'admin']);
const status = z.enum(['active', 'locked']);
const usersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: role.optional(),
  status: status.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const userChanges = z
  .object({ role: role.optional(), status: status.optional() })
  .refine((body) => body.role || body.status, { message: 'role or status is required' });

const type = z.enum(['expense', 'income']);
const name = z.string().trim().min(1).max(40);
const templateFields = { names: z.object({ vi: name, en: name }), keywords: keywordList.optional(), icon: uiText.optional(), color: uiText.optional() };
const templateBody = z.object({ type, ...templateFields });
// Like a user's own categories, a template keeps its type (each type needs its fallback "Khác / Other").
const templateChanges = z.object(templateFields).partial();

router.get('/users', async (req, res) => {
  res.json(await listUsers(usersQuery.parse(req.query)));
});

router.patch('/users/:id', async (req, res) => {
  res.json(await updateUser(req.params.id, userChanges.parse(req.body)));
});

router.get('/categories', async (req, res) => {
  res.json(await listTemplates(z.object({ type: type.optional() }).parse(req.query)));
});

router.post('/categories', async (req, res) => {
  res.status(201).json(await createTemplate(templateBody.parse(req.body)));
});

router.patch('/categories/:id', async (req, res) => {
  res.json(await updateTemplate(req.params.id, templateChanges.parse(req.body)));
});

router.delete('/categories/:id', async (req, res) => {
  await deleteTemplate(req.params.id);
  res.sendStatus(204);
});

router.get('/stats', async (req, res) => {
  res.json(await systemStats());
});

export default router;
