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
// Meta signs the exact bytes it sends, and re-serialising req.body does not give them back, so the WhatsApp
// webhook keeps the raw body (docs/04 §4.1). Every other route only gets the parsed one.
const keepRawBodyForWhatsApp = (req, res, buf) => {
  if (req.originalUrl.startsWith('/api/webhooks/whatsapp')) req.rawBody = buf;
};
app.use(express.json({ limit: '1mb', verify: keepRawBodyForWhatsApp }));
app.use(cookieParser());
app.use(requestId);
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

export default app;
