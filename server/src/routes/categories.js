import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { KEYWORD_MAX_COUNT, KEYWORD_MAX_LENGTH, createCategory, deleteCategory, listCategories, updateCategory } from '../services/categories.js';
import { normalize } from '../utils/normalize.js';

const router = Router();
router.use(requireAuth);

// Bot keywords (and wallet aliases) are stored the way the parser compares them: "Phở Bò" → "pho bo", no duplicates.
export const keywordList = z
  .array(z.string().max(KEYWORD_MAX_LENGTH))
  .max(KEYWORD_MAX_COUNT)
  .transform((words) => [...new Set(words.map(normalize).filter(Boolean))]);
export const uiText = z.string().trim().max(40); // icon name or colour, only used by the UI

const type = z.enum(['expense', 'income']);
const editable = { name: z.string().trim().min(1).max(40), keywords: keywordList.optional(), icon: uiText.optional(), color: uiText.optional() };
const createBody = z.object({ type, ...editable });
// The type and the fallback flag are not editable: transactions keep their type, and each type keeps one fallback.
const updateBody = z.object(editable).partial();

router.get('/', async (req, res) => {
  res.json(await listCategories(req.user.id, z.object({ type: type.optional() }).parse(req.query)));
});

router.post('/', async (req, res) => {
  res.status(201).json(await createCategory(req.user.id, createBody.parse(req.body)));
});

router.patch('/:id', async (req, res) => {
  res.json(await updateCategory(req.user.id, req.params.id, updateBody.parse(req.body)));
});

router.delete('/:id', async (req, res) => {
  await deleteCategory(req.user.id, req.params.id); // a malformed id becomes a CastError → 400
  res.sendStatus(204);
});

export default router;
