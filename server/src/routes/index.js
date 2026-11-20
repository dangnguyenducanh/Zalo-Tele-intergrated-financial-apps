import { Router } from 'express';
import { connectDbMiddleware } from '../middleware/connectDb.js';
import health from './health.js';
import auth from './auth.js';
import sessions from './sessions.js';
import users from './users.js';
import wallets from './wallets.js';
import categories from './categories.js';

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

export default router;
