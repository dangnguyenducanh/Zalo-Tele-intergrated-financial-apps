import { Router } from 'express';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';

const router = Router();

// GET /api/health → 200 {status:'ok', db:'up'} when MongoDB answers a ping, otherwise 503.
router.get('/', async (req, res) => {
  try {
    await connectDb();
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    console.error(`${req.id} health check: database unreachable: ${err.message}`);
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

export default router;
