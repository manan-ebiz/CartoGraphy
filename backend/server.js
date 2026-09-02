import express from 'express';
import cors from 'cors';
import routes from './src/routes.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use('/api', routes);

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Sitemap generator backend listening on http://localhost:${PORT}`);
});
