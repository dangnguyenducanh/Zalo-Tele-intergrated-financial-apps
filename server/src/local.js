import app from './app.js';
import { env } from './config/env.js';

// Local development only; on Vercel, api/index.js exports the app instead.
app.listen(env.PORT, (err) => {
  if (err) throw err;
  console.info(`API listening on http://localhost:${env.PORT}`);
});
