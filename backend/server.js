import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './src/routes.js';

const app = express();
const PORT = process.env.PORT || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, '../frontend/dist');

app.use(cors());
app.use(express.json());
app.use('/api', routes);

app.get('/health', (req, res) => res.json({ ok: true }));

// Production: serve the Vite build from the same service (Render single-service deploy).
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`Sitemap generator backend listening on http://localhost:${PORT}`);
});
