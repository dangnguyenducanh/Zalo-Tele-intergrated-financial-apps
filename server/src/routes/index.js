import { Router } from 'express';
import { connectDbMiddleware } from '../middleware/connectDb.js';
import health from './health.js';
import auth from './auth.js';
import sessions from './sessions.js';
import users from './users.js';
import wallets from './wallets.js';
import categories from './categories.js';
import transactions from './transactions.js';
import budgets from './budgets.js';
import stats from './stats.js';
import chatLinks from './chatLinks.js';
import receipts from './receipts.js';
import webhooks from './webhooks.js';
import admin from './admin.js';

const router = Router();

router.use('/health', health); // checks the database itself and answers 503 when it is down
router.use(connectDbMiddleware); // every router below gets a connected database

// Feature routers go below, one line per feature, each added by its own task (docs/08 §8.5).
// Protected routers apply requireAuth themselves, so unknown paths still answer 404.
router.use('/auth', auth);
router.use('/sessions', sessions);
router.use('/users', users);
router.use('/wallets', wallets);
router.use('/categories', categories);
router.use('/transactions', transactions);
router.use('/budgets', budgets);
router.use('/stats', stats);
router.use('/chat-links', chatLinks);
router.use('/receipts', receipts);
router.use('/webhooks', webhooks); // checks the platform's secret header instead of a JWT
router.use('/admin', admin); // requireAuth + requireRole('admin')

export default router;
