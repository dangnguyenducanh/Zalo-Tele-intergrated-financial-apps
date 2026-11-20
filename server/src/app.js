import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestId } from './middleware/requestId.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/error.js';
import routes from './routes/index.js';

// Builds the Express app without listening: api/index.js hands it to Vercel, local.js listens locally.
const app = express();

app.set('trust proxy', 1); // behind Vercel's proxy: req.ip comes from X-Forwarded-For (rate limits, sessions)

// Middleware order follows docs/04 §4.1.
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(requestId);
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

export default app;
