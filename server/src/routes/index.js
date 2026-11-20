import { Router } from 'express';
import { connectDbMiddleware } from '../middleware/connectDb.js';
import health from './health.js';

const router = Router();

router.use('/health', health); // checks the database itself and answers 503 when it is down
router.use(connectDbMiddleware); // every router below gets a connected database

// Feature routers go below, one line per feature, each added by its own task (docs/08 §8.5).

export default router;
